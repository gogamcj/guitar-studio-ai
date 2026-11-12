import { describe, expect, it } from 'vitest'
import { analyze } from '../src/analysis/analyze'
import { synthSong, type SongSpec, type Truth } from './synth'
import { CASES } from './cases'
import { keyName } from '../src/lib/music'
import type { Analysis } from '../src/types'
import { writeFileSync, mkdirSync } from 'node:fs'

export interface Score {
  name: string
  bpmTrue: string
  bpm: number
  bpmOk: boolean
  beatF: number
  beatOffsetMs: number
  meterTrue: number
  meter: number
  downbeatOk: boolean
  keyTrue: string
  key: string
  chordRoot: number
  chordFull: number
  ms: number
}

export function evaluate(a: Analysis, truth: Truth, spec: SongSpec, ms: number): Score {
  // 비트 F-measure (±70ms) 와 평균 오프셋
  const tol = 0.07
  const est = a.beats.map((b) => b.t)
  let hit = 0
  const offs: number[] = []
  const used = new Set<number>()
  for (const tb of truth.beats) {
    let bi = -1, bd = tol
    est.forEach((t, i) => { const d = Math.abs(t - tb.t); if (d <= bd && !used.has(i)) { bd = d; bi = i } })
    if (bi >= 0) { hit++; used.add(bi); offs.push(est[bi] - tb.t) }
  }
  const P = hit / (est.length || 1), R = hit / truth.beats.length
  const F = P + R ? (2 * P * R) / (P + R) : 0
  const off = offs.length ? offs.reduce((s, v) => s + v, 0) / offs.length : NaN
  // 다운비트: 정답 다운비트와 일치하는 추정 비트가 beat===1 인 비율
  let dOk = 0, dN = 0
  for (const tb of truth.beats.filter((b) => b.beat === 1)) {
    const e = a.beats.find((b) => Math.abs(b.t - tb.t) < tol)
    if (e) { dN++; if (e.beat === 1) dOk++ }
  }
  // 코드: 시간 비율 정확도(10ms 격자)
  let rootOk = 0, fullOk = 0, tot = 0
  for (let t = truth.chords[0].start; t < truth.chords[truth.chords.length - 1].end; t += 0.01) {
    const tc = truth.chords.find((c) => t >= c.start && t < c.end)
    const ec = a.chords.find((c) => t >= c.start && t < c.end)
    if (!tc) continue
    tot++
    if (ec && ec.root === tc.root) {
      rootOk++
      if (ec.quality === tc.quality && ec.bass === tc.bass) fullOk++
    }
  }
  const bpmTrue = typeof spec.bpm === 'number' ? spec.bpm : NaN
  const bpmOk = isNaN(bpmTrue) ? !a.tempoStable : Math.abs(a.bpm.value - bpmTrue) / bpmTrue < 0.01
  return {
    name: spec.name,
    bpmTrue: isNaN(bpmTrue) ? 'variable' : String(bpmTrue),
    bpm: a.bpm.value,
    bpmOk,
    beatF: Math.round(F * 1000) / 1000,
    beatOffsetMs: Math.round(off * 10000) / 10,
    meterTrue: spec.meter,
    meter: a.meter.value,
    downbeatOk: dN > 0 && dOk / dN > 0.9,
    keyTrue: keyName(spec.key.tonic, spec.key.mode),
    key: keyName(a.key.value.tonic, a.key.value.mode),
    chordRoot: Math.round((rootOk / tot) * 1000) / 10,
    chordFull: Math.round((fullOk / tot) * 1000) / 10,
    ms,
  }
}

describe('분석 정확도 (정답이 알려진 합성 음원)', () => {
  const results: Score[] = []
  for (const spec of CASES) {
    it(spec.name, () => {
      const { pcm, sr, truth } = synthSong(spec)
      const t0 = performance.now()
      const a = analyze(pcm, sr, { quality: 'accurate', trackId: spec.name })
      const ms = Math.round(performance.now() - t0)
      const s = evaluate(a, truth, spec, ms)
      results.push(s)
      console.log(JSON.stringify(s), '\n  chords:', a.chords.slice(0, 12).map((c) => `${c.start.toFixed(2)} ${c.label} (${Math.round(c.confidence * 100)}%)`).join(', '))
      expect(s.beatF).toBeGreaterThan(0.9)
      expect(s.bpmOk).toBe(true)
      expect(s.meter).toBe(spec.meter)
      expect(s.key).toBe(s.keyTrue)
      expect(s.chordRoot).toBeGreaterThan(85)
    })
  }
  it('결과 저장', () => {
    mkdirSync('test-results', { recursive: true })
    writeFileSync('test-results/analysis-accuracy.json', JSON.stringify(results, null, 2))
  })
})
