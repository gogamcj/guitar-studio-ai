import { useEffect, useState } from 'react'
import { YouTubeView } from './ui/YouTubeView'
import { addFiles, getState, init, nextTrack, persistSession, seek, setClickOn, setLoop, setLoopPoint, setState, togglePlay, useApp } from './store/app'
import { engine } from './engine/AudioEngine'
import { Header, MobileTabs } from './ui/Header'
import { Transport } from './ui/Transport'
import { PlayerView } from './ui/PlayerView'
import { CopyView } from './ui/CopyView'
import { ReportView } from './ui/ReportView'
import { LibraryView } from './ui/LibraryView'
import { SettingsView } from './ui/SettingsView'
import { isAudioName } from './platform/files'

export default function App() {
  const tab = useApp((s) => s.tab)
  const ready = useApp((s) => s.ready)
  const error = useApp((s) => s.error)
  const toastMsg = useApp((s) => s.toast)
  const [dragOver, setDragOver] = useState(false)

  useEffect(() => { init() }, [])
  useEffect(() => { persistSession(); if (tab === 'youtube' && engine.playing) togglePlay() }, [tab])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const s = getState()
      if (s.tab === 'youtube') return // YouTube 탭에서는 내 파일 재생 단축키를 쓰지 않음
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break
        case 'ArrowLeft': seek(engine.position - (e.shiftKey ? 1 : 5)); break
        case 'ArrowRight': seek(engine.position + (e.shiftKey ? 1 : 5)); break
        case '[': setLoopPoint('a'); break
        case ']': setLoopPoint('b'); break
        case 'l': case 'L': if (s.loop.b > s.loop.a) setLoop({ enabled: !s.loop.enabled }); break
        case 'm': case 'M': if (s.analysis) setClickOn(!s.clickOn); break
        case 'n': case 'N': nextTrack(1); break
        case '1': setState({ tab: 'player' }); break
        case '2': setState({ tab: 'copy' }); break
        case '3': setState({ tab: 'report' }); break
      }
    }
    const onHide = () => persistSession()
    window.addEventListener('keydown', onKey)
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide) }
  }, [])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const list = Array.from(e.dataTransfer.files).filter((f) => isAudioName(f.name))
    if (list.length) await addFiles(list.map((file) => ({ file })), true)
  }

  return (
    <div className="h-full flex flex-col" onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }} onDrop={onDrop}>
      <Header />
      <div className="flex-1 min-h-0 flex">
        <aside className="hidden xl:flex w-80 shrink-0 border-r border-line/60 p-3 flex-col">
          <LibraryView compact />
        </aside>
        <main className="flex-1 min-w-0 overflow-y-auto scrollbar-thin">
          <div className="max-w-6xl mx-auto p-3 sm:p-5">
            {!ready && <div className="text-mute text-sm">불러오는 중…</div>}
            {error && (
              <div className="card border-warn/50 p-3 mb-3 text-sm flex items-start gap-3">
                <span className="text-warn font-semibold">오류</span>
                <span className="flex-1">{error}</span>
                <button className="text-mute" onClick={() => setState({ error: null })}>닫기</button>
              </div>
            )}
            {tab === 'player' && <PlayerView />}
            {tab === 'copy' && <CopyView />}
            {tab === 'report' && <ReportView />}
            {tab === 'youtube' && <YouTubeView />}
            {tab === 'library' && <LibraryView />}
            {tab === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
      {tab !== 'youtube' && <Transport />}
      <MobileTabs />
      {dragOver && <div className="fixed inset-0 z-40 bg-accent/10 border-4 border-dashed border-accent pointer-events-none grid place-items-center text-xl font-semibold">여기에 음악 파일을 놓으세요</div>}
      {toastMsg && <div className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50 bg-fg text-bg text-sm px-4 py-2 rounded-full shadow-lg">{toastMsg}</div>}
    </div>
  )
}
