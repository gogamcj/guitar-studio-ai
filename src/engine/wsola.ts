// WSOLA 타임 스트레치 + 리샘플 피치 시프트 (자체 구현)
export class WSOLA {
  // 스테레오 WSOLA 타임 스트레처 (75% 오버랩). speed = 원곡 소비 속도(1보다 작으면 느리게)
  N: number
  Hs: number
  delta: number
  win: Float32Array
  ola: [Float32Array, Float32Array]
  // 원곡 위치 누적(창 가중) → 각 출력 샘플이 실제로 담고 있는 원곡 위치. 클릭 싱크의 기준
  olaSrc: Float64Array
  olaW: Float64Array
  // 확정된 출력(중간 버퍼) 링
  outL: Float32Array
  outR: Float32Array
  outSrc: Float64Array
  outLen = 0
  outHead = 0
  readFrac = 0
  pa = 0 // 다음 분석 위치(원곡 샘플)
  prevPos = -1 // 직전 프레임에서 실제 사용한 위치(k 포함)
  first = true
  private norm: number
  constructor(sampleRate: number) {
    let n = Math.round(0.046 * sampleRate)
    n += 4 - (n % 4)
    this.N = n
    this.Hs = n / 4
    this.norm = 0.5 // Hann 75% 오버랩 합 = 2 (최소 정규화 기준)
    this.delta = Math.round(0.010 * sampleRate)
    this.win = new Float32Array(n)
    for (let i = 0; i < n; i++) this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)
    this.ola = [new Float32Array(n), new Float32Array(n)]
    this.olaSrc = new Float64Array(n)
    this.olaW = new Float64Array(n)
    const cap = 1 << 15
    this.outL = new Float32Array(cap)
    this.outR = new Float32Array(cap)
    this.outSrc = new Float64Array(cap)
  }
  reset(pos: number) {
    this.ola[0].fill(0)
    this.ola[1].fill(0)
    this.olaSrc.fill(0)
    this.olaW.fill(0)
    this.outLen = 0
    this.outHead = 0
    this.readFrac = 0
    this.pa = pos
    this.prevPos = -1
    this.first = true
  }
  private push(l: number, r: number, s: number) {
    const cap = this.outL.length
    const idx = (this.outHead + this.outLen) % cap
    this.outL[idx] = l
    this.outR[idx] = r
    this.outSrc[idx] = s
    this.outLen++
  }
  synthFrame(L: Float32Array, R: Float32Array, speed: number) {
    const N = this.N, Hs = this.Hs, len = L.length
    const Ha = speed * Hs
    let pos = Math.round(this.pa)
    if (!this.first && this.prevPos >= 0) {
      // 직전 프레임의 자연 연속 구간(prevPos+Hs)과 가장 유사한 위치를 [-delta, delta] 에서 탐색
      const nat = this.prevPos + Hs
      const d = this.delta
      const cmpLen = Math.min(N - Hs, 2 * Hs)
      let best = 0, bestScore = -Infinity
      for (let k = -d; k <= d; k += 2) {
        const p = pos + k
        if (p < 0 || p + cmpLen >= len || nat + cmpLen >= len) continue
        let sc = 0
        for (let i = 0; i < cmpLen; i += 4) sc += (L[nat + i] + R[nat + i]) * (L[p + i] + R[p + i])
        if (sc > bestScore) { bestScore = sc; best = k }
      }
      const c = best
      for (let k = c - 1; k <= c + 1; k += 2) {
        const p = pos + k
        if (p < 0 || p + cmpLen >= len || nat + cmpLen >= len || k < -d || k > d) continue
        let sc = 0
        for (let i = 0; i < cmpLen; i += 4) sc += (L[nat + i] + R[nat + i]) * (L[p + i] + R[p + i])
        if (sc > bestScore) { bestScore = sc; best = k }
      }
      pos += best
    }
    const o0 = this.ola[0], o1 = this.ola[1], w = this.win, os = this.olaSrc, ow = this.olaW
    for (let i = 0; i < N; i++) {
      const p = pos + i
      const inb = p >= 0 && p < len
      o0[i] += (inb ? L[p] : 0) * w[i]
      o1[i] += (inb ? R[p] : 0) * w[i]
      os[i] += w[i] * p
      ow[i] += w[i]
    }
    for (let i = 0; i < Hs; i++) {
      // 창 합으로 정규화 (정상 상태 = 2, 시작 직후 겹침 부족 구간도 음량 유지)
      const wsum = ow[i]
      const gn = 1 / Math.max(this.norm * 0.6, wsum)
      this.push(o0[i] * gn, o1[i] * gn, wsum > 1e-6 ? os[i] / wsum : pos + i)
    }
    o0.copyWithin(0, Hs); o0.fill(0, N - Hs)
    o1.copyWithin(0, Hs); o1.fill(0, N - Hs)
    os.copyWithin(0, Hs); os.fill(0, N - Hs)
    ow.copyWithin(0, Hs); ow.fill(0, N - Hs)
    this.prevPos = pos
    this.first = false
    this.pa += Ha
  }
  // 리샘플 비율 p(피치)로 한 샘플 출력. 부족하면 프레임 합성.
  next(L: Float32Array, R: Float32Array, speed: number, p: number, out: { l: number; r: number; s: number }) {
    while (this.outLen < 4 + Math.ceil(this.readFrac) + 1) this.synthFrame(L, R, speed)
    const cap = this.outL.length
    const f = this.readFrac
    const i0 = Math.floor(f)
    const t = f - i0
    const h = this.outHead
    const a0 = (h + i0) % cap, a1 = (h + i0 + 1) % cap
    // 3차 에르미트 보간(i-1 없으면 선형)
    const am = (h + i0 - 1 + cap) % cap, a2 = (h + i0 + 2) % cap
    out.l = hermite(this.outL[am], this.outL[a0], this.outL[a1], this.outL[a2], t)
    out.r = hermite(this.outR[am], this.outR[a0], this.outR[a1], this.outR[a2], t)
    out.s = this.outSrc[a0] + (this.outSrc[a1] - this.outSrc[a0]) * t
    this.readFrac += p
    const adv = Math.floor(this.readFrac) - 1
    if (adv > 0) {
      this.outHead = (this.outHead + adv) % cap
      this.outLen -= adv
      this.readFrac -= adv
    }
  }
}

function hermite(xm: number, x0: number, x1: number, x2: number, t: number) {
  const c0 = x0
  const c1 = 0.5 * (x1 - xm)
  const c2 = xm - 2.5 * x0 + 2 * x1 - 0.5 * x2
  const c3 = 0.5 * (x2 - xm) + 1.5 * (x0 - x1)
  return ((c3 * t + c2) * t + c1) * t + c0
}

