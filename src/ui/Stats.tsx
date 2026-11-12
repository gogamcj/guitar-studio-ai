import { useState } from 'react'
import { camelot, displayChordLabel, keyName, noteName, transposePc } from '../lib/music'
import { createManualAnalysis, displayTranspose, editBpm, editKey, editMeter, nudgeBeats, resetTranspose, setDownbeatAt, useApp } from '../store/app'
import { engine } from '../engine/AudioEngine'
import { beatAt, chordAt, confColor, confLabel, usePosition } from './hooks'
import { Modal } from './Modal'

function Tile({ label, value, sub, conf, source, onEdit, big }: { label: string; value: React.ReactNode; sub?: React.ReactNode; conf?: number; source?: 'ai' | 'user'; onEdit?: () => void; big?: boolean }) {
  return (
    <div className="card px-4 py-3 min-w-0 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        {onEdit && <button className="text-[11px] text-accent hover:underline" onClick={onEdit}>수정</button>}
      </div>
      <div className={`${big ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl'} font-semibold tabular tracking-tight mt-1 truncate`}>{value}</div>
      <div className="text-[11px] mt-0.5 min-h-[1rem] truncate">
        {conf !== undefined && source && <span className={source === 'user' ? 'text-accent2' : confColor(conf)}>{confLabel(conf, source)}</span>}
        {sub && <span className="text-mute"> {sub}</span>}
      </div>
    </div>
  )
}

export function Stats() {
  const a = useApp((s) => s.analysis)
  const tr = useApp((s) => displayTranspose(s))
  const pos = usePosition(30)
  const [edit, setEdit] = useState<null | 'bpm' | 'meter' | 'key'>(null)
  const { beat } = beatAt(a, pos)
  const { chord } = chordAt(a, pos)
  const none = <span className="text-mute">—</span>
  const k = a?.key.value
  const shownTonic = k ? transposePc(k.tonic, tr) : 0
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
        <Tile label="BPM" value={a ? a.bpm.value.toFixed(a.bpm.value % 1 ? 1 : 0) : none} conf={a?.bpm.confidence} source={a?.bpm.source} sub={a ? (a.tempoStable ? '· 일정한 템포' : '· 템포 변화 있음') : '분석 전'} onEdit={() => setEdit('bpm')} />
        <Tile label="박자" value={a ? `${a.meter.value}/${a.meterDenominator}` : none} conf={a?.meter.confidence} source={a?.meter.source} onEdit={a ? () => setEdit('meter') : undefined} />
        <Tile label="Key" value={k && a.key.confidence > 0 ? keyName(shownTonic, k.mode) : none} conf={a && a.key.confidence > 0 ? a.key.confidence : undefined} source={a?.key.source} sub={k && a!.key.confidence > 0 ? `· Camelot ${camelot(shownTonic, k.mode)}${tr ? ` · 이조 ${tr > 0 ? '+' : ''}${tr}` : ''}` : undefined} onEdit={a ? () => setEdit('key') : undefined} />
        <Tile label="현재 코드" big value={chord && a ? displayChordLabel(chord, tr, a.key.value.tonic, a.key.value.mode) : none} conf={chord?.confidence} source={chord?.source} />
        <Tile label="마디 · 박" value={beat ? <>{beat.bar > 0 ? beat.bar : '픽업'}<span className="text-mute text-xl"> · {beat.beat}</span></> : none} sub={a ? `/ ${a.meter.value}박` : undefined} />
      </div>
      {edit === 'bpm' && <BpmEditor onClose={() => setEdit(null)} />}
      {edit === 'meter' && <MeterEditor onClose={() => setEdit(null)} />}
      {edit === 'key' && <KeyEditor onClose={() => setEdit(null)} />}
    </>
  )
}

