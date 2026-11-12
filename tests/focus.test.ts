// 악기 강조 필터 측정: 악기별 스템을 따로 합성해 각각 필터에 통과시키고
// "대상 악기 음량 변화 − 다른 악기들의 평균 음량 변화"(dB)를 잰다.
import { describe, expect, it } from 'vitest'
import { Focus, type FocusMode } from '../src/engine/focus'

const SR = 44100
const N = SR * 8
let seed = 3
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1 }
const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

type Stem = { L: Float32Array; R: Float32Array }
function stem(): Stem { return { L: new Float32Array(N), R: new Float32Array(N) } }
function note(s: Stem, t0: number, dur: number, f: number, amp: number, harm: number[], panL: number, panR: number, decay = 1, vib = 0) {
  const s0 = Math.round(t0 * SR), n = Math.round(dur * SR)
  for (let i = 0; i < n && s0 + i < N; i++) {
    const t = i / SR
    const env = Math.min(1, t / 0.005) * Math.exp(-t / decay) * Math.min(1, (dur - t) / 0.02)
    const ff = f * (1 + vib * Math.sin(2 * Math.PI * 5.5 * t))
    let v = 0
    for (let h = 0; h < harm.length; h++) v += harm[h] * Math.sin(2 * Math.PI * ff * (h + 1) * t)
    s.L[s0 + i] += amp * env * v * panL
    s.R[s0 + i] += amp * env * v * panR
  }
}

function makeStems() {
  const beat = 0.5
  const bass = stem(), vocal = stem(), guitar = stem(), keys = stem(), drums = stem()
  const roots = [43, 38, 40, 36] // G D E C
  for (let b = 0; b < 16; b++) {
    const r = roots[(b >> 2) % 4]
    note(bass, b * beat, beat * 0.9, hz(r), 0.3, [1, 0.5, 0.3, 0.15], 1, 1, 0.6)
    // 보컬: 가운데, 비브라토
    note(vocal, b * beat, beat * 0.95, hz(67 + [0, 2, 4, 2][b % 4]), 0.2, [1, 0.5, 0.35, 0.25, 0.15, 0.1, 0.06], 1, 1, 3, 0.006)
    // 기타: 더블 트래킹(좌우 다른 보이싱·타이밍), 배음 많음
    const gtr = [55, 59, 62, 67].map((x) => x + (r - 43))
    gtr.forEach((m, k) => {
      note(guitar, b * beat + k * 0.006, beat * 0.95, hz(m), 0.06, [1, 0.7, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1], 1, 0.15, 0.4)
      note(guitar, b * beat + 0.012 + k * 0.007, beat * 0.95, hz(m + 12), 0.05, [1, 0.7, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1], 0.15, 1, 0.4)
    })
    // 건반: 거의 가운데, 부드러운 배음
    if (b % 2 === 0) [60, 64, 67].map((x) => x + (r - 43)).forEach((m) => note(keys, b * beat, beat * 1.9, hz(m), 0.07, [1, 0.3, 0.12, 0.05], 0.9, 0.8, 1.2))
  }
  // 드럼
  for (let b = 0; b < 16; b++) {
    const s0 = Math.round(b * beat * SR)
    if (b % 2 === 0) for (let i = 0; i < 0.25 * SR; i++) { const t = i / SR; const v = 0.6 * Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t / 0.03)) * t) * Math.exp(-t / 0.09); drums.L[s0 + i] += v; drums.R[s0 + i] += v }
    else for (let i = 0; i < 0.2 * SR; i++) { const t = i / SR; const v = (0.3 * rnd() + 0.2 * Math.sin(2 * Math.PI * 190 * t)) * Math.exp(-t / 0.05); drums.L[s0 + i] += v; drums.R[s0 + i] += v }
    for (let h = 0; h < 2; h++) {
      const h0 = s0 + Math.round(h * beat / 2 * SR)
      let pl = 0, pr = 0
      for (let i = 0; i < 0.05 * SR; i++) { const xl = rnd(), xr = rnd(); const e = 0.15 * Math.exp(-(i / SR) / 0.012); drums.L[h0 + i] += e * (xl - pl) * 0.9; drums.R[h0 + i] += e * (xr - pr) * 0.6; pl = xl; pr = xr }
    }
  }
  return { bass, vocal, guitar, keys, drums }
}

