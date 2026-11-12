import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { engine } from '../engine/AudioEngine'
import type { Analysis, Beat, ChordSegment } from '../types'

/** 화면 표시용 재생 위치 (rAF). 박자/클릭 생성에는 사용하지 않음 */
export function usePosition(fps = 30) {
  const [pos, setPos] = useState(0)
  useEffect(() => {
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      if (now - last > 1000 / fps) { last = now; setPos(engine.position) }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [fps])
  return pos
}

export function useEngine() {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => `${engine.playing}|${engine.countIn}|${engine.loopCount}`,
  )
}

/** 정렬된 배열에서 t 이하 마지막 인덱스 */
export function lastIndexAtOrBefore<T>(arr: T[], t: number, key: (x: T) => number) {
  let lo = 0, hi = arr.length - 1, ans = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (key(arr[m]) <= t) { ans = m; lo = m + 1 } else hi = m - 1
  }
  return ans
}

export function beatAt(a: Analysis | null, t: number): { idx: number; beat: Beat | null } {
  if (!a || !a.beats.length) return { idx: -1, beat: null }
  const idx = lastIndexAtOrBefore(a.beats, t + 0.005, (b) => b.t)
  return { idx, beat: idx >= 0 ? a.beats[idx] : null }
}

export function chordAt(a: Analysis | null, t: number): { idx: number; chord: ChordSegment | null } {
  if (!a || !a.chords.length) return { idx: -1, chord: null }
  const idx = lastIndexAtOrBefore(a.chords, t, (c) => c.start)
  return { idx, chord: idx >= 0 ? a.chords[idx] : null }
}

export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

export function confColor(c: number) {
  if (c >= 0.75) return 'text-emerald-500'
  if (c >= 0.5) return 'text-amber-500'
  return 'text-warn'
}
export function confLabel(c: number, source: 'ai' | 'user') {
  if (source === 'user') return '확정(사용자)'
  return `AI 추정 · 신뢰도 ${Math.round(c * 100)}%`
}
