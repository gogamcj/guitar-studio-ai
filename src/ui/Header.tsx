import { cancelAnalysis, openFiles, runAnalysis, setState, updateSettings, useApp, type Tab } from '../store/app'
import { IFolder, IGear, IGuitar, IList, IMoon, IOpen, IReport, ISpark, ISun, IWave } from './icons'

export const TABS: [Tab, string, (p: { size?: number }) => React.ReactElement][] = [
  ['player', '플레이어', IWave],
  ['copy', '카피 모드', IGuitar],
  ['report', '분석 리포트', IReport],
  ['library', '라이브러리', IList],
  ['settings', '설정', IGear],
]

export function Header() {
  const theme = useApp((s) => s.settings.theme)
  const tab = useApp((s) => s.tab)
  const analyzing = useApp((s) => s.analyzing)
  const canAnalyze = useApp((s) => !!s.currentId && s.duration > 0)
  return (
    <header className="safe-top border-b border-line/60 bg-panel/80 backdrop-blur-xl sticky top-0 z-30">
      <div className="flex items-center gap-2 px-3 sm:px-4 h-14">
        <div className="flex items-center gap-2 mr-2 shrink-0">
          <img src="./favicon.svg" alt="" className="w-7 h-7" />
          <span className="font-semibold tracking-tight hidden sm:inline">Guitar Studio <span className="text-accent">AI</span></span>
        </div>
        <nav className="hidden md:flex items-center gap-0.5 mx-2">
          {TABS.filter(([t]) => t !== 'library' && t !== 'settings').map(([t, l, I]) => (
            <button key={t} className={`btn btn-ghost h-8 ${tab === t ? 'bg-panel2 text-fg' : 'text-mute'}`} onClick={() => setState({ tab: t })}><I size={16} />{l}</button>
          ))}
        </nav>
        <div className="flex-1" />
        <button className="btn" onClick={() => openFiles('files')} title="음악 파일 열기"><IOpen /><span className="hidden sm:inline">열기</span></button>
        <button className="btn hidden sm:inline-flex" onClick={() => openFiles('folder')} title="폴더 열기"><IFolder /><span className="hidden lg:inline">폴더</span></button>
        {analyzing ? (
          <button className="btn" onClick={cancelAnalysis} title="분석 취소"><ISpark className="animate-spin text-accent" />{Math.round(analyzing.p * 100)}%</button>
        ) : (
          <button className="btn btn-accent" onClick={runAnalysis} disabled={!canAnalyze} title="AI 분석 시작"><ISpark /><span className="hidden sm:inline">분석</span></button>
        )}
        <button className={`btn btn-ghost btn-icon hidden md:inline-flex ${tab === 'settings' ? 'bg-panel2' : ''}`} onClick={() => setState({ tab: 'settings' })} title="환경설정"><IGear /></button>
        <button className="btn btn-ghost btn-icon" onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })} title="테마 변경">{theme === 'dark' ? <ISun /> : <IMoon />}</button>
      </div>
    </header>
  )
}

export function MobileTabs() {
  const tab = useApp((s) => s.tab)
  return (
    <nav className="md:hidden grid grid-cols-5 border-t border-line/60 bg-panel/95">
      {TABS.map(([t, l, I]) => (
        <button key={t} className={`flex flex-col items-center gap-0.5 py-1.5 text-[10px] ${tab === t ? 'text-accent' : 'text-mute'}`} onClick={() => setState({ tab: t })}><I size={20} />{l}</button>
      ))}
    </nav>
  )
}
