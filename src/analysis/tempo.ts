import type { OnsetFeatures } from './features'

export interface TempoResult {
  bpm: number // 전역(대표) 템포
  confidence: number
  periodCurve: Float32Array // 프레임별 비트 주기(프레임 단위)
  candidates: { bpm: number; score: number }[]
}

const MIN_BPM = 40, MAX_BPM = 260

/** 구간 자기상관 */
function autocorr(e: Float32Array, start: number, end: number, maxLag: number) {
  const ac = new Float32Array(maxLag + 1)
  const n = end - start
  for (let lag = 1; lag <= maxLag; lag++) {
    let s = 0
    for (let i = start + lag; i < end; i++) s += e[i] * e[i - lag]
    ac[lag] = s / Math.max(1, n - lag)
  }
  return ac
}

/** 템포 사전분포: log2 축 가우시안, 중심 115 BPM. 하프/더블 오인식 방지의 기본 */
function prior(bpm: number) {
  const z = Math.log2(bpm / 115) / 0.9
  return Math.exp(-0.5 * z * z)
}

/** 메트릭 콤 점수: 주기 L 의 정수배/분수배까지 함께 반영 */
function combScore(ac: Float32Array, L: number) {
  const at = (x: number) => {
    const i = Math.floor(x), f = x - i
    if (i + 1 >= ac.length || i < 1) return 0
    return ac[i] * (1 - f) + ac[i + 1] * f
  }
  let s = at(L) + 0.5 * at(2 * L) + 0.33 * at(3 * L) + 0.25 * at(4 * L)
  // 정밀: 근방 최대
  return s
}

export function estimateTempo(on: OnsetFeatures): TempoResult {
  const e = on.env
  const fps = on.fps
  const minLag = Math.floor((60 * fps) / MAX_BPM)
  const maxLag = Math.ceil((60 * fps) / MIN_BPM)
  // 1) 전역 템포: 전체 자기상관 + 콤 + 사전분포
  const ac = autocorr(e, 0, e.length, maxLag * 4 + 2)
  const scores: { lag: number; s: number }[] = []
  for (let L = minLag; L <= maxLag; L += 0.25) {
    const bpm = (60 * fps) / L
    scores.push({ lag: L, s: combScore(ac, L) * prior(bpm) })
  }
  scores.sort((a, b) => b.s - a.s)
  // 후보 추출(서로 3% 이상 차이)
  const cand: { bpm: number; score: number }[] = []
  for (const c of scores) {
    const bpm = (60 * fps) / c.lag
    if (cand.every((x) => Math.abs(x.bpm - bpm) / bpm > 0.03)) cand.push({ bpm, score: c.s })
    if (cand.length >= 6) break
  }
  let best = cand[0]
  // 하프/더블 판정: 2배/절반 후보가 근접 점수면 밴드별 증거(하이햇 8분음표 등)로 결정
  for (const alt of cand.slice(1)) {
    const r = alt.bpm / best.bpm
    const isOctave = Math.abs(r - 2) < 0.06 || Math.abs(r - 0.5) < 0.03
    if (isOctave && alt.score > best.score * 0.6) {
      // 킥→스네어 간격이 "1박"이 되는 쪽을 박으로 선택 (백비트 원리)
      const fast = best.bpm > alt.bpm ? best : alt
      const slow = fast === best ? alt : best
      const Lf = (60 * fps) / fast.bpm
      let ml = 0, mm = 0
      for (let i = 0; i < e.length; i++) { ml += on.low[i]; mm += on.mid[i] }
      ml /= e.length; mm /= e.length
      const xc = (lag: number) => {
        let m = -Infinity
        for (let d = -1; d <= 1; d++) {
          const l = Math.round(lag) + d
          let s2 = 0
          for (let i = 0; i + l < e.length; i++) s2 += (on.low[i] - ml) * (on.mid[i + l] - mm)
          m = Math.max(m, s2)
        }
        return m
      }
      const cf = xc(Lf) + xc(3 * Lf)
      const cs = xc(2 * Lf) + xc(4 * Lf)
      const sc = Math.abs(cf) + Math.abs(cs) || 1
      if ((globalThis as any).GS_DEBUG) console.log('octave', fast.bpm.toFixed(1), slow.bpm.toFixed(1), cf.toFixed(1), cs.toFixed(1), cand.map((c) => c.bpm.toFixed(1) + ':' + c.score.toFixed(3)).join(' '))
      if ((cf - cs) / sc > 0.1) best = fast
      else if ((cs - cf) / sc > 0.1) best = slow
      break
    }
  }
  const second = cand.find((c) => c !== best)
  const conf = second ? Math.max(0, Math.min(1, 1 - second.score / best.score)) : 0.5
  // 2) 국소 템포 곡선: 8초 창 템포그램을 Viterbi 로 연결 (템포 변화 추적)
  const periodCurve = localTempoCurve(e, fps, (60 * fps) / best.bpm)
  return { bpm: best.bpm, confidence: 0.35 + 0.65 * conf, periodCurve, candidates: cand }
}

