import type { Beat, ClickSubdivision } from '../types'

// 분석된 비트 타임스탬프로부터 클릭 이벤트(원곡 기준 초)를 만든다.
// 세분 음표는 인접 비트 사이를 보간하므로 템포가 변해도 원곡 비트를 따라간다.
export function buildClickEvents(beats: Beat[], sub: ClickSubdivision, accentDownbeat: boolean) {
  const times: number[] = []
  const kinds: number[] = []
  const n = beats.length
  for (let i = 0; i < n; i++) {
    const b = beats[i]
    const isDown = b.beat === 1
    if (sub === 'half') {
      // 2박마다: 마디 내 홀수 박(1,3,...)
      if ((b.beat - 1) % 2 !== 0) continue
    }
    times.push(b.t)
    kinds.push(isDown && accentDownbeat ? 0 : 1)
    const next = i + 1 < n ? beats[i + 1].t : i > 0 ? b.t + (b.t - beats[i - 1].t) : NaN
    if (!isFinite(next)) continue
    const d = next - b.t
    const subs = sub === 'eighth' ? [0.5] : sub === 'sixteenth' ? [0.25, 0.5, 0.75] : sub === 'shuffle' ? [2 / 3] : []
    for (const f of subs) { times.push(b.t + d * f); kinds.push(2) }
  }
  return { times: Float64Array.from(times), kinds: Uint8Array.from(kinds) }
}

// 균일 템포 비트 그리드 (수동 BPM 또는 분석 실패 시 사용자가 지정한 값으로만 생성)
export function gridBeats(bpm: number, firstBeat: number, meter: number, duration: number): Beat[] {
  const out: Beat[] = []
  const p = 60 / bpm
  let t = firstBeat
  let k = 0
  while (t < duration) {
    out.push({ t, bar: Math.floor(k / meter) + 1, beat: (k % meter) + 1 })
    k++
    t = firstBeat + k * p
  }
  return out
}
