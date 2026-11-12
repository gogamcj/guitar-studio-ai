import { RealFFT, hann } from './fft'

export const ANALYSIS_SR = 22050

/** 안티앨리어싱(윈도우드 싱크) 후 리샘플 */
export function resample(x: Float32Array, srIn: number, srOut: number): Float32Array {
  if (srIn === srOut) return x
  const ratio = srOut / srIn
  let src = x
  if (ratio < 1) {
    // 저역통과 FIR (컷오프 = 0.45 * srOut)
    const fc = (0.45 * srOut) / srIn
    const taps = 33
    const h = new Float32Array(taps)
    const m = (taps - 1) / 2
    let sum = 0
    for (let i = 0; i < taps; i++) {
      const t = i - m
      const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t)
      const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1))
      h[i] = sinc * w
      sum += h[i]
    }
    for (let i = 0; i < taps; i++) h[i] /= sum
    // 필요한 위치에서만 필터링(출력 샘플마다)
    const outLen = Math.floor(x.length * ratio)
    const out = new Float32Array(outLen)
    const step = 1 / ratio
    for (let o = 0; o < outLen; o++) {
      const c = o * step
      const ci = Math.floor(c)
      const fr = c - ci
      let a = 0, b = 0
      for (let k = 0; k < taps; k++) {
        const idx = ci + k - m
        if (idx >= 0 && idx < x.length) a += x[idx] * h[k]
        const idx2 = idx + 1
        if (idx2 >= 0 && idx2 < x.length) b += x[idx2] * h[k]
      }
      out[o] = a + (b - a) * fr
    }
    return out
  }
  const outLen = Math.floor(x.length * ratio)
  const out = new Float32Array(outLen)
  for (let o = 0; o < outLen; o++) {
    const c = o / ratio
    const i = Math.floor(c)
    const f = c - i
    out[o] = (src[i] ?? 0) + ((src[i + 1] ?? 0) - (src[i] ?? 0)) * f
  }
  return out
}

export interface OnsetFeatures {
  fps: number
  hop: number
  /** 전체 온셋 강도(스펙트럴 플럭스, 정규화) */
  env: Float32Array
  low: Float32Array // < 150Hz (킥)
  mid: Float32Array // 150~2500Hz (스네어)
  high: Float32Array // > 5000Hz (하이햇)
  rms: Float32Array
  /** 프레임 i 의 시간(초) = i / fps + offset */
  offset: number
}

/** 로그 압축 스펙트럴 플럭스 온셋 엔벨로프 */
export function onsetFeatures(x: Float32Array, sr: number, progress?: (p: number) => void): OnsetFeatures {
  const N = 1024, hop = 256
  const fft = new RealFFT(N)
  const w = hann(N)
  const nb = N / 2 + 1
  const frames = Math.max(1, Math.floor((x.length - N) / hop) + 1)
  const env = new Float32Array(frames)
  const low = new Float32Array(frames)
  const mid = new Float32Array(frames)
  const high = new Float32Array(frames)
  const rms = new Float32Array(frames)
  const buf = new Float32Array(N)
  let prev = new Float32Array(nb)
  let cur = new Float32Array(nb)
  const binHz = sr / N
  const bLow = Math.round(150 / binHz), bMid0 = Math.round(150 / binHz), bMid = Math.round(2500 / binHz), bHigh = Math.round(5000 / binHz)
  for (let f = 0; f < frames; f++) {
    const s = f * hop
    let e = 0
    for (let i = 0; i < N; i++) { const v = x[s + i] || 0; buf[i] = v * w[i]; e += v * v }
    rms[f] = Math.sqrt(e / N)
    fft.magnitude(buf, cur)
    let tot = 0, lo = 0, mi = 0, hi = 0
    for (let k = 1; k < nb; k++) {
      const c = Math.log1p(1000 * cur[k])
      const d = c - prev[k]
      prev[k] = c
      if (d > 0) {
        tot += d
        if (k < bLow) lo += d
        if (k >= bMid0 && k < bMid) mi += d
        else if (k > bHigh) hi += d
      }
    }
    env[f] = tot; low[f] = lo; mid[f] = mi; high[f] = hi
    // prev 에는 로그 값이 저장됨
    if (progress && f % 2000 === 0) progress(f / frames)
  }
  // 첫 프레임은 무의미
  env[0] = low[0] = mid[0] = high[0] = 0
  void prev
  void cur
  const fps = sr / hop
  // 프레임 중심 시간 기준. 실측 보정은 tempo.ts 의 ONSET_LAG 로 반영
  return { fps, hop, env: normalizeOnset(env, fps), low: normalizeOnset(low, fps), mid: normalizeOnset(mid, fps), high: normalizeOnset(high, fps), rms, offset: N / 2 / sr }
}

