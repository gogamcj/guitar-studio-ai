import type { Analysis, Beat, ChordSegment, KeySegment } from '../types'
import { ANALYSIS_SR, onsetFeatures, pitchFeatures, resample } from './features'
import { estimateMeter, estimateTempo, regressBpm, shouldDouble, tempoSegments, trackBeats } from './tempo'
import { beatSync, decideKey, keyScores, labelFor, recognizeChords } from './harmony'
import { estimateSections } from './structure'

export const ANALYSIS_VERSION = 1
/** 온셋 엔벨로프 피크와 실제 어택 사이의 지연 보정(초). tests/analysis.test.ts 의 합성 음원으로 측정한 값 */
export const ONSET_LAG = 0.0112

export interface AnalyzeOptions {
  quality: 'fast' | 'accurate'
  trackId: string
}

export type Progress = (p: number, stage: string) => void

export function analyze(mono: Float32Array, sr: number, opts: AnalyzeOptions, progress: Progress = () => {}): Analysis {
  const duration = mono.length / sr
  progress(0.01, 'resample')
  const x = resample(mono, sr, ANALYSIS_SR)
  progress(0.05, 'onset')
  const on = onsetFeatures(x, ANALYSIS_SR, (p) => progress(0.05 + 0.25 * p, 'onset'))
  progress(0.3, 'tempo')
  const tempo = estimateTempo(on)
  let beatFrames = trackBeats(on, tempo.periodCurve)
  if (shouldDouble(on, beatFrames, tempo.bpm)) {
    tempo.bpm *= 2
    tempo.periodCurve = tempo.periodCurve.map((v) => v / 2)
    beatFrames = trackBeats(on, tempo.periodCurve)
  }
  const toTime = (f: number) => f / on.fps + on.offset + ONSET_LAG
  const beatTimes = beatFrames.map(toTime).filter((t) => t >= 0 && t < duration)
  progress(0.45, 'pitch')
  const pf = pitchFeatures(x, ANALYSIS_SR, opts.quality, (p) => progress(0.45 + 0.3 * p, 'pitch'))
  const frameTime = (i: number) => (i * pf.hop) / ANALYSIS_SR + pf.offset
  progress(0.76, 'meter')

  // 비트 동기 특징
  const bounds = [...beatTimes, beatTimes.length ? beatTimes[beatTimes.length - 1] + (beatTimes.length > 1 ? beatTimes[beatTimes.length - 1] - beatTimes[beatTimes.length - 2] : 0.5) : duration]
  const trebleB = beatSync(pf.treble, frameTime, bounds, 0.12)
  const bassB = beatSync(pf.bass, frameTime, bounds, 0.25)
  const energyB = beatSync(pf.energy.length ? Array.from(pf.energy, (e) => Float32Array.of(e, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)) : [], frameTime, bounds).map((v) => v[0])
  const nb = beatTimes.length
  const lowAt = new Float32Array(nb), accAt = new Float32Array(nb), harm = new Float32Array(nb)
  for (let i = 0; i < nb; i++) {
    const f = Math.round(beatFrames[i] ?? 0)
    let lo = 0, ac = 0
    for (let k = f - 2; k <= f + 2; k++) { lo = Math.max(lo, on.low[k] || 0); ac = Math.max(ac, on.env[k] || 0) }
    lowAt[i] = lo; accAt[i] = ac
    if (i > 0) {
      const a = trebleB[i], b = trebleB[i - 1], c = bassB[i], d = bassB[i - 1]
      let num = 0, da = 0, db = 0
      for (let p = 0; p < 12; p++) {
        const u = a[p] + c[p], v = b[p] + d[p]
        num += u * v; da += u * u; db += v * v
      }
      harm[i] = 1 - num / (Math.sqrt(da * db) || 1)
    }
  }
  const meter = estimateMeter(lowAt, harm, accAt)
  const M = meter.meter
  const beats: Beat[] = beatTimes.map((t, i) => {
    const k = i - meter.phase
    return { t, bar: Math.floor(k / M) + 1, beat: (((k % M) + M) % M) + 1 }
  })

  // BPM 정밀화 (비트 간격 회귀) + 안정성
  const ts = tempoSegments(beatTimes, M)
  const bpmVal = ts.stable && beatTimes.length > 8 ? regressBpm(beatTimes) : ts.median || tempo.bpm
  // 비트 간격 규칙성 → 신뢰도 보정
  let irr = 0
  for (let i = 2; i < nb; i++) {
    const d1 = beatTimes[i] - beatTimes[i - 1], d2 = beatTimes[i - 1] - beatTimes[i - 2]
    irr += Math.abs(d1 - d2) / ((d1 + d2) / 2)
  }
  irr = nb > 2 ? irr / (nb - 2) : 1
  // 템포 후보 간 우위(옥타브 모호성)와 비트 간격 규칙성을 함께 반영
  const regular = 1 - Math.min(1, irr * 8)
  const bpmConf = Math.max(0.05, Math.min(0.97, 0.45 * tempo.confidence + 0.55 * regular * (ts.stable ? 1 : 0.75)))

  progress(0.82, 'key')
  // 전역 크로마 (에너지 가중)
  const glob = new Float32Array(12)
  for (let i = 0; i < nb; i++) for (let p = 0; p < 12; p++) glob[p] += trebleB[i][p] + 0.5 * bassB[i][p]
  let key: { tonic: number; mode: 'major' | 'minor'; score: number } = keyScores(glob)[0]
  const beatInBar = beats.map((b) => b.beat)
  let chordBeats = recognizeChords(trebleB, bassB, energyB, beatInBar, key, M)
  // 코드 기반 Key 결정
  const bassTot = new Float32Array(12)
  for (let i = 0; i < nb; i++) for (let p = 0; p < 12; p++) bassTot[p] += bassB[i][p]
  const stats = () => chordBeats.map((c, i) => ({ root: c.root, quality: c.quality, dur: (bounds[i + 1] - bounds[i]) || 0 })).filter((c) => c.root >= 0)
  const dk = decideKey(glob, stats(), bassTot)
  const sameSet = (a: { tonic: number; mode: string }, b: { tonic: number; mode: string }) => (a.mode === 'major' ? a.tonic : (a.tonic + 3) % 12) === (b.mode === 'major' ? b.tonic : (b.tonic + 3) % 12)
  if (!sameSet(dk.key, key)) chordBeats = recognizeChords(trebleB, bassB, energyB, beatInBar, dk.key, M)
  key = { ...dk.key, score: 0 }
  const keyConf = dk.confidence

  progress(0.9, 'chords')
  const chords: ChordSegment[] = []
  for (let i = 0; i < chordBeats.length; i++) {
    const c = chordBeats[i]
    const last = chords[chords.length - 1]
    if (last && last.root === c.root && last.quality === c.quality && last.bass === c.bass) {
      last.end = bounds[i + 1]
      ;(last as any)._n++
      ;(last as any)._c += c.confidence
      continue
    }
    chords.push({ start: bounds[i], end: bounds[i + 1], root: c.root, quality: c.quality, bass: c.bass, label: labelFor(c.root, c.quality, c.bass, key), confidence: c.confidence, source: 'ai', _n: 1, _c: c.confidence } as ChordSegment)
  }
  for (const c of chords as any[]) { c.confidence = c._c / c._n; delete c._n; delete c._c }
  if (chords.length && chords[0].start > 0.05) chords.unshift({ start: 0, end: chords[0].start, root: -1, quality: 'N', bass: -1, label: 'N.C.', confidence: 0.5, source: 'ai' })

  // 구간별 Key (16마디 창 + 변화 억제)
  const keySegments = segmentKeys(trebleB, bassB, beats, bounds, key, duration)

  progress(0.95, 'structure')
  const barStarts: number[] = []
  const barChroma: Float32Array[] = []
  const barEnergy: number[] = []
  for (let i = 0; i < nb; i++) {
    if (beats[i].beat === 1 || i === 0) {
      barStarts.push(beats[i].t)
      barChroma.push(new Float32Array(12))
      barEnergy.push(0)
    }
    const bc = barChroma[barChroma.length - 1]
    for (let p = 0; p < 12; p++) bc[p] += trebleB[i][p] + bassB[i][p]
    barEnergy[barEnergy.length - 1] += energyB[i] || 0
  }
  const sections = estimateSections(barStarts, barChroma, barEnergy, duration)
  progress(1, 'done')
  return {
    trackId: opts.trackId,
    version: ANALYSIS_VERSION,
    analyzedAt: Date.now(),
    duration,
    bpm: { value: Math.round(bpmVal * 100) / 100, confidence: bpmConf, source: 'ai' },
    tempoStable: ts.stable,
    tempoSegments: ts.segs.map((s) => ({ ...s, bpm: Math.round(s.bpm * 10) / 10 })),
    meter: { value: M, confidence: meter.confidence, source: 'ai' },
    meterDenominator: M === 6 ? 8 : 4,
    beats,
    key: { value: { tonic: key.tonic, mode: key.mode }, confidence: keyConf, source: 'ai' },
    keySegments,
    chords,
    sections,
    transpose: 0,
    userEdited: false,
  }
}

