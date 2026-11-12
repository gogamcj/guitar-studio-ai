import { engine } from '../engine/AudioEngine'
import { fmtTime } from '../lib/music'
import { FOCUS_MODES } from '../engine/focus'
import { nextTrack, seek, setClickOn, setFocus, setFocusAmount, setLoop, setLoopPoint, setMusicMute, setPitch, setRate, togglePlay, updateSettings, useApp } from '../store/app'
import { useEngine, usePosition } from './hooks'
import { IMetronome, INext, IPause, IPlay, IPrev, IRepeat, IVolume } from './icons'

export const RATES = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.5, 2.0]

export function Transport() {
  useEngine()
  const pos = usePosition(20)
  const duration = useApp((s) => s.duration)
  const hasTrack = useApp((s) => !!s.currentId && s.duration > 0)
  const rate = useApp((s) => s.rate)
  const pitch = useApp((s) => s.pitch)
  const loop = useApp((s) => s.loop)
  const clickOn = useApp((s) => s.clickOn)
  const musicMute = useApp((s) => s.musicMute)
  const volume = useApp((s) => s.settings.volume)
  const focus = useApp((s) => s.focus)
  const focusAmount = useApp((s) => s.settings.focusAmount)
  const hasBeats = useApp((s) => !!s.analysis?.beats.length)
  const playing = engine.playing
  const countIn = engine.countIn

  return (
    <div className="border-t border-line/60 bg-panel/90 backdrop-blur-xl safe-bottom">
      {/* 진행 바 */}
      <div className="flex items-center gap-3 px-4 pt-2">
        <span className="text-xs tabular text-mute w-12 text-right">{fmtTime(pos)}</span>
        <input type="range" className="flex-1 h-1.5" min={0} max={duration || 1} step={0.01} value={Math.min(pos, duration || 1)} disabled={!hasTrack} onChange={(e) => seek(+e.target.value)} aria-label="재생 위치" />
        <span className="text-xs tabular text-mute w-12">{fmtTime(duration)}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 sm:px-4 py-2">
        {/* 재생 컨트롤 */}
        <div className="flex items-center gap-1.5 order-1">
          <button className="btn btn-ghost btn-icon h-11 w-11" onClick={() => nextTrack(-1)} disabled={!hasTrack} title="이전 곡 (처음으로)"><IPrev size={20} /></button>
          <button className="btn btn-accent h-12 w-12 rounded-full px-0" onClick={togglePlay} disabled={!hasTrack} title="재생/일시정지 (Space)">
            {playing ? <IPause size={22} /> : <IPlay size={22} />}
          </button>
          <button className="btn btn-ghost btn-icon h-11 w-11" onClick={() => nextTrack(1)} disabled={!hasTrack} title="다음 곡"><INext size={20} /></button>
          {countIn > 0 && <span className="text-xs font-semibold text-accent ml-1">카운트인…</span>}
        </div>
        {/* 배속 / 피치 */}
        <div className="flex items-center gap-3 order-3 sm:order-2 w-full sm:w-auto justify-center">
          <label className="flex items-center gap-1.5">
            <span className="label">배속</span>
            <select className="input h-8 text-xs" value={RATES.includes(rate) ? rate : 'custom'} onChange={(e) => setRate(+e.target.value)} aria-label="배속">
              {RATES.map((r) => <option key={r} value={r}>{r.toFixed(1)}×</option>)}
              {!RATES.includes(rate) && <option value="custom">{rate.toFixed(2)}×</option>}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <span className="label">피치</span>
            <button className="chip w-7 justify-center" onClick={() => setPitch(pitch - 1)} title="반음 내림">−</button>
            <button className="chip min-w-[3.4rem] justify-center tabular" onClick={() => setPitch(0)} title="원래 음정으로">{pitch > 0 ? '+' : ''}{Number.isInteger(pitch) ? pitch : pitch.toFixed(1)}</button>
            <button className="chip w-7 justify-center" onClick={() => setPitch(pitch + 1)} title="반음 올림">+</button>
          </div>
        </div>
        {/* 반복 / 메트로놈 / 볼륨 */}
        <div className="flex items-center gap-1.5 order-2 sm:order-3">
          <button className="chip" onClick={() => setLoopPoint('a')} disabled={!hasTrack} title="현재 위치를 A 로 ([)">A</button>
          <button className="chip" onClick={() => setLoopPoint('b')} disabled={!hasTrack} title="현재 위치를 B 로 (])">B</button>
          <button className={`btn btn-icon h-9 ${loop.enabled ? 'btn-accent' : ''}`} onClick={() => setLoop({ enabled: !loop.enabled })} disabled={!hasTrack || loop.b <= loop.a} title="A-B 반복 (L)"><IRepeat /></button>
          <button className={`btn btn-icon h-9 ${clickOn ? 'btn-accent' : ''}`} onClick={() => setClickOn(!clickOn)} disabled={!hasBeats} title={hasBeats ? '메트로놈 클릭 ON/OFF (M)' : '분석 후 사용 가능'}><IMetronome /></button>
          <button className={`chip ${musicMute ? 'chip-on' : ''}`} onClick={() => setMusicMute(!musicMute)} disabled={!hasBeats} title="원곡 음소거 (클릭만 재생)">클릭만</button>
          <div className="hidden md:flex items-center gap-1.5 ml-1">
            <IVolume size={16} className="text-mute" />
            <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => updateSettings({ volume: +e.target.value })} className="w-24" aria-label="볼륨" />
          </div>
        </div>
      </div>
      {/* 악기 강조 (주파수 대역·스테레오 위치 기반, 실제 분리 아님) */}
      <div className="flex flex-wrap items-center justify-center gap-1.5 px-3 sm:px-4 pb-2" role="group" aria-label="악기 강조">
        <span className="label mr-1" title="실제 음원 분리가 아니라, 악기가 주로 차지하는 음역대와 좌우 위치를 강조합니다">악기 강조</span>
        <button className={`chip ${focus === 'off' ? 'chip-on' : ''}`} onClick={() => setFocus('off')} disabled={!hasTrack} aria-pressed={focus === 'off'}>원음</button>
        {FOCUS_MODES.map((f) => (
          <button key={f.id} className={`chip ${focus === f.id ? 'chip-on' : ''}`} onClick={() => setFocus(focus === f.id ? 'off' : f.id)} disabled={!hasTrack} title={f.hint} aria-pressed={focus === f.id}>{f.label}</button>
        ))}
        {focus !== 'off' && (
          <label className="flex items-center gap-1.5 ml-1">
            <span className="label">세기</span>
            <input type="range" min={0.1} max={1} step={0.05} value={focusAmount} onChange={(e) => setFocusAmount(+e.target.value)} className="w-20" aria-label="강조 세기" />
          </label>
        )}
      </div>
    </div>
  )
}
