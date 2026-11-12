/* 악기 강조 (AI 없음)
 * 실제 음원 분리가 아니라, 악기별로 주로 차지하는 주파수 대역과 스테레오 위치(가운데/좌우)를
 * 이용해 해당 성분을 키우고 나머지를 줄이는 필터다. 오디오 워크렛 안에서 샘플 단위로 동작한다.
 *   출력 = 원음 × cut + 대상성분 × (boost − cut)
 * 대상성분이 원음의 일부(대역/위치)이므로, 그 성분은 약 boost 배, 나머지는 약 cut 배가 된다.
 */
export type FocusMode = 'off' | 'guitar' | 'bass' | 'keys' | 'drums' | 'vocal'

export const FOCUS_MODES: { id: FocusMode; label: string; hint: string }[] = [
  { id: 'guitar', label: '기타', hint: '중고역 + 좌우로 퍼진 소리 강조' },
  { id: 'bass', label: '베이스', hint: '저음역(약 40~250Hz) 강조' },
  { id: 'keys', label: '건반', hint: '중음역 강조 (기타와 구분이 약함)' },
  { id: 'drums', label: '드럼', hint: '스네어·심벌 타격음 강조, 저음은 줄임' },
  { id: 'vocal', label: '보컬', hint: '가운데에 있는 중음역 강조' },
]

class Biquad {
  b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; z1 = 0; z2 = 0
  set(type: 'lp' | 'hp' | 'peak', f: number, q: number, sr: number, gainDb = 0) {
    const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr
    const cw = Math.cos(w), al = Math.sin(w) / (2 * q)
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number
    if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al }
    else if (type === 'hp') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al }
    else {
      const A = Math.pow(10, gainDb / 40)
      b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0
    return this
  }
  run(x: number) {
    const y = this.b0 * x + this.z1
    this.z1 = this.b1 * x - this.a1 * y + this.z2
    this.z2 = this.b2 * x - this.a2 * y
    return y
  }
  reset() { this.z1 = 0; this.z2 = 0 }
}

/** 4차 버터워스 (2단) */
class Chain {
  fs: Biquad[] = []
  add(type: 'lp' | 'hp', f: number, sr: number) {
    this.fs.push(new Biquad().set(type, f, 0.5412, sr), new Biquad().set(type, f, 1.3066, sr))
    return this
  }
  peak(f: number, q: number, db: number, sr: number) { this.fs.push(new Biquad().set('peak', f, q, sr, db)); return this }
  run(x: number) { for (const f of this.fs) x = f.run(x); return x }
  reset() { for (const f of this.fs) f.reset() }
}

const band = (sr: number, lo: number, hi: number) => {
  const c = new Chain()
  if (lo > 0) c.add('hp', lo, sr)
  if (hi > 0) c.add('lp', hi, sr)
  return c
}

export class Focus {
  mode: FocusMode = 'off'
  amount = 0.8 // 0..1
  private sr: number
  private cut = 1
  private boost = 1
  // 상태 (모드마다 필요한 필터)
  private fL: Chain[] = []
  private fR: Chain[] = []
  private fM: Chain[] = []
  private envF = 0
  private envS = 0
  private envA = 0
  private aF: number
  private aS: number
  private aD: number
  private lim = 1
  private fade = 1 // 모드 전환 시 부드럽게
  private target: FocusMode = 'off'

  constructor(sr: number) {
    this.sr = sr
    this.aF = Math.exp(-1 / (0.002 * sr))
    this.aS = Math.exp(-1 / (0.08 * sr))
    this.aD = Math.exp(-1 / (0.02 * sr))
  }

  set(mode: FocusMode, amount: number) {
    this.amount = Math.max(0, Math.min(1, amount))
    this.applyGains(mode)
    if (mode !== this.mode) { this.target = mode; this.fade = this.mode === 'off' ? 0 : this.fade }
  }

  private applyGains(mode: FocusMode) {
    // 대상은 +4dB 까지, 나머지는 최대 −18dB (드럼은 −12dB: 곡이 무엇인지 알아들을 수 있게)
    const depth = mode === 'drums' ? 12 : 18
    this.boost = Math.pow(10, (4 * this.amount) / 20)
    this.cut = Math.pow(10, (-depth * this.amount) / 20)
  }

