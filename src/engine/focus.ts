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
  { id: 'drums', label: '드럼', hint: '킥 저음 + 심벌 고음 + 타격음 강조' },
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
  private aF: number
  private aS: number
  private lim = 1
  private fade = 1 // 모드 전환 시 부드럽게
  private target: FocusMode = 'off'

  constructor(sr: number) {
    this.sr = sr
    this.aF = Math.exp(-1 / (0.002 * sr))
    this.aS = Math.exp(-1 / (0.08 * sr))
  }

  set(mode: FocusMode, amount: number) {
    this.amount = Math.max(0, Math.min(1, amount))
    // 대상은 +4dB 까지, 나머지는 최대 −20dB
    this.boost = Math.pow(10, (4 * this.amount) / 20)
    this.cut = Math.pow(10, (-20 * this.amount) / 20)
    if (mode !== this.mode) { this.target = mode; this.fade = this.mode === 'off' ? 0 : this.fade }
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
      this.fM = [band(sr, 40, 110), band(sr, 170, 230)] // 킥, 스네어 몸통
      this.fL = [band(sr, 5000, 0)] // 심벌·하이햇
      this.fR = [band(sr, 5000, 0)]
    }
  }

  /** 입력 l,r → out[0], out[1] */
  process(l: number, r: number, out: { l: number; r: number }) {
    if (this.target !== this.mode) {
      // 이전 모드를 페이드아웃한 뒤 필터를 새로 만들고 페이드인
      this.fade -= 1 / (0.03 * this.sr)
      if (this.fade <= 0) { this.fade = 0; this.mode = this.target; this.build(this.mode) }
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
        const lowT = this.fM[0].run(m) + this.fM[1].run(m)
        let hl = this.fL[0].run(l), hr = this.fR[0].run(r)
        // 타격음(빠른 포락선 > 느린 포락선)일 때 더 키움
        const a = Math.abs(m)
        this.envF = a > this.envF ? a : this.envF * this.aF + a * (1 - this.aF)
        this.envS = this.envS * this.aS + a * (1 - this.aS)
        const tg = Math.min(2.5, Math.max(0, (this.envF / (this.envS + 1e-6) - 1) * 1.5))
        hl *= tg; hr *= tg
        tl = lowT * tg + hl; tr = lowT * tg + hr; break
      }
    }
    const k = (this.boost - this.cut) * this.fade
    const c = 1 + (this.cut - 1) * this.fade
    let ol = l * c + tl * k, or = r * c + tr * k
    // 간단한 리미터 (클리핑 방지)
    const pk = Math.max(Math.abs(ol), Math.abs(or)) * this.lim
    if (pk > 0.98) this.lim *= 0.98 / pk
    else this.lim = Math.min(1, this.lim + 0.00002)
    ol *= this.lim; or *= this.lim
    out.l = ol; out.r = or
  }
}
