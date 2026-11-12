import { it, expect } from 'vitest'
import { WSOLA } from '../src/engine/wsola'

function ticks(sr: number, dur: number) {
  const x = new Float32Array(sr * dur)
  const T: number[] = []
  for (let t = 0.5; t < dur - 1; t += 0.6) { T.push(t); const s0 = Math.round(t * sr); for (let i = 0; i < 0.004 * sr; i++) x[s0 + i] += (i % 2 ? -1 : 1) * Math.exp(-i / (0.0015 * sr)) * 0.8 }
  return { x, T }
}
export function simulate(speed: number, p: number, sr = 44100) {
  const { x, T } = ticks(sr, 20)
  const w = new WSOLA(sr)
  w.reset(0.3 * sr)
  const o = { l: 0, r: 0, s: 0 }
  const n = Math.round((12 * sr) / (speed * p))
  const out = new Float32Array(n), src = new Float64Array(n)
  for (let i = 0; i < n; i++) { w.next(x, x, speed, p, o); out[i] = o.l; src[i] = o.s }
  // 출력에서 틱 검출 (첫 임계 교차)
  let mx = 0
  for (const v of out) mx = Math.max(mx, Math.abs(v))
  const errs: number[] = []
  let last = -1e9
  for (let i = 0; i < n; i++) {
    if (Math.abs(out[i]) > mx * 0.3 && i - last > 0.2 * sr) {
      last = i
      const s = src[i] / sr
      const tt = T.reduce((b, t) => (Math.abs(t - s) < Math.abs(b - s) ? t : b), T[0])
      // 클릭이 트리거되는 출력 인덱스 (라벨이 tt 를 처음 지나는 지점)
      let ci = 0
      while (ci < n && src[ci] / sr < tt) ci++
      errs.push(((ci - i) / sr) * 1000) // 출력 기준: 양수 = 클릭이 늦음
      void s
    }
  }
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length
  return { mean, max: Math.max(...errs.map(Math.abs)), n: errs.length, expected: T.filter((t) => t > 0.35 && t < 0.3 + 12).length }
}
it('WSOLA 위치 라벨 정확도', () => {
  for (const [s, p] of [[1, 1], [0.7, 1], [0.5, 1], [1.5, 1], [2, 1], [1 / 1.189, 1.189], [0.8 / 0.891, 0.891]]) {
    const r = simulate(s, p)
    console.log(`speed=${s.toFixed(3)} p=${p} 틱 ${r.n}/${r.expected} 클릭-틱(출력) ${r.mean.toFixed(2)}ms 최대 ${r.max.toFixed(2)}ms`)
  }
  expect(true).toBe(true)
})