  private build(mode: FocusMode) {
    const sr = this.sr
    this.fL = []; this.fR = []; this.fM = []
    this.envF = 0; this.envS = 0
    if (mode === 'bass') { this.fM = [band(sr, 35, 250)] }
    else if (mode === 'vocal') { this.fM = [band(sr, 180, 6000).peak(2500, 1, 3, sr)] }
    else if (mode === 'guitar') {
      // 좌우 채널 각각의 중고역 − 가운데 성분 일부(보컬·베이스·킥이 주로 가운데)
      this.fL = [band(sr, 150, 6000).peak(2200, 0.8, 3, sr)]
      this.fR = [band(sr, 150, 6000).peak(2200, 0.8, 3, sr)]
      this.fM = [band(sr, 150, 6000)]
    } else if (mode === 'keys') {
      this.fL = [band(sr, 150, 2200).peak(600, 0.7, 3, sr)]
      this.fR = [band(sr, 150, 2200).peak(600, 0.7, 3, sr)]
    } else if (mode === 'drums') {
      // 저음 분리(저음은 줄임), 심벌·하이햇 대역, 타격 감지용
      this.fL = [band(sr, 0, 180), band(sr, 6000, 0)]
      this.fR = [band(sr, 0, 180), band(sr, 6000, 0)]
      this.fM = [band(sr, 5000, 0)] // 타격 감지: 드럼(스네어·심벌)은 고음 잡음이 순간적으로 많음
    }
  }

  /** 입력 l,r → out[0], out[1] */
  process(l: number, r: number, out: { l: number; r: number }) {
    if (this.target !== this.mode) {
      // 이전 모드를 페이드아웃한 뒤 필터를 새로 만들고 페이드인
      this.fade -= 1 / (0.03 * this.sr)
      if (this.fade <= 0) { this.fade = 0; this.mode = this.target; this.applyGains(this.mode); this.build(this.mode) }
    } else if (this.fade < 1) this.fade = Math.min(1, this.fade + 1 / (0.03 * this.sr))
    if (this.mode === 'off' || this.amount <= 0) { out.l = l; out.r = r; return }
    const m = (l + r) * 0.5
    let tl = 0, tr = 0
    switch (this.mode) {
      case 'bass': {
        // 지속음(베이스) 위주: 갑자기 커지는 타격음(킥)은 덜 키움
        const t = this.fM[0].run(m)
        const a = Math.abs(t)
        this.envF = a > this.envF ? a : this.envF * this.aF + a * (1 - this.aF)
        this.envS = this.envS * this.aS + a * (1 - this.aS)
        const sf = Math.min(1, Math.max(0.2, 2.2 - this.envF / (this.envS + 1e-6)))
        tl = t * sf; tr = tl; break
      }
      case 'vocal': { const t = this.fM[0].run(m); tl = t; tr = t; break }
      case 'guitar': {
        const c = this.fM[0].run(m) * 0.7
        tl = this.fL[0].run(l) - c; tr = this.fR[0].run(r) - c; break
      }
      case 'keys': { tl = this.fL[0].run(l); tr = this.fR[0].run(r); break }
      case 'drums': {
        // 타격음 강조(트랜지언트 셰이퍼): 소리가 갑자기 시작되는 순간은 키우고, 길게 이어지는 소리(기타·보컬·베이스)는 줄임.
        // 저음은 따로 절반으로 줄여 킥/베이스가 과하게 울리지 않게 함. 심벌·하이햇 대역은 추가로 키움.
        const lowL = this.fL[0].run(l), lowR = this.fR[0].run(r)
        const hiL = this.fL[1].run(l), hiR = this.fR[1].run(r)
        const a = Math.abs(this.fM[0].run(m))
        this.envF = a > this.envF ? a : this.envF * this.aD + a * (1 - this.aD)
        this.envS = this.envS * this.aS + a * (1 - this.aS)
        const am = Math.abs(m)
        this.envA = this.envA * this.aS + am * (1 - this.aS)
        // 곡 전체 음량 대비 고음 타격이 뚜렷할 때만 (작은 잡음·현의 어택은 무시)
        const t = Math.min(1, Math.max(0, (this.envF - 1.5 * this.envS) / (0.15 * this.envA + 1e-6)))
        const gBody = this.cut + (this.boost * 1.4 - this.cut) * t
        const gLow = gBody * 0.5
        const kh = this.boost - this.cut
        let dl = (l - lowL) * gBody + lowL * gLow + hiL * kh
        let dr = (r - lowR) * gBody + lowR * gLow + hiR * kh
        dl = l + (dl - l) * this.fade; dr = r + (dr - r) * this.fade
        this.limit(dl, dr, out)
        return
      }
    }
    const k = (this.boost - this.cut) * this.fade
    const c = 1 + (this.cut - 1) * this.fade
    this.limit(l * c + tl * k, r * c + tr * k, out)
  }

  private limit(ol: number, or: number, out: { l: number; r: number }) {
    // 간단한 리미터 (클리핑 방지)
    const pk = Math.max(Math.abs(ol), Math.abs(or)) * this.lim
    if (pk > 0.98) this.lim *= 0.98 / pk
    else this.lim = Math.min(1, this.lim + 0.00002)
    ol *= this.lim; or *= this.lim
    out.l = ol; out.r = or
  }
}
