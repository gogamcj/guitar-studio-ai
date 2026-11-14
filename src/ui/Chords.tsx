import { useEffect, useMemo, useRef, useState } from 'react'
import { displayChordLabel, fmtTime } from '../lib/music'
import { displayTranspose, editChord, seek, setState, splitChordAt, toast, useApp } from '../store/app'
import { engine } from '../engine/AudioEngine'
import { chordAt, confColor, usePosition } from './hooks'
import { ICopy, IDownload, IMinus, IPlus } from './icons'
import { download } from '../platform/files'
import type { Analysis } from '../types'

/** 마디 번호 찾기 */
export function barAt(a: Analysis, t: number) {
  let bar = 0
  for (const b of a.beats) { if (b.t > t + 0.03) break; bar = b.bar }
  return bar
}

/** 가로 코드 진행 레인 (현재 코드 강조, 자동 스크롤, 확대/축소) */
export function ChordLane() {
  const a = useApp((s) => s.analysis)
  const zoom = useApp((s) => s.chordZoom)
  const tr = useApp((s) => displayTranspose(s))
  const pos = usePosition(20)
  const ref = useRef<HTMLDivElement>(null)
  const { idx } = chordAt(a, pos)
  const pxPerSec = 28 * zoom
  useEffect(() => {
    const el = ref.current
    if (!el || !a) return
    const x = pos * pxPerSec
    if (engine.playing && (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 80)) el.scrollTo({ left: x - el.clientWidth * 0.25, behavior: 'smooth' })
  }, [idx, pxPerSec])
  if (!a || !a.chords.length) return null
  const total = a.duration * pxPerSec
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="label">전체 코드 진행</span>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-icon h-7 w-7" onClick={() => setState({ chordZoom: Math.max(0.25, zoom / 1.5) })} title="축소"><IMinus size={14} /></button>
          <span className="text-[11px] text-mute w-10 text-center tabular">{Math.round(zoom * 100)}%</span>
          <button className="btn btn-ghost btn-icon h-7 w-7" onClick={() => setState({ chordZoom: Math.min(8, zoom * 1.5) })} title="확대"><IPlus size={14} /></button>
        </div>
      </div>
      <div ref={ref} className="overflow-x-auto scrollbar-thin">
        <div className="relative h-14" style={{ width: total }}>
          {a.chords.map((c, i) => {
            const w = (c.end - c.start) * pxPerSec
            const on = i === idx
            const lab = displayChordLabel(c, tr, a.key.value.tonic, a.key.value.mode)
            return (
              <button key={i} onClick={() => seek(c.start)} title={`${fmtTime(c.start)} · ${lab} · ${c.source === 'user' ? '사용자' : `신뢰도 ${Math.round(c.confidence * 100)}%`}`}
                className={`absolute top-0 h-14 rounded-lg border text-left px-1.5 overflow-hidden transition-colors ${on ? 'bg-accent text-white border-accent' : c.root < 0 ? 'bg-transparent border-line/40 text-mute' : 'bg-panel2 border-line/50 hover:border-accent/60'}`}
                style={{ left: c.start * pxPerSec + 1, width: Math.max(2, w - 2) }}>
                {w > 18 && <span className={`block font-semibold ${w > 50 ? 'text-base' : 'text-xs'} truncate`}>{lab}</span>}
                {w > 40 && <span className={`block text-[10px] ${on ? 'text-white/80' : c.source === 'user' ? 'text-accent2' : confColor(c.confidence)}`}>{c.source === 'user' ? '✓' : `${Math.round(c.confidence * 100)}%`}</span>}
              </button>
            )
          })}
          <div className="absolute top-0 h-14 w-0.5 bg-fg pointer-events-none" style={{ left: pos * pxPerSec }} />
        </div>
      </div>
    </div>
  )
}

export function chordProgressionText(a: Analysis, tr: number, mode: 'table' | 'bars' | 'csv') {
  const lab = (c: Analysis['chords'][0]) => displayChordLabel(c, tr, a.key.value.tonic, a.key.value.mode)
  const chords = a.chords.filter((c) => c.root >= 0 || c.end - c.start > 1)
  if (mode === 'csv') return 'time,bar,chord,confidence,source\n' + chords.map((c) => `${c.start.toFixed(2)},${barAt(a, c.start)},${lab(c)},${c.confidence.toFixed(2)},${c.source}`).join('\n')
  if (mode === 'table') return chords.map((c) => `${fmtTime(c.start)}\t${barAt(a, c.start)}\t${lab(c)}`).join('\n')
  // 마디별: | G | D | Em | C |
  const bars = new Map<number, string[]>()
  for (const b of a.beats) {
    if (b.bar < 1) continue
    const c = chordAt(a, b.t + 0.02).chord
    if (!c) continue
    const arr = bars.get(b.bar) || []
    const l = lab(c)
    if (arr[arr.length - 1] !== l) arr.push(l)
    bars.set(b.bar, arr)
  }
  const out: string[] = []
  let line: string[] = []
  ;[...bars.entries()].sort((x, y) => x[0] - y[0]).forEach(([, cs], i) => {
    line.push(cs.join(' '))
    if ((i + 1) % 4 === 0) { out.push('| ' + line.join(' | ') + ' |'); line = [] }
  })
  if (line.length) out.push('| ' + line.join(' | ') + ' |')
  return out.join('\n')
}