function segmentKeys(treble: Float32Array[], bass: Float32Array[], beats: Beat[], bounds: number[], global: { tonic: number; mode: 'major' | 'minor' }, duration: number): KeySegment[] {
  const nb = beats.length
  if (nb < 32) return [{ start: 0, end: duration, tonic: global.tonic, mode: global.mode, confidence: 0.5 }]
  // 8박 단위 블록
  const blk = 8
  const nBlk = Math.ceil(nb / blk)
  const keys: { tonic: number; mode: 'major' | 'minor' }[] = []
  for (let t = 0; t < 12; t++) { keys.push({ tonic: t, mode: 'major' }); keys.push({ tonic: t, mode: 'minor' }) }
  const obs: number[][] = []
  for (let b = 0; b < nBlk; b++) {
    // 앞뒤 2블록 포함 창(약 40박)
    const c = new Float32Array(12)
    for (let i = Math.max(0, (b - 2) * blk); i < Math.min(nb, (b + 3) * blk); i++) for (let p = 0; p < 12; p++) c[p] += treble[i][p] + 0.5 * bass[i][p]
    const sc = keyScores(c)
    obs.push(keys.map((k) => sc.find((s) => s.tonic === k.tonic && s.mode === k.mode)!.score))
  }
  const K = keys.length
  const gi = keys.findIndex((k) => k.tonic === global.tonic && k.mode === global.mode)
  let dp = obs[0].map((v, k) => v * 10 + (k === gi ? 1 : 0))
  const back: number[][] = []
  const pen = 4 // 조바꿈 패널티 (거짓 전조 억제)
  for (let b = 1; b < nBlk; b++) {
    let bi = 0
    for (let k = 1; k < K; k++) if (dp[k] > dp[bi]) bi = k
    const nd: number[] = [], bk: number[] = []
    for (let k = 0; k < K; k++) {
      const stay = dp[k], ch = dp[bi] - pen
      if (stay >= ch) { nd.push(stay + obs[b][k] * 10); bk.push(k) } else { nd.push(ch + obs[b][k] * 10); bk.push(bi) }
    }
    back.push(bk)
    dp = nd
  }
  let cur = 0
  for (let k = 1; k < K; k++) if (dp[k] > dp[cur]) cur = k
  const path = new Array(nBlk)
  path[nBlk - 1] = cur
  for (let b = nBlk - 2; b >= 0; b--) { cur = back[b][cur]; path[b] = cur }
  const segs: KeySegment[] = []
  for (let b = 0; b < nBlk; b++) {
    const k = keys[path[b]]
    const st = bounds[b * blk] ?? 0
    const conf = Math.max(0.1, Math.min(0.95, (obs[b][path[b]] - Math.max(...obs[b].filter((_, i) => i !== path[b]))) * 4 + 0.4))
    const last = segs[segs.length - 1]
    if (last && last.tonic === k.tonic && last.mode === k.mode) { last.end = bounds[Math.min(nb, (b + 1) * blk)] ?? duration; last.confidence = (last.confidence + conf) / 2 }
    else segs.push({ start: st, end: bounds[Math.min(nb, (b + 1) * blk)] ?? duration, tonic: k.tonic, mode: k.mode, confidence: conf })
  }
  segs[0].start = 0
  segs[segs.length - 1].end = duration
  return segs
}