function rms(s: Stem) { let e = 0; for (let i = SR; i < N; i++) e += s.L[i] ** 2 + s.R[i] ** 2; return Math.sqrt(e / (2 * (N - SR))) }
function run(mode: FocusMode, s: Stem, amount = 0.8): Stem {
  const f = new Focus(SR)
  f.set(mode, amount)
  const o = stem(), out = { l: 0, r: 0 }
  for (let i = 0; i < N; i++) { f.process(s.L[i], s.R[i], out); o.L[i] = out.l; o.R[i] = out.r }
  return o
}

const stems = makeStems()
const names = Object.keys(stems) as (keyof typeof stems)[]
const MODES: Record<string, FocusMode> = { bass: 'bass', vocal: 'vocal', guitar: 'guitar', keys: 'keys', drums: 'drums' }

describe('악기 강조 필터', () => {
  const table: Record<string, number> = {}
  for (const target of names) {
    it(`${target} 모드: 대상 악기가 다른 악기보다 커짐`, () => {
      const mode = MODES[target]
      const gains: Record<string, number> = {}
      for (const n of names) gains[n] = 20 * Math.log10(rms(run(mode, stems[n])) / rms(stems[n]))
      const others = names.filter((n) => n !== target)
      const rel = gains[target] - others.reduce((a, n) => a + gains[n], 0) / others.length
      const worst = gains[target] - Math.max(...others.map((n) => gains[n]))
      table[target] = rel
      console.log(`[focus] ${target.padEnd(6)} 대상 ${gains[target].toFixed(1)}dB | ` + others.map((n) => `${n} ${gains[n].toFixed(1)}`).join(', ') + ` | 평균 대비 +${rel.toFixed(1)}dB, 가장 가까운 악기 대비 ${worst >= 0 ? '+' : ''}${worst.toFixed(1)}dB`)
      // 건반은 기타·보컬과 음역대가 겹쳐 구분이 약함 (사용자에게도 그렇게 안내)
      expect(rel).toBeGreaterThan(target === 'keys' ? 3 : 5)
    })
  }

  it('드럼 모드: 저음(킥)이 곡 전체에서 과하게 커지지 않음', () => {
    const mix = stem()
    for (const n of names) for (let i = 0; i < N; i++) { mix.L[i] += stems[n].L[i]; mix.R[i] += stems[n].R[i] }
    const lowShare = (s: Stem) => {
      const a = Math.exp(-2 * Math.PI * 150 / SR); let y1 = 0, y2 = 0, el = 0, ea = 0
      for (let i = 0; i < N; i++) { const v = (s.L[i] + s.R[i]) / 2; y1 = (1 - a) * v + a * y1; y2 = (1 - a) * y1 + a * y2; if (i > SR) { el += y2 * y2; ea += v * v } }
      return el / ea
    }
    const before = lowShare(mix), after = lowShare(run('drums', mix))
    console.log(`[focus] 드럼 모드 저역(<150Hz) 비중 ${(before * 100).toFixed(1)}% → ${(after * 100).toFixed(1)}%`)
    expect(after).toBeLessThan(before * 1.3)
  })

  it('끄기(원음)는 신호를 바꾸지 않음', () => {
    const o = run('off', stems.guitar)
    let d = 0
    for (let i = 0; i < N; i++) d = Math.max(d, Math.abs(o.L[i] - stems.guitar.L[i]))
    expect(d).toBe(0)
  })

  it('큰 입력에서도 클리핑 없음', () => {
    const loud = stem()
    for (let i = 0; i < N; i++) { loud.L[i] = stems.bass.L[i] * 3; loud.R[i] = stems.bass.R[i] * 3 }
    const o = run('bass', loud, 1)
    let pk = 0
    for (let i = SR; i < N; i++) pk = Math.max(pk, Math.abs(o.L[i]), Math.abs(o.R[i]))
    console.log(`[focus] 큰 입력 피크 ${pk.toFixed(3)}`)
    expect(pk).toBeLessThan(1.05)
  })
})
