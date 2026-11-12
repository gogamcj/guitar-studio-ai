import { useEffect, useRef, useState } from 'react'
import { engine } from '../engine/AudioEngine'
import { displayTranspose, getState, seek, setLoop, useApp } from '../store/app'
import { displayChordLabel, fmtTime } from '../lib/music'
import { IZoomIn, IZoomOut } from './icons'

const cssCache = new Map<string, string>()
let cssT = 0
function css(name: string, alpha = 1) {
  const now = performance.now()
  if (now - cssT > 500) { cssCache.clear(); cssT = now }
  let v = cssCache.get(name)
  if (!v) { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).join(','); cssCache.set(name, v) }
  return `rgba(${v},${alpha})`
}

/** 파형 + 비트/마디/코드/반복구간/마커 오버레이. 클릭=이동, 드래그=A-B 구간 지정 */
export function Waveform() {
  const peaks = useApp((s) => s.peaks)
  const duration = useApp((s) => s.duration)
  const wrapRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLCanvasElement>(null)
  const ovRef = useRef<HTMLCanvasElement>(null)
  const [viewDur, setViewDur] = useState(0) // 0 = 전체
  const view = useRef({ start: 0, dur: 0 })
  const drag = useRef<{ mode: 'none' | 'select' | 'a' | 'b' | 'pan'; x0: number; t0: number; moved: boolean; start0: number }>({ mode: 'none', x0: 0, t0: 0, moved: false, start0: 0 })

  useEffect(() => { setViewDur(0); view.current.start = 0 }, [duration])

  const vd = () => (viewDur > 0 ? Math.min(viewDur, duration) : duration)

  useEffect(() => {
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const c = mainRef.current, o = ovRef.current
      if (!c || !o || !peaks || !duration) return
      const dpr = window.devicePixelRatio || 1
      const W = c.clientWidth, H = c.clientHeight
      if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr) }
      const OW = o.clientWidth, OH = o.clientHeight
      if (o.width !== Math.round(OW * dpr) || o.height !== Math.round(OH * dpr)) { o.width = Math.round(OW * dpr); o.height = Math.round(OH * dpr) }
      const st = getState()
      const a = st.analysis
      const pos = engine.position
      const dur = vd()
      view.current.dur = dur
      // 재생 중 화면 따라가기
      if (engine.playing && dur < duration && drag.current.mode === 'none') {
        if (pos > view.current.start + dur * 0.9 || pos < view.current.start) view.current.start = Math.max(0, Math.min(duration - dur, pos - dur * 0.1))
      }
      view.current.start = Math.max(0, Math.min(duration - dur, view.current.start))
      const vs = view.current.start
      const x = (t: number) => ((t - vs) / dur) * W
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, W, H)
      const laneTop = 18 // 코드 라벨 영역
      const wH = H - laneTop - 14
      const mid = laneTop + wH / 2
      // 반복 구간
      const l = st.loop
      if (l.b > l.a) {
        g.fillStyle = css('--accent', l.enabled ? 0.16 : 0.07)
        g.fillRect(x(l.a), laneTop, x(l.b) - x(l.a), wH)
        g.fillStyle = css('--accent', l.enabled ? 0.9 : 0.4)
        g.fillRect(x(l.a) - 1, laneTop, 2, wH)
        g.fillRect(x(l.b) - 1, laneTop, 2, wH)
        g.font = '600 10px -apple-system, system-ui, sans-serif'
        g.fillText('A', x(l.a) + 3, laneTop + 11)
        g.fillText('B', x(l.b) - 10, laneTop + 11)
      }
      // 비트/마디선
      if (a) {
        const pxPerBeat = (60 / (a.bpm.value || 120) / dur) * W
        for (const b of a.beats) {
          if (b.t < vs - 1 || b.t > vs + dur + 1) continue
          const bx = x(b.t)
          if (b.beat === 1) {
            g.fillStyle = css('--fg', 0.28)
            g.fillRect(bx, laneTop, 1, wH)
            if (pxPerBeat * a.meter.value > 26 || b.bar % 4 === 1) {
              g.fillStyle = css('--mute', 0.9)
              g.font = '10px -apple-system, system-ui, sans-serif'
              g.fillText(String(b.bar), bx + 2, H - 3)
            }
          } else if (pxPerBeat > 6) {
            g.fillStyle = css('--fg', 0.1)
            g.fillRect(bx, laneTop + wH * 0.35, 1, wH * 0.3)
          }
        }
      }
      // 파형
      const pps = st.peaksPerSec
      const color = st.settings.waveformColor
      const played = css('--accent', 0.95)
      for (let px = 0; px < W; px++) {
        const t0 = vs + (px / W) * dur, t1 = vs + ((px + 1) / W) * dur
        const i0 = Math.max(0, Math.floor(t0 * pps)), i1 = Math.min(peaks.length / 2, Math.max(i0 + 1, Math.ceil(t1 * pps)))
        let mn = 0, mx = 0
        for (let i = i0; i < i1; i++) { if (peaks[i * 2] < mn) mn = peaks[i * 2]; if (peaks[i * 2 + 1] > mx) mx = peaks[i * 2 + 1] }
        g.fillStyle = t0 < pos ? played : color
        const y0 = mid - mx * (wH / 2) * 0.95, y1 = mid - mn * (wH / 2) * 0.95
        g.fillRect(px, y0, 1, Math.max(1, y1 - y0))
      }
      // 코드 변경 지점 + 라벨
      if (a && a.chords.length) {
        const tr = displayTranspose(st)
        g.font = '600 11px -apple-system, system-ui, sans-serif'
        let lastLabelEnd = -1e9
        for (const ch of a.chords) {
          if (ch.end < vs || ch.start > vs + dur) continue
          const cx = x(ch.start)
          g.fillStyle = css('--accent2', 0.8)
          g.fillRect(cx, 0, 1.5, laneTop + wH)
          const lab = displayChordLabel(ch, tr, a.key.value.tonic, a.key.value.mode)
          const tw = g.measureText(lab).width
          if (cx + 3 > lastLabelEnd + 4) {
            g.fillStyle = ch.confidence < 0.5 && ch.source === 'ai' ? css('--mute', 1) : css('--fg', 0.95)
            g.fillText(lab, Math.max(cx + 3, 0), 13)
            lastLabelEnd = cx + 3 + tw
          }
        }
      }
      // 마커
      for (const m of st.markers) {
        const mx = x(m.t)
        if (mx < -2 || mx > W + 2) continue
        g.fillStyle = css('--warn', 0.9)
        g.fillRect(mx, laneTop, 1.5, wH)
        g.beginPath(); g.moveTo(mx, laneTop); g.lineTo(mx + 7, laneTop + 4); g.lineTo(mx, laneTop + 8); g.fill()
      }
      // 재생 헤드
      const phx = x(pos)
      g.fillStyle = css('--fg', 1)
      g.fillRect(phx - 0.75, 0, 1.5, H)
      // 개요(전체) 바
      const og = o.getContext('2d')!
      og.setTransform(dpr, 0, 0, dpr, 0, 0)
      og.clearRect(0, 0, OW, OH)
      const om = OH / 2
      const step = peaks.length / 2 / OW
      for (let px = 0; px < OW; px++) {
        const i0 = Math.floor(px * step), i1 = Math.max(i0 + 1, Math.floor((px + 1) * step))
        let mx = 0
        for (let i = i0; i < i1; i++) mx = Math.max(mx, peaks[i * 2 + 1], -peaks[i * 2])
        og.fillStyle = (px / OW) * duration < pos ? played : css('--mute', 0.6)
        og.fillRect(px, om - mx * om, 1, Math.max(1, mx * OH))
      }
      if (a && a.sections.length) {
        for (const s of a.sections) { og.fillStyle = css('--fg', 0.25); og.fillRect((s.start / duration) * OW, 0, 1, OH) }
      }
      if (dur < duration) {
        og.strokeStyle = css('--fg', 0.8)
        og.lineWidth = 1.5
        og.strokeRect((vs / duration) * OW + 0.75, 0.75, (dur / duration) * OW - 1.5, OH - 1.5)
      }
      og.fillStyle = css('--fg', 1)
      og.fillRect((pos / duration) * OW - 0.5, 0, 1, OH)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [peaks, duration, viewDur])

  const tAt = (clientX: number) => {
    const c = mainRef.current!
    const r = c.getBoundingClientRect()
    return view.current.start + ((clientX - r.left) / r.width) * view.current.dur
  }
  const onDown = (e: React.PointerEvent) => {
    if (!duration) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const t = tAt(e.clientX)
    const l = getState().loop
    const pxPerSec = mainRef.current!.clientWidth / view.current.dur
    let mode: typeof drag.current.mode = 'select'
    if (l.b > l.a && Math.abs(t - l.a) * pxPerSec < 8) mode = 'a'
    else if (l.b > l.a && Math.abs(t - l.b) * pxPerSec < 8) mode = 'b'
    else if (e.altKey || e.button === 1) mode = 'pan'
    drag.current = { mode, x0: e.clientX, t0: t, moved: false, start0: view.current.start }
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d.mode === 'none') return
    if (Math.abs(e.clientX - d.x0) > 5) d.moved = true
    if (!d.moved) return
    const t = Math.max(0, Math.min(duration, tAt(e.clientX)))
    if (d.mode === 'select') setLoop({ a: Math.min(d.t0, t), b: Math.max(d.t0, t), enabled: true })
    else if (d.mode === 'a') setLoop({ a: t })
    else if (d.mode === 'b') setLoop({ b: t })
    else if (d.mode === 'pan') view.current.start = d.start0 - ((e.clientX - d.x0) / mainRef.current!.clientWidth) * view.current.dur
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    if (d.mode !== 'none' && !d.moved) seek(tAt(e.clientX))
    drag.current.mode = 'none'
  }
  const onWheel = (e: React.WheelEvent) => {
    if (!duration) return
    if (e.ctrlKey || e.metaKey) {
      const t = tAt(e.clientX)
      const cur = vd()
      const next = Math.max(2, Math.min(duration, cur * (e.deltaY > 0 ? 1.25 : 0.8)))
      const frac = (t - view.current.start) / cur
      view.current.start = t - frac * next
      setViewDur(next >= duration ? 0 : next)
    } else if (vd() < duration && Math.abs(e.deltaX) + Math.abs(e.shiftKey ? e.deltaY : 0) > 0) {
      view.current.start += ((e.deltaX || e.deltaY) / mainRef.current!.clientWidth) * vd()
    }
  }
  const zoom = (f: number) => {
    const cur = vd()
    const next = Math.max(2, Math.min(duration, cur * f))
    const center = engine.position
    view.current.start = center - next / 2
    setViewDur(next >= duration ? 0 : next)
  }
  const onOverview = (e: React.PointerEvent) => {
    const r = ovRef.current!.getBoundingClientRect()
    const t = ((e.clientX - r.left) / r.width) * duration
    if (vd() < duration) view.current.start = t - vd() / 2
    if (e.type === 'pointerdown') seek(t)
  }

  if (!peaks) {
    return <div className="h-40 sm:h-48 rounded-xl bg-panel2/60 grid place-items-center text-mute text-sm">파형 없음</div>
  }
  return (
    <div ref={wrapRef} className="select-none">
      <div className="relative">
        <canvas
          ref={mainRef}
          className="w-full h-40 sm:h-52 rounded-xl bg-panel2/50 cursor-crosshair touch-none"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onWheel={onWheel}
          aria-label="파형: 클릭하여 이동, 드래그하여 반복 구간 지정"
        />
        <div className="absolute right-2 top-6 flex gap-1">
          <button className="btn btn-icon h-7 w-7 bg-panel/80" onClick={() => zoom(0.5)} title="확대"><IZoomIn size={15} /></button>
          <button className="btn btn-icon h-7 w-7 bg-panel/80" onClick={() => zoom(2)} title="축소"><IZoomOut size={15} /></button>
        </div>
      </div>
      <canvas ref={ovRef} className="mt-1.5 w-full h-7 rounded-md bg-panel2/40 cursor-pointer touch-none" onPointerDown={onOverview} onPointerMove={(e) => e.buttons && onOverview(e)} />
      <div className="flex justify-between text-[11px] text-mute mt-1 tabular">
        <span>{fmtTime(view.current.start)}</span>
        <span>{viewDur > 0 ? `확대 ${(duration / vd()).toFixed(1)}× · Ctrl+휠로 확대/축소 · 드래그로 A-B 지정` : '드래그로 A-B 구간 지정 · Ctrl+휠 확대'}</span>
        <span>{fmtTime(view.current.start + vd())}</span>
      </div>
    </div>
  )
}