/** 국소 평균 차감 + 표준화 */
function normalizeOnset(e: Float32Array, fps: number) {
  const n = e.length
  const win = Math.round(fps * 0.5)
  const out = new Float32Array(n)
  // 누적합으로 이동평균
  const cs = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) cs[i + 1] = cs[i] + e[i]
  let sq = 0, m = 0
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - win), b = Math.min(n, i + win + 1)
    const mean = (cs[b] - cs[a]) / (b - a)
    const v = Math.max(0, e[i] - mean)
    out[i] = v
    m += v
  }
  m /= n || 1
  for (let i = 0; i < n; i++) sq += (out[i] - m) ** 2
  const sd = Math.sqrt(sq / (n || 1)) || 1
  for (let i = 0; i < n; i++) out[i] /= sd
  return out
}

export interface PitchFeatures {
  fps: number
  hop: number
  offset: number
  /** 프레임 × 12 트레블 크로마 */
  treble: Float32Array[]
  /** 프레임 × 12 베이스 크로마 */
  bass: Float32Array[]
  energy: Float32Array
  /** 추정 튜닝 편차(반음 단위, 0.3 = +30센트) */
  tuning?: number
}

/** 로그 주파수(반음) 스펙트로그램 → 베이스/트레블 크로마
 * - 트레블: 4096 창(약 186ms) → 코드 경계 번짐 최소화
 * - 베이스: 8192 창(약 372ms) → 저음 반음 해상도 확보
 * - 배음 억제: 낮은 음부터 2·3·4·5배음 위치의 에너지를 일부 차감(5도 위 조성 편향 방지)
 */
