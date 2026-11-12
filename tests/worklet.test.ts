// AudioWorklet 프로세서를 Node 에서 그대로 구동해 클릭-원곡 싱크를 샘플 단위로 측정
import { it, expect } from 'vitest'
import { synthClicks } from '../src/engine/clickSounds'

const SR = 48000
let Proc: any
;(globalThis as any).sampleRate = SR
;(globalThis as any).currentTime = 0
;(globalThis as any).AudioWorkletProcessor = class { port: any; constructor() { this.port = { postMessage: () => {}, onmessage: null } } }
;(globalThis as any).registerProcessor = (_: string, c: any) => { Proc = c }

export function detect(sr: number, x: Float32Array) {
  const hop = Math.round(sr * 0.0005), win = Math.round(sr * 0.002)
  const hpE: number[] = [], cE: number[] = []
  const gz = (s: number, f: number) => { const w = (2 * Math.PI * f) / sr, c = 2 * Math.cos(w); let a = 0, b = 0; for (let i = s; i < s + win; i++) { const y = x[i] + c * a - b; b = a; a = y } return a * a + b * b - c * a * b }
  for (let s = 1; s + win < x.length; s += hop) {
    let e = 0
    for (let i = s; i < s + win; i++) { const d = x[i] - x[i - 1]; e += d * d }
    hpE.push(e); cE.push(gz(s, 1320) + gz(s, 1760))
  }
  const onsets = (E: number[], rel: number) => {
    let mx = 0
    for (const v of E) mx = Math.max(mx, v)
    const thr = mx * rel, out: number[] = []
    let last = -1e9
    for (let i = 1; i < E.length; i++) if (E[i] >= thr && E[i - 1] < thr && i - last > 0.2 / 0.0005) { out.push((i * hop) / sr); last = i }
    return out
  }
  return { ticks: onsets(hpE, 0.15), clicks: onsets(cE, 0.08) }
}

export async function runProc(rate: number, pitch: number, secs = 8) {
  if (!Proc) await import('../src/engine/player.worklet')
  const p = new Proc()
  const dur = 30
  const x = new Float32Array(SR * dur)
  const T: number[] = []
  let seed = 3
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1 }
  for (let t = 0.5; t < dur - 1; t += 0.6) { T.push(t); const s0 = Math.round(t * SR); let prev = 0; for (let i = 0; i < 0.004 * SR; i++) { const v = rnd(); x[s0 + i] += 0.7 * (v - prev) * Math.exp(-i / (0.0015 * SR)); prev = v } }
  const [accent, beat, sub] = synthClicks('electronic', SR)
  p.onMsg({ type: 'load', L: x, R: x })
  p.onMsg({ type: 'sounds', accent, beat, sub })
  p.onMsg({ type: 'clicks', times: Float64Array.from(T), kinds: new Uint8Array(T.length).fill(1) })
  p.onMsg({ type: 'params', rate, pitch, clickOn: true, volume: 1, clickGain: 0.8 })
  p.onMsg({ type: 'seek', t: 5 })
  p.onMsg({ type: 'play' })
  const n = Math.round(secs * SR)
  const out = new Float32Array(n)
  for (let o = 0; o < n; o += 128) {
    const L = new Float32Array(128), R = new Float32Array(128)
    p.process([], [[L, R]])
    out.set(L.subarray(0, Math.min(128, n - o)), o)
  }
  const { ticks, clicks } = detect(SR, out)
  const diffs: number[] = []
  for (const c of clicks) { let best = 1e9; for (const t of ticks) if (Math.abs(c - t) < Math.abs(best)) best = c - t; if (Math.abs(best) < 0.1) diffs.push(best * 1000) }
  const mean = diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1)
  return { ticks: ticks.length, clicks: clicks.length, matched: diffs.length, mean, max: Math.max(...diffs.map(Math.abs)) }
}

it('워크렛 클릭 싱크 (Node 시뮬레이션)', async () => {
  const rows: string[] = []
  for (const [r, pi] of [[1, 0], [0.7, 0], [0.5, 0], [1.5, 0], [2, 0], [1, 3], [0.8, -2]]) {
    const res = await runProc(r, pi)
    rows.push(`rate=${r} pitch=${pi}: 틱 ${res.ticks} 클릭 ${res.clicks} 매칭 ${res.matched} 평균 ${res.mean.toFixed(2)}ms 최대 ${res.max.toFixed(2)}ms`)
  }
  console.log(rows.join('\n'))
  expect(rows.length).toBe(7)
})
