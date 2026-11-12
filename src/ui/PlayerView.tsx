import { useState } from 'react'
import { fmtTime } from '../lib/music'
import { addMarker, deleteLoopRegion, deleteMarker, relinkFile, runAnalysis, saveCurrentLoop, seek, setLoop, snapLoopToBeats, updateLoopRegion, updateTrack, useApp } from '../store/app'
import { ChordLane, ChordTable } from './Chords'
import { Stats } from './Stats'
import { Waveform } from './Waveform'
import { IFlag, IRepeat, ISpark, IStar, ITrash } from './icons'

export function TrackHeader() {
  const t = useApp((s) => s.tracks.find((x) => x.id === s.currentId))
  const analyzing = useApp((s) => s.analyzing)
  const a = useApp((s) => s.analysis)
  if (!t) return null
  const ext = t.name.split('.').pop()?.toUpperCase()
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold truncate" title={t.name}>{t.name.replace(/\.[^.]+$/, '')}</h1>
        <div className="text-xs text-mute mt-0.5 flex flex-wrap gap-x-3">
          <span>{ext}</span>
          {t.duration && <span>{fmtTime(t.duration)}</span>}
          {t.sampleRate && <span>{(t.sampleRate / 1000).toFixed(1)}kHz · {t.channels === 1 ? '모노' : '스테레오'}</span>}
          <span>{(t.size / 1048576).toFixed(1)}MB</span>
          {t.folder && <span className="truncate max-w-[16rem]">📁 {t.folder}</span>}
          {a && <span>분석: {new Date(a.analyzedAt).toLocaleString()}{a.userEdited ? ' · 사용자 수정됨' : ''}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button className="btn btn-ghost btn-icon" onClick={() => updateTrack(t.id, { favorite: !t.favorite })} title="즐겨찾기"><IStar filled={t.favorite} className={t.favorite ? 'text-accent' : ''} /></button>
        {!analyzing && <button className="btn" onClick={runAnalysis} title="다시 분석">{a ? '재분석' : '분석'}</button>}
      </div>
    </div>
  )
}

export function AnalyzeProgress() {
  const p = useApp((s) => s.analyzing)
  if (!p) return null
  const stages: Record<string, string> = { start: '준비', resample: '오디오 준비', onset: '리듬(온셋) 분석', tempo: 'BPM·비트 추적', pitch: '음정(크로마) 분석', meter: '박자·다운비트', key: 'Key 분석', chords: '코드 인식', structure: '곡 구조', done: '완료' }
  return (
    <div className="card p-3 flex items-center gap-3">
      <ISpark className="text-accent animate-spin" style={{ animationDuration: '3s' }} />
      <div className="flex-1">
        <div className="flex justify-between text-xs mb-1"><span>AI 분석 중 · {stages[p.stage] || p.stage}</span><span className="tabular">{Math.round(p.p * 100)}%</span></div>
        <div className="h-1.5 rounded bg-panel2 overflow-hidden"><div className="h-full bg-accent transition-all" style={{ width: `${p.p * 100}%` }} /></div>
      </div>
    </div>
  )
}