/** 시간/마디/코드 표 + 수동 수정 */
export function ChordTable() {
  const a = useApp((s) => s.analysis)
  const tr = useApp((s) => displayTranspose(s))
  const name = useApp((s) => s.tracks.find((t) => t.id === s.currentId)?.name || 'song')
  const pos = usePosition(10)
  const [editing, setEditing] = useState<number | null>(null)
  const [text, setText] = useState('')
  const { idx } = chordAt(a, pos)
  const rowRef = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => (a ? a.chords.map((c, i) => ({ c, i, bar: barAt(a, c.start) })) : []), [a])
  useEffect(() => {
    if (!engine.playing) return
    // 코드 표 안에서만 스크롤 (scrollIntoView 는 페이지 전체를 움직여 파형이 화면 위로 밀려남)
    const box = rowRef.current
    const row = box?.querySelector<HTMLElement>(`[data-i="${idx}"]`)
    if (!box || !row) return
    const head = 28 // 고정된 표 머리글 높이
    const top = row.offsetTop
    if (top < box.scrollTop + head) box.scrollTop = top - head
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + row.offsetHeight - box.clientHeight
  }, [idx])
  if (!a) return null
  const copy = async () => {
    try { await navigator.clipboard.writeText(chordProgressionText(a, tr, 'bars')); toast('코드 진행을 복사했습니다.') } catch { toast('클립보드 접근이 허용되지 않았습니다.') }
  }
  const base = name.replace(/\.[^.]+$/, '')
  return (
    <div className="card p-3 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="label">코드 표 (클릭하여 수정)</span>
        <div className="flex gap-1">
          <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => splitChordAt(engine.position)} title="현재 위치에서 코드 구간 나누기">분할</button>
          <button className="btn btn-ghost h-7 px-2 text-xs" onClick={copy} title="마디별 코드 진행 복사"><ICopy size={14} />복사</button>
          <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => download(`${base}-chords.txt`, chordProgressionText(a, tr, 'table') + '\n\n' + chordProgressionText(a, tr, 'bars'))} title="텍스트로 내보내기"><IDownload size={14} />TXT</button>
          <button className="btn btn-ghost h-7 px-2 text-xs" onClick={() => download(`${base}-chords.csv`, chordProgressionText(a, tr, 'csv'), 'text/csv')}>CSV</button>
        </div>
      </div>
      <div ref={rowRef} className="relative overflow-y-auto scrollbar-thin max-h-72 -mx-1">
        <div className="grid grid-cols-[4.5rem_3rem_1fr_4rem] text-[11px] text-mute px-2 py-1 sticky top-0 bg-panel">
          <span>시간</span><span>마디</span><span>코드</span><span className="text-right">신뢰도</span>
        </div>
        {rows.map(({ c, i, bar }) => (
          <div key={i} data-i={i} className={`grid grid-cols-[4.5rem_3rem_1fr_4rem] items-center px-2 py-1 rounded-md text-sm ${i === idx ? 'bg-accent/15' : 'hover:bg-panel2'}`}>
            <button className="text-left tabular text-mute" onClick={() => seek(c.start)}>{fmtTime(c.start)}</button>
            <span className="tabular text-mute">{bar > 0 ? bar : '-'}</span>
            {editing === i ? (
              <form onSubmit={(e) => { e.preventDefault(); if (editChord(i, text)) setEditing(null); else toast('코드 형식을 확인하세요. 예: G, Em7, D/F#, Cmaj7, N.C.') }} className="flex gap-1">
                <input autoFocus className="input h-7 w-28" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => setEditing(null)} />
              </form>
            ) : (
              <button className="text-left font-semibold" onClick={() => { setEditing(i); setText(displayChordLabel(c, tr, a.key.value.tonic, a.key.value.mode)) }}>{displayChordLabel(c, tr, a.key.value.tonic, a.key.value.mode)}</button>
            )}
            <span className={`text-right text-xs tabular ${c.source === 'user' ? 'text-accent2' : confColor(c.confidence)}`}>{c.source === 'user' ? '사용자' : `${Math.round(c.confidence * 100)}%`}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
