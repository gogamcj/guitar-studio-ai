import type { Section } from '../types'

/**
 * 마디 단위 자기유사 행렬 기반 곡 구조 추정.
 * 이름(Intro/Verse/Chorus...)은 휴리스틱이므로 항상 '추정'(certain=false)으로 표시한다.
 */
export function estimateSections(barStarts: number[], barChroma: Float32Array[], barEnergy: number[], duration: number): Section[] {
  const B = barChroma.length
  if (B < 8) return [{ start: 0, end: duration, label: '?', certain: false }]
  const norm = barChroma.map((c) => {
    let s = 0
    for (const v of c) s += v * v
    s = Math.sqrt(s) || 1
    return Float32Array.from(c, (v) => v / s)
  })
  const maxE = Math.max(...barEnergy) || 1
  const sim = (i: number, j: number) => {
    let d = 0
    for (let p = 0; p < 12; p++) d += norm[i][p] * norm[j][p]
    const e = 1 - Math.abs(barEnergy[i] - barEnergy[j]) / maxE
    return 0.75 * d + 0.25 * e
  }
  // 체커보드 커널 노벨티
  const K = 4
  const nov = new Float32Array(B)
  for (let i = K; i <= B - K; i++) {
    let s = 0
    for (let a = -K; a < K; a++) for (let b = -K; b < K; b++) {
      const sign = (a < 0) === (b < 0) ? 1 : -1
      s += sign * sim(i + a, i + b)
    }
    nov[i] = s
  }
  // 피크 선택 (최소 4마디 간격, 평균+0.5σ 이상)
  let m = 0, sd = 0
  for (const v of nov) m += v
  m /= B
  for (const v of nov) sd += (v - m) ** 2
  sd = Math.sqrt(sd / B)
  const bounds = [0]
  for (let i = 2; i < B - 2; i++) {
    if (nov[i] > m + 0.5 * sd && nov[i] >= nov[i - 1] && nov[i] >= nov[i + 1] && i - bounds[bounds.length - 1] >= 4) bounds.push(i)
  }
  bounds.push(B)
  // 구간 간 유사도로 그룹핑 (같은 코드 진행이 반복되면 같은 문자)
  const segs = bounds.slice(0, -1).map((s, k) => ({ s, e: bounds[k + 1] }))
  const segSim = (x: { s: number; e: number }, y: { s: number; e: number }) => {
    const L = Math.min(x.e - x.s, y.e - y.s)
    let t = 0
    for (let k = 0; k < L; k++) t += sim(x.s + k, y.s + k)
    const lenPen = Math.min(x.e - x.s, y.e - y.s) / Math.max(x.e - x.s, y.e - y.s)
    return (t / L) * (0.8 + 0.2 * lenPen)
  }
  const group: number[] = []
  let g = 0
  for (let i = 0; i < segs.length; i++) {
    let found = -1
    for (let j = 0; j < i; j++) if (segSim(segs[i], segs[j]) > 0.9) { found = group[j]; break }
    group.push(found >= 0 ? found : g++)
  }
  // 이름 붙이기(휴리스틱)
  const segEnergy = segs.map((x) => { let e = 0; for (let k = x.s; k < x.e; k++) e += barEnergy[k]; return e / (x.e - x.s) })
  const meanE = segEnergy.reduce((a, b) => a + b, 0) / segEnergy.length
  const counts = new Map<number, number>()
  group.forEach((gg) => counts.set(gg, (counts.get(gg) || 0) + 1))
  // 반복되는 그룹 중 에너지 높은 것 = Chorus, 그 다음 반복 그룹 = Verse
  const repeated = [...counts.entries()].filter(([, c]) => c >= 2).map(([gg]) => gg)
  const gEnergy = (gg: number) => { const idx = group.map((x, i) => (x === gg ? i : -1)).filter((i) => i >= 0); return idx.reduce((s, i) => s + segEnergy[i], 0) / idx.length }
  repeated.sort((a, b) => gEnergy(b) - gEnergy(a))
  const names = new Map<number, string>()
  if (repeated[0] !== undefined) names.set(repeated[0], 'Chorus')
  if (repeated[1] !== undefined) names.set(repeated[1], 'Verse')
  const out: Section[] = segs.map((x, i) => {
    let label = names.get(group[i]) || ''
    if (!label) {
      if (i === 0 && segEnergy[i] < meanE) label = 'Intro'
      else if (i === segs.length - 1 && segEnergy[i] < meanE) label = 'Outro'
      else if (counts.get(group[i]) === 1 && i > 0 && i < segs.length - 1) label = 'Bridge'
      else label = String.fromCharCode(65 + group[i])
    }
    return { start: barStarts[x.s], end: x.e < barStarts.length ? barStarts[x.e] : duration, label, certain: false }
  })
  if (out.length) { out[0].start = 0; out[out.length - 1].end = duration }
  return out
}
