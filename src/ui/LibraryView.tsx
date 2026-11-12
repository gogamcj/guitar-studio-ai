import { useEffect, useMemo, useState } from 'react'
import { fmtTime } from '../lib/music'
import { movePlaylist, openFiles, removeTrack, selectTrack, updateTrack, useApp } from '../store/app'
import { db } from '../store/db'
import type { TrackMeta } from '../types'
import { IDown, IFolder, IOpen, IStar, ITrash, IUp } from './icons'

type View = 'playlist' | 'folders' | 'recent' | 'favorites'

export function LibraryView({ compact = false }: { compact?: boolean }) {
  const tracks = useApp((s) => s.tracks)
  const playlist = useApp((s) => s.playlist)
  const current = useApp((s) => s.currentId)
  const analysisVer = useApp((s) => s.analysis?.analyzedAt)
  const [view, setView] = useState<View>('playlist')
  const [q, setQ] = useState('')
  const [analyzed, setAnalyzed] = useState<Set<string>>(new Set())
  useEffect(() => { db.keys('analyses').then((k) => setAnalyzed(new Set(k as string[]))).catch(() => {}) }, [tracks.length, analysisVer])
  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])
  const filt = (list: TrackMeta[]) => (q ? list.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : list)
  let content: React.ReactNode
  if (view === 'playlist') {
    const list = filt(playlist.map((id) => byId.get(id)).filter(Boolean) as TrackMeta[])
    content = list.map((t, i) => <Row key={t.id} t={t} on={t.id === current} analyzed={analyzed.has(t.id)} idx={i + 1} reorder />)
  } else if (view === 'recent') {
    content = filt(tracks.filter((t) => t.lastPlayedAt).sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)).slice(0, 30)).map((t) => <Row key={t.id} t={t} on={t.id === current} analyzed={analyzed.has(t.id)} />)
  } else if (view === 'favorites') {
    content = filt(tracks.filter((t) => t.favorite)).map((t) => <Row key={t.id} t={t} on={t.id === current} analyzed={analyzed.has(t.id)} />)
  } else {
    const groups = new Map<string, TrackMeta[]>()
    for (const t of filt(tracks)) { const f = t.folder || '(개별 파일)'; groups.set(f, [...(groups.get(f) || []), t]) }
    content = [...groups.entries()].sort().map(([f, list]) => (
      <div key={f} className="mb-2">
        <div className="text-xs font-semibold text-mute px-2 py-1 flex items-center gap-1.5"><IFolder size={14} />{f} <span className="font-normal">({list.length})</span></div>
        {list.map((t) => <Row key={t.id} t={t} on={t.id === current} analyzed={analyzed.has(t.id)} />)}
      </div>
    ))
  }
  const empty = Array.isArray(content) && content.length === 0
  return (
    <div className={compact ? 'flex flex-col h-full' : 'card p-3'}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="label">라이브러리 · {tracks.length}곡</span>
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-icon h-7 w-7" onClick={() => openFiles('files')} title="파일 추가"><IOpen size={15} /></button>
          <button className="btn btn-ghost btn-icon h-7 w-7" onClick={() => openFiles('folder')} title="폴더 추가"><IFolder size={15} /></button>
        </div>
      </div>
      <div className="flex gap-1 mb-2 flex-wrap">
        {([['playlist', '재생목록'], ['folders', '폴더'], ['recent', '최근'], ['favorites', '즐겨찾기']] as [View, string][]).map(([v, l]) => (
          <button key={v} className={`chip ${view === v ? 'chip-on' : ''}`} onClick={() => setView(v)}>{l}</button>
        ))}
      </div>
      <input className="input h-8 w-full mb-2" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className={`${compact ? 'flex-1 min-h-0' : 'max-h-[60vh]'} overflow-y-auto scrollbar-thin -mx-1`}>
        {empty ? <div className="text-sm text-mute px-2 py-6 text-center">{view === 'favorites' ? '★ 를 눌러 즐겨찾기에 추가하세요.' : '곡이 없습니다. 파일을 열거나 끌어다 놓으세요.'}</div> : content}
      </div>
    </div>
  )
}

function Row({ t, on, analyzed, idx, reorder }: { t: TrackMeta; on: boolean; analyzed: boolean; idx?: number; reorder?: boolean }) {
  return (
    <div className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg ${on ? 'bg-accent/15' : 'hover:bg-panel2'}`}>
      {idx !== undefined && <span className="text-[11px] text-mute w-5 text-right tabular">{idx}</span>}
      <button className="flex-1 min-w-0 text-left" onClick={() => selectTrack(t.id, { autoplay: false, restore: true })} onDoubleClick={() => selectTrack(t.id, { autoplay: true })}>
        <div className={`text-sm truncate ${on ? 'text-accent font-medium' : ''}`}>{t.name.replace(/\.[^.]+$/, '')}</div>
        <div className="text-[11px] text-mute flex gap-2">
          <span>{t.duration ? fmtTime(t.duration) : t.name.split('.').pop()?.toUpperCase()}</span>
          {analyzed && <span className="text-accent2">분석됨</span>}
          {t.notes && <span>메모</span>}
          {t.lastPosition ? <span>이어듣기 {fmtTime(t.lastPosition)}</span> : null}
        </div>
      </button>
      <button className={`${t.favorite ? 'text-accent' : 'text-mute opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'} transition`} onClick={() => updateTrack(t.id, { favorite: !t.favorite })} title="즐겨찾기"><IStar size={15} filled={t.favorite} /></button>
      {reorder && (
        <div className="flex flex-col opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition">
          <button className="text-mute hover:text-fg" onClick={() => movePlaylist(t.id, -1)} title="위로"><IUp size={12} /></button>
          <button className="text-mute hover:text-fg" onClick={() => movePlaylist(t.id, 1)} title="아래로"><IDown size={12} /></button>
        </div>
      )}
      <button className="text-mute hover:text-warn opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 transition" onClick={() => { if (confirm(`"${t.name}" 을(를) 라이브러리에서 제거할까요? (원본 파일은 삭제되지 않습니다)`)) removeTrack(t.id) }} title="목록에서 제거"><ITrash size={15} /></button>
    </div>
  )
}