function localTempoCurve(e: Float32Array, fps: number, P0: number) {
  const win = Math.round(fps * 8)
  const hop = Math.round(fps * 1)
  const n = e.length
  const nWin = Math.max(1, Math.floor((n - win) / hop) + 1)
  // 후보 주기: 전역 주기 ±30% 범위 (옥타브 점프 방지)
  const lags: number[] = []
  for (let L = P0 * 0.7; L <= P0 * 1.3; L += 0.25) lags.push(L)
  const maxLag = Math.ceil(P0 * 1.3 * 2) + 2
  const S: Float32Array[] = []
  for (let w = 0; w < nWin; w++) {
    const st = w * hop, en = Math.min(n, st + win)
    const ac = autocorr(e, st, en, maxLag)
    const row = new Float32Array(lags.length)
    let mx = 1e-9
    for (let j = 0; j < lags.length; j++) {
      const L = lags[j]
      const i = Math.floor(L), f = L - i
      const a1 = ac[i] * (1 - f) + ac[i + 1] * f
      const L2 = 2 * L, i2 = Math.floor(L2), f2 = L2 - i2
      const a2 = i2 + 1 < ac.length ? ac[i2] * (1 - f2) + ac[i2 + 1] * f2 : 0
      row[j] = Math.max(0, a1 + 0.5 * a2)
      if (row[j] > mx) mx = row[j]
    }
    for (let j = 0; j < lags.length; j++) row[j] /= mx
    S.push(row)
  }
  // Viterbi: 점수 + 템포 변화 패널티
  const J = lags.length
  let dp = Float32Array.from(S[0], (v, j) => v - 0.5 * Math.abs(Math.log(lags[j] / P0)))
  const back: Int16Array[] = []
  for (let w = 1; w < nWin; w++) {
    const nd = new Float32Array(J)
    const bk = new Int16Array(J)
    for (let j = 0; j < J; j++) {
      let bv = -Infinity, bi = 0
      for (let k = Math.max(0, j - 12); k <= Math.min(J - 1, j + 12); k++) {
        const v = dp[k] - 8 * Math.abs(Math.log(lags[j] / lags[k]))
        if (v > bv) { bv = v; bi = k }
      }
      nd[j] = bv + S[w][j]
      bk[j] = bi
    }
    back.push(bk)
    dp = nd
  }
  let j = 0
  for (let k = 1; k < J; k++) if (dp[k] > dp[j]) j = k
  const path = new Int16Array(nWin)
  path[nWin - 1] = j
  for (let w = nWin - 2; w >= 0; w--) { j = back[w][j]; path[w] = j }
  // 프레임별 주기 (창 중심 기준 선형 보간)
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const wpos = (i - win / 2) / hop
    const w0 = Math.max(0, Math.min(nWin - 1, Math.floor(wpos)))
    const w1 = Math.min(nWin - 1, w0 + 1)
    const f = Math.max(0, Math.min(1, wpos - w0))
    curve[i] = lags[path[w0]] * (1 - f) + lags[path[w1]] * f
  }
  return curve
}