function BpmEditor({ onClose }: { onClose: () => void }) {
  const a = useApp((s) => s.analysis)
  const [v, setV] = useState(String(a?.bpm.value ?? 120))
  const [first, setFirst] = useState(String((a?.beats[0]?.t ?? 0).toFixed(3)))
  const [meter, setMeter] = useState(4)
  const [taps, setTaps] = useState<number[]>([])
  const tap = () => {
    const now = performance.now()
    const t = [...taps.filter((x) => now - x < 3000), now]
    setTaps(t)
    if (t.length >= 3) setV(((60000 * (t.length - 1)) / (t[t.length - 1] - t[0])).toFixed(1))
  }
  return (
    <Modal title="BPM 수정" onClose={onClose}>
      {a ? (
        <div className="space-y-4">
          <div>
            <div className="label mb-1.5">하프타임 / 더블타임 보정 (분석된 비트 위치 유지)</div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => { editBpm('half'); onClose() }}>÷2 ({(a.bpm.value / 2).toFixed(1)})</button>
              <button className="btn" onClick={() => { editBpm('double'); onClose() }}>×2 ({(a.bpm.value * 2).toFixed(1)})</button>
            </div>
          </div>
          <div>
            <div className="label mb-1.5">직접 입력 (일정한 템포 그리드로 다시 생성, 첫 비트 위치 유지)</div>
            <div className="flex gap-2">
              <input className="input w-28 tabular" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} />
              <button className="btn" onClick={tap}>탭 템포</button>
              <button className="btn btn-accent" onClick={() => { const n = parseFloat(v); if (n > 10 && n < 400) { editBpm('set', n); onClose() } }}>적용</button>
            </div>
          </div>
          <div>
            <div className="label mb-1.5">클릭 싱크 미세 보정 (비트 전체 이동)</div>
            <div className="flex gap-2 flex-wrap">
              {[-20, -5, 5, 20].map((ms) => <button key={ms} className="chip" onClick={() => nudgeBeats(ms)}>{ms > 0 ? '+' : ''}{ms}ms</button>)}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-mute">아직 분석 결과가 없습니다. 분석이 실패했거나 분석 없이 사용하려면 BPM 과 첫 박 위치를 직접 입력하세요. 입력값은 "사용자 확정"으로 표시됩니다.</p>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">BPM<input className="input w-full mt-1" value={v} onChange={(e) => setV(e.target.value)} /></label>
            <label className="text-xs">첫 박(초)<input className="input w-full mt-1" value={first} onChange={(e) => setFirst(e.target.value)} /></label>
            <label className="text-xs">박자<select className="input w-full mt-1" value={meter} onChange={(e) => setMeter(+e.target.value)}>{[2, 3, 4, 5, 6, 7].map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={tap}>탭 템포</button>
            <button className="btn" onClick={() => setFirst(engine.position.toFixed(3))}>현재 위치를 첫 박으로</button>
            <button className="btn btn-accent ml-auto" onClick={() => { const n = parseFloat(v), f = parseFloat(first); if (n > 10 && n < 400 && f >= 0) { createManualAnalysis(n, f, meter); onClose() } }}>적용</button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function MeterEditor({ onClose }: { onClose: () => void }) {
  const a = useApp((s) => s.analysis)!
  const opts: [number, string][] = [[2, '2/4'], [3, '3/4'], [4, '4/4'], [5, '5/4'], [6, '6/8'], [7, '7/8'], [9, '9/8'], [12, '12/8']]
  return (
    <Modal title="박자표 수정" onClose={onClose}>
      <div className="flex flex-wrap gap-2 mb-4">
        {opts.map(([m, l]) => <button key={l} className={`chip h-9 px-3 ${a.meter.value === m ? 'chip-on' : ''}`} onClick={() => editMeter(m)}>{l}</button>)}
      </div>
      <div className="label mb-1.5">다운비트(마디 첫 박) 위치</div>
      <p className="text-xs text-mute mb-2">마디 시작이 어긋나면, 실제 첫 박에서 재생을 멈추고 아래 버튼을 누르세요.</p>
      <button className="btn" onClick={() => { setDownbeatAt(engine.position); onClose() }}>현재 위치의 비트를 1박으로 설정</button>
    </Modal>
  )
}

function KeyEditor({ onClose }: { onClose: () => void }) {
  const a = useApp((s) => s.analysis)!
  const tr = a.transpose
  const [tonic, setTonic] = useState(transposePc(a.key.value.tonic, tr))
  const [mode, setMode] = useState(a.key.value.mode)
  const [transpose, setTranspose] = useState(true)
  return (
    <Modal title="Key 변경" onClose={onClose}>
      <div className="grid grid-cols-6 gap-1.5 mb-3">
        {Array.from({ length: 12 }, (_, i) => <button key={i} className={`chip h-9 justify-center ${tonic === i ? 'chip-on' : ''}`} onClick={() => setTonic(i)}>{noteName(i)}</button>)}
      </div>
      <div className="flex gap-2 mb-3">
        <button className={`chip h-9 px-3 ${mode === 'major' ? 'chip-on' : ''}`} onClick={() => setMode('major')}>Major</button>
        <button className={`chip h-9 px-3 ${mode === 'minor' ? 'chip-on' : ''}`} onClick={() => setMode('minor')}>Minor</button>
      </div>
      <label className="flex items-start gap-2 text-sm mb-1">
        <input type="checkbox" className="mt-1" checked={transpose} onChange={(e) => setTranspose(e.target.checked)} />
        <span>코드 표시도 함께 이조 <span className="block text-xs text-mute">켜면: 카포/다른 키로 연주할 때 모든 코드를 변환해 표시합니다. 끄면: 분석된 Key 가 틀렸을 때 Key 이름만 정정합니다.</span></span>
      </label>
      <div className="flex gap-2 mt-4">
        {tr !== 0 && <button className="btn" onClick={() => { resetTranspose(); onClose() }}>원래 Key 로</button>}
        <button className="btn btn-accent ml-auto" onClick={() => { editKey(tonic, mode, transpose); onClose() }}>적용</button>
      </div>
    </Modal>
  )
}
