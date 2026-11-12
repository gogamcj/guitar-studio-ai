import { QUALITIES, chordLabel, useFlats } from '../lib/music'

// Krumhansl-Kessler / Temperley 혼합 프로파일
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const TP_MAJ = [5, 2, 3.5, 2, 4.5, 4, 2, 4.5, 2, 3.5, 1.5, 4]
const TP_MIN = [5, 2, 3.5, 4.5, 2, 4, 2, 4.5, 3.5, 2, 1.5, 4]
const PROF_MAJ = KK_MAJ.map((v, i) => v + TP_MAJ[i])
const PROF_MIN = KK_MIN.map((v, i) => v + TP_MIN[i])

function corr(a: ArrayLike<number>, b: ArrayLike<number>, shift: number) {
  let ma = 0, mb = 0
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i] }
  ma /= 12; mb /= 12
  let num = 0, da = 0, db = 0
  for (let i = 0; i < 12; i++) {
    const x = a[(i + shift) % 12] - ma
    const y = b[i] - mb
    num += x * y; da += x * x; db += y * y
  }
  return num / (Math.sqrt(da * db) || 1)
}

export interface KeyScore { tonic: number; mode: 'major' | 'minor'; score: number }

export function keyScores(raw: ArrayLike<number>): KeyScore[] {
  // 3배음(5도 위) 성분 보정: 각 음의 배음이 만드는 "5도 위 조" 편향 제거
  const chroma = new Float32Array(12)
  for (let p = 0; p < 12; p++) chroma[p] = Math.max(0, raw[p] - 0.3 * raw[(p + 5) % 12])
  const out: KeyScore[] = []
  for (let t = 0; t < 12; t++) {
    out.push({ tonic: t, mode: 'major', score: corr(chroma, PROF_MAJ, t) })
    out.push({ tonic: t, mode: 'minor', score: corr(chroma, PROF_MIN, t) })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** 프레임 크로마를 비트 구간별로 집계 (중앙값 → 드럼 등 순간 잡음에 강함) */
export function beatSync(frames: Float32Array[], frameTime: (i: number) => number, bounds: number[], margin = 0): Float32Array[] {
  // margin: 비트 구간 양 끝에서 제외할 비율 (긴 분석창이 이웃 코드와 섞이는 것 방지)
  const out: Float32Array[] = []
  let fi = 0
  for (let b = 0; b + 1 < bounds.length; b++) {
    const d = bounds[b + 1] - bounds[b]
    const s = bounds[b] + d * margin, e = bounds[b + 1] - d * margin
    while (fi < frames.length && frameTime(fi) < s) fi++
    const idx: number[] = []
    let j = fi
    while (j < frames.length && frameTime(j) < e) { idx.push(j); j++ }
    if (!idx.length) {
      // 가장 가까운 프레임
      const k = Math.min(frames.length - 1, Math.max(0, fi))
      idx.push(k)
    }
    const v = new Float32Array(12)
    for (let p = 0; p < 12; p++) {
      const vals = idx.map((i) => frames[i][p]).sort((a, c) => a - c)
      const m = vals.length
      // 중앙값과 평균의 혼합
      const med = m % 2 ? vals[(m - 1) / 2] : (vals[m / 2 - 1] + vals[m / 2]) / 2
      let mean = 0
      for (const x of vals) mean += x
      v[p] = 0.5 * med + 0.5 * (mean / m)
    }
    out.push(v)
  }
  return out
}

interface ChordState { root: number; q: string; tmpl: Float32Array; tones: Set<number>; prior: number }

function buildStates(): ChordState[] {
  const states: ChordState[] = []
  const toneW = [1.0, 0.85, 0.8, 0.6, 0.5]
  // 품질별 사전 선호(단순 코드 선호, 확장 코드는 증거가 충분할 때만)
  const qPrior: Record<string, number> = { maj: 0, min: 0, '7': -0.025, maj7: -0.04, min7: -0.025, sus2: -0.1, sus4: -0.1, add9: -0.11, dim: -0.12, aug: -0.15, hdim7: -0.12, min6: -0.13, '6': -0.13, '5': -0.12 }
  for (let r = 0; r < 12; r++) {
    for (const q of QUALITIES) {
      const t = new Float32Array(12)
      // 근음, 3도, 5도, 7도 순서의 가중
      const order = [...q.iv]
      // 각 구성음의 배음(3배음=5도 위, 5배음=장3도 위)까지 템플릿에 포함
      order.forEach((iv, k) => {
        const w = toneW[Math.min(k, toneW.length - 1)]
        const pc = (r + iv) % 12
        t[pc] += w
        t[(pc + 7) % 12] += 0.3 * w
        t[(pc + 4) % 12] += 0.1 * w
      })
      states.push({ root: r, q: q.q, tmpl: t, tones: new Set(q.iv.map((iv) => (r + iv) % 12)), prior: qPrior[q.q] ?? -0.1 })
    }
  }
  return states
}

function cosine(a: Float32Array, b: Float32Array) {
  let num = 0, da = 0, db = 0
  for (let i = 0; i < 12; i++) { num += a[i] * b[i]; da += a[i] * a[i]; db += b[i] * b[i] }
  return num / (Math.sqrt(da * db) || 1)
}

export interface ChordBeatResult {
  root: number
  quality: string
  bass: number
  confidence: number
}

/**
 * 비트 동기 HMM 코드 인식.
 * - 관측: 트레블 크로마 코사인 유사도 + 베이스 크로마의 근음/구성음 증거
 * - 전이: 마디 첫 박에서는 코드 변화 허용, 박 중간에서는 억제
 * - Key 사전: 다이아토닉 코드 소폭 가산
 * - 신뢰도: forward-backward 사후확률
 */
export function recognizeChords(
  treble: Float32Array[],
  bass: Float32Array[],
  energy: number[],
  beatInBar: number[],
  key: { tonic: number; mode: 'major' | 'minor' } | null,
  meter: number,
): ChordBeatResult[] {
  const states = buildStates()
  const S = states.length + 1 // + N(무코드)
  const T = treble.length
  if (!T) return []
  const maxE = Math.max(1e-9, ...energy)
  const diat = new Set<number>()
  if (key) {
    const sc = key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10, 11]
    sc.forEach((s) => diat.add((key.tonic + s) % 12))
  }
  const kappa = 14
  const logE: Float32Array[] = []
  for (let t = 0; t < T; t++) {
    const tr = treble[t], bs = bass[t]
    let bsum = 0
    for (let i = 0; i < 12; i++) bsum += bs[i]
    const bn = Float32Array.from(bs, (v) => v / (bsum || 1))
    const row = new Float32Array(S)
    for (let s = 0; s < states.length; s++) {
      const st = states[s]
      let sc = cosine(tr, st.tmpl) + st.prior
      // 베이스: 근음이면 강한 증거, 다른 구성음이면 약한 증거(전위), 비구성음이면 감점
      sc += 0.35 * bn[st.root]
      let nonTone = 0
      for (let p = 0; p < 12; p++) {
        if (!st.tones.has(p)) nonTone += bn[p]
        else if (p !== st.root) sc += 0.12 * bn[p] // 전위(슬래시 코드) 베이스
      }
      sc -= 0.15 * nonTone
      if (key) {
        let inKey = 0
        st.tones.forEach((p) => { if (diat.has(p)) inKey++ })
        sc += 0.04 * (inKey / st.tones.size)
      }
      row[s] = kappa * sc
    }
    // N: 에너지가 낮을수록 가능성 증가
    const rel = energy[t] / maxE
    row[S - 1] = kappa * (rel < 0.15 ? 1.2 : 0.2)
    logE.push(row)
  }
  // 전이 로그확률
  const stayDown = Math.log(0.6), changeDown = Math.log(0.4 / (S - 1))
  const stayMid = Math.log(0.93), changeMid = Math.log(0.07 / (S - 1))
  const halfBar = meter % 2 === 0 ? meter / 2 + 1 : -1
  const trans = (t: number) => {
    const b = beatInBar[t]
    if (b === 1) return [stayDown, changeDown]
    if (b === halfBar) return [Math.log(0.8), Math.log(0.2 / (S - 1))]
    return [stayMid, changeMid]
  }
  // Viterbi (전이가 stay/change 2값이므로 O(T*S))
  let dp = Float32Array.from(logE[0])
  const back: Int16Array[] = []
  for (let t = 1; t < T; t++) {
    const [st, ch] = trans(t)
    let bi = 0
    for (let s = 1; s < S; s++) if (dp[s] > dp[bi]) bi = s
    const nd = new Float32Array(S)
    const bk = new Int16Array(S)
    for (let s = 0; s < S; s++) {
      const vs = dp[s] + st, vc = dp[bi] + ch
      if (vs >= vc) { nd[s] = vs + logE[t][s]; bk[s] = s } else { nd[s] = vc + logE[t][s]; bk[s] = bi }
    }
    back.push(bk)
    dp = nd
  }
  let cur = 0
  for (let s = 1; s < S; s++) if (dp[s] > dp[cur]) cur = s
  const path = new Int16Array(T)
  path[T - 1] = cur
  for (let t = T - 2; t >= 0; t--) { cur = back[t][cur]; path[t] = cur }
  // Forward-backward (로그 영역) → 사후확률
  const lse = (arr: Float32Array) => { let m = -Infinity; for (const v of arr) if (v > m) m = v; let s = 0; for (const v of arr) s += Math.exp(v - m); return m + Math.log(s) }
  const fw: Float32Array[] = [Float32Array.from(logE[0])]
  for (let t = 1; t < T; t++) {
    const [st, ch] = trans(t)
    const prev = fw[t - 1]
    const tot = lse(prev)
    const row = new Float32Array(S)
    for (let s = 0; s < S; s++) {
      // log(exp(prev[s]+st) + sum_{k!=s} exp(prev[k]+ch)) ≈ logaddexp(prev[s]+st, tot+ch)
      const a = prev[s] + st, b = tot + ch
      const m = Math.max(a, b)
      row[s] = m + Math.log(Math.exp(a - m) + Math.exp(b - m)) + logE[t][s]
    }
    const z = lse(row)
    for (let s = 0; s < S; s++) row[s] -= z
    fw.push(row)
  }
  const bw: Float32Array[] = new Array(T)
  bw[T - 1] = new Float32Array(S)
  for (let t = T - 2; t >= 0; t--) {
    const [st, ch] = trans(t + 1)
    const nx = bw[t + 1]
    const tmp = new Float32Array(S)
    for (let s = 0; s < S; s++) tmp[s] = nx[s] + logE[t + 1][s]
    const tot = lse(tmp)
    const row = new Float32Array(S)
    for (let s = 0; s < S; s++) {
      const a = tmp[s] + st, b = tot + ch
      const m = Math.max(a, b)
      row[s] = m + Math.log(Math.exp(a - m) + Math.exp(b - m))
    }
    const z = lse(row)
    for (let s = 0; s < S; s++) row[s] -= z
    bw[t] = row
  }
  const out: ChordBeatResult[] = []
  for (let t = 0; t < T; t++) {
    const s = path[t]
    const post = new Float32Array(S)
    for (let k = 0; k < S; k++) post[k] = fw[t][k] + bw[t][k]
    const z = lse(post)
    const p = Math.exp(post[s] - z)
    if (s === S - 1) { out.push({ root: -1, quality: 'N', bass: -1, confidence: p }); continue }
    const st = states[s]
    // 같은 근음 그룹(예: C, Cmaj7, Cadd9)의 확률 합 = "근음 신뢰도"
    let rootP = 0
    for (let k = 0; k < states.length; k++) if (states[k].root === st.root) rootP += Math.exp(post[k] - z)
    // 베이스 음: 베이스 크로마 최대값이 코드 구성음이면 전위로 표시
    const bs = bass[t]
    let bmax = 0
    for (let i = 1; i < 12; i++) if (bs[i] > bs[bmax]) bmax = i
    let bsum = 0
    for (let i = 0; i < 12; i++) bsum += bs[i]
    const bassStrong = bsum > 0 && bs[bmax] / bsum > 0.3
    const bassNote = bassStrong && st.tones.has(bmax) ? bmax : st.root
    out.push({ root: st.root, quality: st.q, bass: bassNote, confidence: 0.5 * p + 0.5 * rootP })
  }
  return out
}

const MINORISH = new Set(['min', 'min7', 'min6', 'hdim7', 'dim'])

/**
 * Key 결정 (2단계)
 * 1) 조표(다이아토닉 집합): 상대 장·단조 쌍의 프로파일 점수 최대값
 * 2) 장/단 판정: 토닉 코드 지속시간, 첫/끝 코드, 베이스 토닉 비중, 화성단음계 V(예: Am 의 E) 사용
 */
export function decideKey(chroma: ArrayLike<number>, chords: { root: number; quality: string; dur: number }[], bassTotal: ArrayLike<number>) {
  const ks = keyScores(chroma)
  const sc = (t: number, m: 'major' | 'minor') => ks.find((k) => k.tonic === t && k.mode === m)!.score
  const sets = Array.from({ length: 12 }, (_, t) => ({ t, s: Math.max(sc(t, 'major'), sc((t + 9) % 12, 'minor')) })).sort((a, b) => b.s - a.s)
  const t = sets[0].t
  const rm = (t + 9) % 12
  const total = chords.reduce((s2, c) => s2 + c.dur, 0) || 1
  let durI = 0, durIm = 0, durVm = 0
  for (const c of chords) {
    const minor = MINORISH.has(c.quality)
    if (c.root === t && !minor) durI += c.dur
    if (c.root === rm && minor) durIm += c.dur
    if (c.root === (rm + 7) % 12 && !minor) durVm += c.dur
  }
  const voiced = chords.filter((c) => c.root >= 0)
  const first = voiced[0], last = voiced[voiced.length - 1]
  const is = (c: typeof first | undefined, r: number, minor: boolean) => !!c && c.root === r && MINORISH.has(c.quality) === minor
  let bsum = 0
  for (let i = 0; i < 12; i++) bsum += bassTotal[i]
  const bf = (pc: number) => (bsum ? bassTotal[pc] / bsum : 0)
  const maj = durI / total + 0.3 * +is(first, t, false) + 0.2 * +is(last, t, false) + 0.3 * bf(t) + 0.5 * sc(t, 'major')
  const min = durIm / total + 0.3 * +is(first, rm, true) + 0.2 * +is(last, rm, true) + 0.3 * bf(rm) + 0.5 * sc(rm, 'minor') + (durVm / total > 0.03 ? 0.15 : 0)
  const setConf = Math.max(0, Math.min(1, (sets[0].s - sets[1].s) / 0.12))
  const modeConf = Math.max(0, Math.min(1, Math.abs(maj - min) / 0.25))
  const key = maj >= min ? { tonic: t, mode: 'major' as const } : { tonic: rm, mode: 'minor' as const }
  return { key, confidence: 0.25 + 0.7 * setConf * (0.4 + 0.6 * modeConf), setChanged: false }
}

export function labelFor(root: number, quality: string, bass: number, key: { tonic: number; mode: 'major' | 'minor' } | null) {
  return chordLabel(root, quality, bass, key ? useFlats(key.tonic, key.mode) : false)
}
