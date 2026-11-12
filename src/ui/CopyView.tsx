import { camelot, displayChordLabel, fmtTime, keyName, transposePc } from '../lib/music'
import { displayTranspose, setClickOn, togglePlay, useApp } from '../store/app'
import { beatAt, chordAt, useEngine, usePosition } from './hooks'
import { IMetronome, IPause, IPlay } from './icons'
import { engine } from '../engine/AudioEngine'

/** 기타 카피 모드: 멀리서도 보이는 큰 글씨 */
export function CopyView() {
  useEngine()
  const a = useApp((s) => s.analysis)
  const tr = useApp((s) => displayTranspose(s))
  const loop = useApp((s) => s.loop)
  const rate = useApp((s) => s.rate)
  const duration = useApp((s) => s.duration)
  const clickOn = useApp((s) => s.clickOn)
  const pos = usePosition(60)
  if (!a) return <div className="card p-8 text-center text-mute">카피 모드는 분석 후 사용할 수 있습니다. 곡을 열고 <b className="text-fg">분석</b>을 눌러 주세요.</div>
  const { idx: bi, beat } = beatAt(a, pos)
  const { idx: ci, chord } = chordAt(a, pos)
  const next = a.chords.slice(ci + 1).find((c) => c.root >= 0 || c.end - c.start > 1)
  const lab = (c: typeof chord) => (c ? displayChordLabel(c, tr, a.key.value.tonic, a.key.value.mode) : '—')
  // 다음 코드까지 남은 박 수
  let beatsToNext = -1
  if (next && bi >= 0) {
    beatsToNext = 0
    for (let i = bi + 1; i < a.beats.length && a.beats[i].t < next.start - 0.03; i++) beatsToNext++
    beatsToNext += 1
  }
  const soon = beatsToNext > 0 && beatsToNext <= a.meter.value
  const shownTonic = transposePc(a.key.value.tonic, tr)
  const upcoming = a.chords.slice(ci + 1).filter((c) => c.root >= 0).slice(0, 6)
  const remain = loop.enabled && loop.b > loop.a ? (loop.b - pos) / rate : (duration - pos) / rate
  const beatPhase = beat && bi + 1 < a.beats.length ? (pos - beat.t) / (a.beats[bi + 1].t - beat.t) : 0
  const flash = engine.playing && beatPhase < 0.18
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Big label="BPM" value={(a.bpm.value * rate).toFixed(rate === 1 && a.bpm.value % 1 === 0 ? 0 : 1)} sub={rate !== 1 ? `원곡 ${a.bpm.value} × ${rate}` : a.bpm.source === 'ai' ? `AI ${Math.round(a.bpm.confidence * 100)}%` : '사용자'} />
        <Big label="Key" value={a.key.confidence > 0 ? keyName(shownTonic, a.key.value.mode).replace(' Major', '').replace(' Minor', 'm') : '—'} sub={a.key.confidence > 0 ? camelot(shownTonic, a.key.value.mode) : ''} />
        <Big label="마디" value={beat ? (beat.bar > 0 ? String(beat.bar) : '픽업') : '—'} sub={`${a.meter.value}/${a.meterDenominator}`} />
        <Big label={loop.enabled ? '구간 남은 시간' : '남은 시간'} value={fmtTime(Math.max(0, remain))} sub={loop.enabled ? `${fmtTime(loop.a)}–${fmtTime(loop.b)} 반복` : ''} />
      </div>
      <div className="card p-6 sm:p-10 grid md:grid-cols-[1.4fr_1fr] gap-6 items-center">
        <div className="text-center">
          <div className="label">현재 코드</div>
          <div className={`font-bold tracking-tight leading-none mt-2 ${lab(chord).length > 6 ? 'text-7xl sm:text-8xl' : 'text-8xl sm:text-[10rem]'}`}>{lab(chord)}</div>
          <div className="text-xs text-mute mt-2">{chord ? (chord.source === 'user' ? '사용자 확정' : `AI 추정 · 신뢰도 ${Math.round(chord.confidence * 100)}%`) : ''}</div>
        </div>
        <div className={`text-center rounded-2xl p-5 transition-colors ${soon ? 'bg-accent/15 ring-2 ring-accent' : 'bg-panel2/60'}`}>
          <div className="label">다음 코드</div>
          <div className="text-6xl sm:text-7xl font-bold mt-2">{lab(next || null)}</div>
          <div className={`text-sm mt-2 tabular ${soon ? 'text-accent font-semibold' : 'text-mute'}`}>{next ? (beatsToNext > 0 ? `${beatsToNext}박 후` : '') : '끝'}</div>
        </div>
      </div>
      <div className="card p-5">
        <div className="flex items-center justify-center gap-3 sm:gap-5">
          {Array.from({ length: a.meter.value }, (_, i) => {
            const on = beat && beat.beat === i + 1
            return <div key={i} className={`rounded-full grid place-items-center font-bold text-2xl sm:text-3xl transition-all ${i === 0 ? 'w-16 h-16 sm:w-20 sm:h-20' : 'w-12 h-12 sm:w-16 sm:h-16'} ${on ? (flash ? 'bg-accent text-white scale-110' : 'bg-accent/70 text-white') : 'bg-panel2 text-mute'}`}>{i + 1}</div>
          })}
        </div>
        <div className="flex items-center justify-center gap-2 mt-5 flex-wrap">
          {upcoming.map((c, i) => <span key={i} className="chip h-9 px-3 text-base">{lab(c)}</span>)}
        </div>
        <div className="flex justify-center gap-2 mt-5">
          <button className="btn btn-accent h-14 w-14 rounded-full px-0" onClick={togglePlay}>{engine.playing ? <IPause size={26} /> : <IPlay size={26} />}</button>
          <button className={`btn h-14 px-5 rounded-full ${clickOn ? 'btn-accent' : ''}`} onClick={() => setClickOn(!clickOn)}><IMetronome size={22} /> 클릭 {clickOn ? 'ON' : 'OFF'}</button>
        </div>
      </div>
    </div>
  )
}

function Big({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4 text-center">
      <div className="label">{label}</div>
      <div className="text-4xl sm:text-5xl font-bold tabular mt-1">{value}</div>
      <div className="text-xs text-mute mt-1 h-4">{sub}</div>
    </div>
  )
}