/** Ellis 동적계획 비트 트래킹 (국소 주기 곡선 사용 → 템포 변화 대응). 반환: 비트 프레임 위치(소수) */
export function trackBeats(on: OnsetFeatures, period: Float32Array, tightness = 120): number[] {
  const e = on.env
  const n = e.length
  // 온셋 엔벨로프를 약간 평활
  const o = new Float32Array(n)
  for (let i = 0; i < n; i++) o[i] = (e[i - 1] || 0) * 0.25 + e[i] * 0.5 + (e[i + 1] || 0) * 0.25
  const score = new Float32Array(n)
  const back = new Int32Array(n).fill(-1)
  for (let t = 0; t < n; t++) {
    const P = period[t]
    const lo = Math.max(0, Math.floor(t - 2 * P)), hi = Math.floor(t - P / 2)
    let bv = 0, bi = -1
    for (let tau = lo; tau <= hi; tau++) {
      const r = Math.log((t - tau) / P)
      const v = score[tau] - tightness * r * r
      if (v > bv || bi < 0) { bv = v; bi = tau }
    }
    score[t] = o[t] + (bi >= 0 ? Math.max(0, bv) : 0)
    back[t] = bi >= 0 && bv > 0 ? bi : -1
  }
  // 끝 부분 근처 최고점에서 역추적
  const tail = Math.max(0, n - Math.round(period[n - 1] * 2))
  let end = tail
  for (let t = tail; t < n; t++) if (score[t] > score[end]) end = t
  const beats: number[] = []
  let t = end
  while (t >= 0) { beats.push(t); t = back[t] }
  beats.reverse()
  // 시작/끝 무음 구간 비트 제거
  const thr = 0.1
  const local = (b: number) => {
    let m = 0
    for (let i = Math.max(0, b - 3); i <= Math.min(n - 1, b + 3); i++) m = Math.max(m, on.rms[i])
    return m
  }
  let maxR = 0
  for (let i = 0; i < n; i++) maxR = Math.max(maxR, on.rms[i])
  const trimmed = beats.filter((b) => local(b) > maxR * thr * 0.2)
  // 포물선 보간으로 서브프레임 정밀화
  return trimmed.map((b) => {
    if (b <= 0 || b >= n - 1) return b
    const y0 = o[b - 1], y1 = o[b], y2 = o[b + 1]
    const den = y0 - 2 * y1 + y2
    if (y1 >= y0 && y1 >= y2 && den < 0) return b + 0.5 * (y0 - y2) / den
    return b
  })
}

/** 비트 간격으로 구간별 BPM, 안정성 판정 */
export function tempoSegments(beatTimes: number[], barLen: number) {
  const segs: { start: number; end: number; bpm: number }[] = []
  const step = Math.max(4, barLen * 4) // 4마디 단위
  for (let i = 0; i + 1 < beatTimes.length; i += step) {
    const j = Math.min(beatTimes.length - 1, i + step)
    if (j - i < 2) break
    const bpm = regressBpm(beatTimes.slice(i, j + 1))
    segs.push({ start: beatTimes[i], end: beatTimes[j], bpm })
  }
  const bpms = segs.map((s) => s.bpm).sort((a, b) => a - b)
  const med = bpms[Math.floor(bpms.length / 2)] || 0
  const maxDev = segs.reduce((m, s) => Math.max(m, Math.abs(s.bpm - med) / (med || 1)), 0)
  // 마지막 구간이 너무 짧은 경우 등 이상치 하나는 허용
  const devs = segs.map((s) => Math.abs(s.bpm - med) / (med || 1)).sort((a, b) => b - a)
  const stable = (devs[1] ?? devs[0] ?? 0) < 0.025 && maxDev < 0.08
  return { segs, stable, median: med }
}

/** 최소제곱으로 비트 간격 → 소수점 BPM */
export function regressBpm(times: number[]) {
  const n = times.length
  if (n < 2) return 0
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) { sx += i; sy += times[i]; sxx += i * i; sxy += i * times[i] }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
  return 60 / slope
}

export interface MeterResult {
  meter: number
  phase: number // 첫 다운비트의 비트 인덱스 (0..meter-1)
  confidence: number
  scores: Record<number, number>
}

/**
 * 박자표/다운비트 추정.
 * 특징: 비트별 저역(킥) 온셋, 화성 변화량(크로마 차이), 전체 온셋.
 * 마디 주기 M 과 위상 φ 에 대해 "다운비트 위치 특징 평균 - 나머지 평균" 을 비교.
 */