export function pitchFeatures(x: Float32Array, sr: number, quality: 'fast' | 'accurate', progress?: (p: number) => void): PitchFeatures {
  const hop = quality === 'accurate' ? 1024 : 2048
  const NB = 8192, NT = 4096
  const MIDI_LO = 28, MIDI_HI = 100
  const P = MIDI_HI - MIDI_LO + 1
  const SPLIT = 60
  // 튜닝 추정: A=440 기준에서 벗어난 녹음(예: A=432, 반음 사이 튜닝)도 올바른 반음에 매핑
  let tuning = 0
  let tuneAcc: { s: number; c: number } | null = null
  // 스펙트럼 피크 → 보간 주파수 → 가장 가까운 반음(HPCP 방식). 창 누설로 인한 인접 반음 번짐 방지
  const addPeaks = (mag: Float32Array, N: number, fLo: number, fHi: number, out: Float32Array, scale: number, midiMax: number) => {
    const binHz = sr / N
    const k0 = Math.max(2, Math.floor(fLo / binHz)), k1 = Math.min(N / 2 - 1, Math.ceil(fHi / binHz))
    let mx = 0
    for (let k = k0; k <= k1; k++) if (mag[k] > mx) mx = mag[k]
    const thr = mx * 0.01
    for (let k = k0; k <= k1; k++) {
      const m = mag[k]
      if (m < thr || m <= mag[k - 1] || m < mag[k + 1]) continue
      const a = Math.log(mag[k - 1] + 1e-12), b = Math.log(m + 1e-12), c = Math.log(mag[k + 1] + 1e-12)
      const den = a - 2 * b + c
      const d = den < 0 ? (0.5 * (a - c)) / den : 0
      const f = (k + d) * binHz
      const midi = 69 + 12 * Math.log2(f / 440) - tuning
      if (tuneAcc) { const dv = midi - Math.round(midi); tuneAcc.s += Math.sin(2 * Math.PI * dv) * m; tuneAcc.c += Math.cos(2 * Math.PI * dv) * m; continue }
      const p = Math.round(midi)
      const dev = Math.abs(midi - p)
      if (p < MIDI_LO || p > midiMax) continue
      const w = Math.cos((Math.PI / 2) * Math.min(1, dev / 0.5)) ** 2
      out[p - MIDI_LO] += m * m * w * scale
    }
  }
  const fftB = new RealFFT(NB), fftT = new RealFFT(NT)
  const wB = hann(NB), wT = hann(NT)
  const frames = Math.max(1, Math.floor((x.length - NB) / hop) + 1)
  const treble: Float32Array[] = []
  const bass: Float32Array[] = []
  const energy = new Float32Array(frames)
  const bufB = new Float32Array(NB), bufT = new Float32Array(NT)
  const magB = new Float32Array(NB / 2 + 1), magT = new Float32Array(NT / 2 + 1)
  const pb = new Float32Array(P), pt = new Float32Array(P)
  const HARM: [number, number][] = [] // 배음은 코드 템플릿에서 모델링 (억제 시 실제 기타 보이싱의 5도가 손실됨)
  const process = (pitch: Float32Array, lo: number) => {
    // 배음 억제 (선형 파워 영역)
    for (let p = lo; p < P; p++) {
      const v = pitch[p]
      if (v <= 0) continue
      for (const [off, a] of HARM) if (p + off < P) pitch[p + off] = Math.max(0, pitch[p + off] - a * v)
    }
    for (let p = 0; p < P; p++) pitch[p] = Math.log1p(pitch[p] * 10)
    // 화이트닝: 반음 축 국소 평균(±6) 차감
    const wh = new Float32Array(P)
    for (let p = 0; p < P; p++) {
      let s2 = 0, c = 0
      for (let q = Math.max(0, p - 6); q <= Math.min(P - 1, p + 6); q++) { s2 += pitch[q]; c++ }
      wh[p] = Math.max(0, pitch[p] - s2 / c)
    }
    return wh
  }
  {
    tuneAcc = { s: 0, c: 0 }
    const step = Math.max(1, Math.floor(frames / 120))
    for (let f = 0; f < frames; f += step) {
      const c = f * hop + NB / 2
      for (let i = 0; i < NT; i++) bufT[i] = (x[c - NT / 2 + i] || 0) * wT[i]
      fftT.magnitude(bufT, magT)
      addPeaks(magT, NT, 150, 2000, pt, 1, MIDI_HI)
    }
    tuning = Math.atan2(tuneAcc.s, tuneAcc.c) / (2 * Math.PI) // -0.5..0.5 반음
    tuneAcc = null
  }
  for (let f = 0; f < frames; f++) {
    const c = f * hop + NB / 2 // 두 창 모두 같은 중심
    for (let i = 0; i < NB; i++) bufB[i] = (x[c - NB / 2 + i] || 0) * wB[i]
    for (let i = 0; i < NT; i++) bufT[i] = (x[c - NT / 2 + i] || 0) * wT[i]
    fftB.magnitude(bufB, magB)
    fftT.magnitude(bufT, magT)
    pb.fill(0); pt.fill(0)
    addPeaks(magB, NB, 38, 300, pb, 1, MIDI_HI)
    addPeaks(magB, NB, 120, 262, pt, 1, SPLIT - 1) // C4 미만 트레블은 긴 창(주파수 해상도) 사용
    addPeaks(magT, NT, 255, 5000, pt, 4, MIDI_HI)
    let en = 0
    for (let p = 0; p < P; p++) en += Math.log1p((pb[p] + pt[p]) * 10)
    energy[f] = en / P
    const whB = process(pb, 0)
    const whT = process(pt, 0)
    const tr = new Float32Array(12)
    const bs = new Float32Array(12)
    for (let p = 0; p < P; p++) {
      const midi = p + MIDI_LO
      const pc = midi % 12
      if (midi <= 54) bs[pc] += whB[p] * (midi <= 47 ? 1.0 : 0.6)
      if (midi >= 48 && midi <= 96) tr[pc] += whT[p] * (midi > 84 ? 0.5 : 1)
    }
    treble.push(tr)
    bass.push(bs)
    if (progress && f % 200 === 0) progress(f / frames)
  }
  return { fps: sr / hop, hop, offset: NB / 2 / sr, treble, bass, energy, tuning }
}