function LoopPanel() {
  const loop = useApp((s) => s.loop)
  const loops = useApp((s) => s.loops)
  const markers = useApp((s) => s.markers)
  const hasBeats = useApp((s) => !!s.analysis?.beats.length)
  const [name, setName] = useState('')
  return (
    <div className="card p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="label">A-B 구간 반복</span>
        <span className="text-xs tabular text-mute">{loop.b > loop.a ? `${fmtTime(loop.a, true)} – ${fmtTime(loop.b, true)} (${(loop.b - loop.a).toFixed(1)}초)` : '파형을 드래그하거나 A / B 버튼으로 지정'}</span>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center">
        <button className={`chip ${loop.enabled ? 'chip-on' : ''}`} disabled={loop.b <= loop.a} onClick={() => setLoop({ enabled: !loop.enabled })}><IRepeat size={13} className="mr-1" />{loop.enabled ? '반복 중' : '반복 켜기'}</button>
        <label className="chip gap-1">횟수
          <select className="bg-transparent outline-none" value={loop.repeat} onChange={(e) => setLoop({ repeat: +e.target.value })}>
            <option value={0}>무한</option>{[2, 3, 4, 5, 8, 10, 20].map((n) => <option key={n} value={n}>{n}회</option>)}
          </select>
        </label>
        {hasBeats && <button className="chip" disabled={loop.b <= loop.a} onClick={snapLoopToBeats}>비트에 맞춤</button>}
        <button className="chip" disabled={loop.b <= loop.a} onClick={() => setLoop({ a: 0, b: 0, enabled: false })}>해제</button>
      </div>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (loop.b > loop.a) { saveCurrentLoop(name || `구간 ${loops.length + 1}`); setName('') } }}>
        <input className="input h-8 flex-1" placeholder="구간 이름 (예: 기타 솔로)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn h-8" disabled={loop.b <= loop.a}>구간 저장</button>
      </form>
      {loops.length > 0 && (
        <div className="space-y-1">
          {loops.map((l) => (
            <div key={l.id} className="rounded-lg bg-panel2/60 px-2 py-1.5">
              <div className="flex items-center gap-2 text-sm">
                <button className="font-medium hover:text-accent text-left flex-1 truncate" onClick={() => { setLoop({ a: l.a, b: l.b, repeat: l.repeat, enabled: true }); seek(l.a) }}>{l.name}</button>
                <span className="text-xs tabular text-mute">{fmtTime(l.a)}–{fmtTime(l.b)}</span>
                <button className="text-mute hover:text-warn" onClick={() => deleteLoopRegion(l.id)} title="삭제"><ITrash size={14} /></button>
              </div>
              <input className="w-full bg-transparent text-xs text-mute outline-none mt-0.5" placeholder="연습 메모…" defaultValue={l.note} onBlur={(e) => updateLoopRegion(l.id, { note: e.target.value })} />
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1 border-t border-line/50">
        <span className="label">마커</span>
        <button className="chip" onClick={() => addMarker()}><IFlag size={13} className="mr-1" />현재 위치에 마커</button>
      </div>
      {markers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {markers.map((m) => (
            <span key={m.id} className="chip gap-1.5">
              <button onClick={() => seek(m.t)}>{m.name} · {fmtTime(m.t)}</button>
              <button className="text-mute hover:text-warn" onClick={() => deleteMarker(m.id)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function NotesPanel() {
  const t = useApp((s) => s.tracks.find((x) => x.id === s.currentId))
  if (!t) return null
  return (
    <div className="card p-3">
      <div className="label mb-1.5">곡 연습 메모</div>
      <textarea key={t.id} className="w-full min-h-[5rem] bg-panel2/60 rounded-lg p-2 text-sm outline-none focus:ring-1 ring-accent resize-y" placeholder="카포 위치, 튜닝, 주법, 어려운 부분…" defaultValue={t.notes} onBlur={(e) => updateTrack(t.id, { notes: e.target.value })} />
    </div>
  )
}

export function NeedsFile() {
  const t = useApp((s) => s.needsFile)
  if (!t) return null
  return (
    <div className="card p-4 border-accent/50">
      <div className="font-medium">"{t.name}" 파일을 다시 선택해 주세요</div>
      <p className="text-sm text-mute mt-1">개인정보 보호를 위해 브라우저는 앱을 다시 열면 파일 접근 권한을 유지하지 않습니다. 같은 파일을 선택하면 저장된 분석 결과·구간·메모가 그대로 복원됩니다. (설정 → "음원 사본 보관"을 켜면 다음부터는 자동으로 열립니다)</p>
      <button className="btn btn-accent mt-3" onClick={() => relinkFile(t)}>파일 선택</button>
    </div>
  )
}

export function PlayerView() {
  const hasTrack = useApp((s) => !!s.currentId)
  const loading = useApp((s) => s.loading)
  const a = useApp((s) => s.analysis)
  const duration = useApp((s) => s.duration)
  if (!hasTrack) return <Welcome />
  return (
    <div className="space-y-3">
      <TrackHeader />
      <NeedsFile />
      {loading && <div className="card p-4 text-sm text-mute">불러오는 중… (디코딩)</div>}
      <AnalyzeProgress />
      {duration > 0 && (
        <>
          <Stats />
          <div className="card p-3"><Waveform /></div>
          <ChordLane />
          {!a && <div className="card p-4 text-sm text-mute">아직 분석 결과가 없습니다. 상단의 <b className="text-fg">분석</b> 버튼을 누르면 이 기기 안에서 BPM·박자·Key·코드를 분석합니다. 음악 파일은 외부로 전송되지 않습니다.</div>}
          <div className="grid lg:grid-cols-2 gap-3">
            {a && a.chords.length > 0 ? <ChordTable /> : <NotesPanel />}
            <LoopPanel />
          </div>
          {a && a.chords.length > 0 && <NotesPanel />}
        </>
      )}
    </div>
  )
}

function Welcome() {
  return (
    <div className="h-full grid place-items-center text-center py-16">
      <div className="max-w-md">
        <div className="text-5xl mb-4">🎸</div>
        <h1 className="text-2xl font-semibold">Guitar Studio AI</h1>
        <p className="text-mute mt-2 text-sm">음악 파일을 열거나 이 창에 끌어다 놓으세요. MP3 · WAV · FLAC · M4A · AAC · OGG.<br />모든 분석은 이 기기 안에서만 처리되며 파일은 외부로 전송되지 않습니다.</p>
        <p className="text-mute mt-4 text-xs">단축키: Space 재생 · ←/→ 5초 이동 · [ ] A/B 지정 · L 반복 · M 클릭 · 1~3 탭 전환</p>
      </div>
    </div>
  )
}