export function estimateMeter(lowAtBeat: Float32Array, harmChange: Float32Array, accentAtBeat: Float32Array): MeterResult {
  const n = lowAtBeat.length
  const z = (a: Float32Array) => {
    let m = 0, s = 0
    for (const v of a) m += v
    m /= a.length || 1
    for (const v of a) s += (v - m) ** 2
    s = Math.sqrt(s / (a.length || 1)) || 1
    return Float32Array.from(a, (v) => (v - m) / s)
  }
  const L = z(lowAtBeat), H = z(harmChange), A = z(accentAtBeat)
  const feat = new Float32Array(n)
  for (let i = 0; i < n; i++) feat[i] = 0.35 * L[i] + 0.45 * H[i] + 0.2 * A[i]
  // 단일 M 점수
  const phaseScore = (M: number) => {
    let bestM = -Infinity, bestPh = 0
    for (let ph = 0; ph < M; ph++) {
      let sd = 0, cd = 0, so = 0, co = 0
      for (let i = 0; i < n; i++) {
        if ((i - ph + M * 1000) % M === 0) { sd += feat[i]; cd++ } else { so += feat[i]; co++ }
      }
      const s = (cd ? sd / cd : 0) - (co ? so / co : 0)
      if (s > bestM) { bestM = s; bestPh = ph }
    }
    let rep = 0, c = 0
    for (let i = M; i < n; i++) { rep += H[i] * H[i - M] + L[i] * L[i - M]; c++ }
    rep = c ? rep / c / 2 : 0
    return { s: bestM + 0.3 * rep, ph: bestPh }
  }
  const r: Record<number, { s: number; ph: number }> = {}
  for (const M of [2, 3, 4, 5, 6, 8]) r[M] = phaseScore(M)
  // 계열별 비교: 2·4·8 → 4박 계열, 3·6 → 3박 계열, 5 → 5박
  // (화성 리듬이 2마디 단위로 반복되면 6·8 이 높게 나오므로 계열 최대값으로 비교)
  const fam4 = Math.max(r[2].s, r[4].s, r[8].s) + 0.08
  const fam3 = Math.max(r[3].s, r[6].s)
  const fam5 = r[5].s - 0.2
  const scores: Record<number, number> = { 4: fam4, 3: fam3, 5: fam5 }
  let meter = 4
  if (fam3 > fam4 && fam3 > fam5) meter = 3
  else if (fam5 > fam4 && fam5 > fam3) meter = 5
  let phase = r[meter].ph
  if (meter === 4) {
    // 4/4 다운비트 위상: M=4 의 위상 사용 (2박 위상과 일관)
    phase = r[4].ph
  }
  if (meter === 3) {
    // 6/8 판정: 저역(킥)이 6박마다만 강하고 그 중간(4번째)에는 약하면 6/8
    const ph6 = r[6].ph
    let a = 0, b = 0, ca = 0, cb = 0
    for (let i = 0; i < n; i++) {
      const k = (i - ph6 + 6000) % 6
      if (k === 0) { a += lowAtBeat[i]; ca++ } else if (k === 3) { b += lowAtBeat[i]; cb++ }
    }
    a /= ca || 1; b /= cb || 1
    if (a > 1.6 * b) { meter = 6; phase = ph6 }
  }
  const sorted = Object.values(scores).sort((x, y) => y - x)
  const margin = sorted[0] - sorted[1]
  return { meter, phase, confidence: Math.max(0.2, Math.min(0.95, 0.4 + margin * 1.5)), scores }
}

/**
 * 더블타임 검사: 현재 비트 사이 중간점(엇박)의 킥/스네어/스트럼 온셋이 정박만큼 강하면
 * 실제 박은 2배 빠른 것으로 판단 (하이햇 8분음표는 제외하기 위해 저·중역만 사용)
 */
export function shouldDouble(on: OnsetFeatures, beatFrames: number[], bpm: number) {
  if (bpm * 2 > 210 || beatFrames.length < 8) return false
  const ks = (i: number) => {
    let m = 0
    for (let k = Math.round(i) - 1; k <= Math.round(i) + 1; k++) m = Math.max(m, (on.low[k] || 0) + (on.mid[k] || 0))
    return m
  }
  let sb = 0, sm = 0
  for (let i = 0; i + 1 < beatFrames.length; i++) { sb += ks(beatFrames[i]); sm += ks((beatFrames[i] + beatFrames[i + 1]) / 2) }
  return sm > 0.7 * sb
}
