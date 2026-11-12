import { camelot, displayChordLabel, fmtTime, keyName, transposePc } from '../lib/music'
import { displayTranspose, seek, useApp } from '../store/app'
import { chordProgressionText } from './Chords'
import { download } from '../platform/files'
import { IDownload } from './icons'
import { usePosition } from './hooks'
import type { Analysis } from '../types'

function mainProgression(a: Analysis, tr: number) {
  const labs: string[] = []
  const phraseStart: boolean[] = [] // 4마디 프레이즈 시작(1, 5, 9…마디 첫 박) 여부
  for (const c of a.chords) {
    if (c.root < 0) continue
    const l = displayChordLabel(c, tr, a.key.value.tonic, a.key.value.mode)
    if (labs[labs.length - 1] === l) continue
    labs.push(l)
    const b = a.beats.find((x) => Math.abs(x.t - c.start) < 0.08)
    phraseStart.push(!!b && b.beat === 1 && b.bar % 4 === 1)
  }
  const count = new Map<string, number>()
  for (const n of [4, 3, 2]) {
    for (let i = 0; i + n <= labs.length; i++) {
      const g = labs.slice(i, i + n)
      if (new Set(g).size < n) continue
      const k = g.join(' - ')
      count.set(k, (count.get(k) || 0) + n + (phraseStart[i] ? 0.5 : 0))
    }
    const best = [...count.entries()].sort((x, y) => y[1] - x[1])[0]
    if (best && best[1] >= n * 2) return best[0]
    count.clear()
  }
  return labs.slice(0, 4).join(' - ')
}

const SEC_COLORS: Record<string, string> = { Intro: '#64d2ff', Verse: '#30d158', Chorus: '#ff9f0a', Bridge: '#bf5af2', Outro: '#8e8e93' }

export function ReportView() {
  const a = useApp((s) => s.analysis)
  const t = useApp((s) => s.tracks.find((x) => x.id === s.currentId))
  const tr = useApp((s) => displayTranspose(s))
  const pos = usePosition(15)
  if (!a || !t) return <div className="card p-8 text-center text-mute">분석이 완료되면 리포트가 표시됩니다.</div>
  const k = a.key.value
  const tonic = transposePc(k.tonic, tr)
  const name = t.name.replace(/\.[^.]+$/, '')
  const lab = (c: Analysis['chords'][0]) => displayChordLabel(c, tr, k.tonic, k.mode)
  const D = a.duration
  const report = [
    `곡 제목: ${name}`,
    `Key: ${a.key.confidence > 0 ? keyName(tonic, k.mode) + ` (Camelot ${camelot(tonic, k.mode)})` : '미확인'} [${a.key.source === 'user' ? '사용자' : `AI ${Math.round(a.key.confidence * 100)}%`}]`,
    `BPM: ${a.bpm.value} [${a.bpm.source === 'user' ? '사용자' : `AI ${Math.round(a.bpm.confidence * 100)}%`}]${a.tempoStable ? '' : ' (템포 변화 있음)'}`,
    `박자: ${a.meter.value}/${a.meterDenominator}`,
    `전체 길이: ${fmtTime(D)}`,
    `대표 코드 진행: ${mainProgression(a, tr)}`,
    '',
    '곡의 구간 (자동 추정):',
    ...a.sections.map((s) => `  ${fmtTime(s.start)}–${fmtTime(s.end)}  ${s.label}${s.certain ? '' : ' (추정)'}`),
    '',
    '마디별 코드:',
    chordProgressionText(a, tr, 'bars'),
  ].join('\n')
  return (
    <div className="space-y-3">
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="label">분석 리포트</div>
            <h1 className="text-2xl font-semibold mt-1">{name}</h1>
          </div>
          <div className="flex gap-1.5">
            <button className="btn" onClick={() => download(`${name}-report.txt`, report)}><IDownload size={15} />TXT</button>
            <button className="btn" onClick={() => download(`${name}-analysis.json`, JSON.stringify(a, null, 2), 'application/json')}>JSON</button>
          </div>
        </div>
        <dl className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-5">
          <Item k="Key" v={a.key.confidence > 0 ? keyName(tonic, k.mode) : '미확인'} s={a.key.confidence > 0 ? `Camelot ${camelot(tonic, k.mode)} · ${a.key.source === 'user' ? '사용자' : `신뢰도 ${Math.round(a.key.confidence * 100)}%`}` : ''} />
          <Item k="BPM" v={String(a.bpm.value)} s={`${a.tempoStable ? '일정' : '변화 있음'} · ${a.bpm.source === 'user' ? '사용자' : `신뢰도 ${Math.round(a.bpm.confidence * 100)}%`}`} />
          <Item k="박자" v={`${a.meter.value}/${a.meterDenominator}`} s={a.meter.source === 'user' ? '사용자' : `신뢰도 ${Math.round(a.meter.confidence * 100)}%`} />
          <Item k="전체 길이" v={fmtTime(D)} s={`${a.beats.length}비트 · ${Math.max(0, ...a.beats.map((b) => b.bar))}마디`} />
          <Item k="대표 진행" v={mainProgression(a, tr)} s="가장 자주 반복되는 진행" />
        </dl>
      </div>
      <div className="card p-5">
        <div className="label mb-3">구조 · 코드 타임라인</div>
        <div className="relative">
          {/* 구간 */}
          <div className="relative h-9 rounded-md overflow-hidden bg-panel2">
            {a.sections.map((s, i) => (
              <button key={i} onClick={() => seek(s.start)} className="absolute top-0 h-full text-[11px] font-semibold text-black/80 px-1 truncate border-r border-black/20"
                style={{ left: `${(s.start / D) * 100}%`, width: `${((s.end - s.start) / D) * 100}%`, background: SEC_COLORS[s.label] || '#5e5ce6' }} title={`${s.label} (추정)`}>
                {s.label}{s.certain ? '' : '?'}
              </button>
            ))}
          </div>
          {/* 코드 */}
          <div className="relative h-10 mt-1.5 rounded-md overflow-hidden bg-panel2/60">
            {a.chords.filter((c) => c.root >= 0).map((c, i) => (
              <button key={i} onClick={() => seek(c.start)} className="absolute top-0 h-full text-[10px] font-medium border-r border-bg/70 truncate px-0.5 hover:bg-accent/30"
                style={{ left: `${(c.start / D) * 100}%`, width: `${((c.end - c.start) / D) * 100}%`, opacity: c.source === 'user' ? 1 : 0.45 + 0.55 * c.confidence }} title={`${fmtTime(c.start)} ${lab(c)}`}>
                {lab(c)}
              </button>
            ))}
          </div>
          {/* Key 구간 */}
          {a.keySegments.length > 1 && (
            <div className="relative h-6 mt-1.5 rounded-md overflow-hidden bg-panel2/40">
              {a.keySegments.map((s, i) => (
                <div key={i} className="absolute top-0 h-full text-[10px] px-1 border-r border-bg truncate leading-6" style={{ left: `${(s.start / D) * 100}%`, width: `${((s.end - s.start) / D) * 100}%` }}>{keyName(transposePc(s.tonic, tr), s.mode)}</div>
              ))}
            </div>
          )}
          <div className="absolute top-0 bottom-0 w-0.5 bg-fg pointer-events-none" style={{ left: `${(pos / D) * 100}%` }} />
        </div>
        <div className="flex justify-between text-[11px] text-mute mt-1 tabular"><span>0:00</span><span>{fmtTime(D)}</span></div>
        <p className="text-xs text-mute mt-3">구간 이름(Intro/Verse/Chorus…)은 반복 패턴과 에너지를 이용한 자동 추정이며 "?" 로 표시됩니다. 코드 블록의 진하기는 분석 신뢰도입니다.{a.keySegments.length > 1 ? ' 세 번째 줄은 구간별 Key 추정입니다.' : ''}</p>
      </div>
      {!a.tempoStable && a.tempoSegments.length > 0 && (
        <div className="card p-5">
          <div className="label mb-2">구간별 BPM</div>
          <div className="flex flex-wrap gap-1.5">{a.tempoSegments.map((s, i) => <span key={i} className="chip">{fmtTime(s.start)} · {s.bpm}</span>)}</div>
        </div>
      )}
      <div className="card p-5">
        <div className="label mb-2">마디별 코드 진행</div>
        <pre className="text-sm font-mono whitespace-pre-wrap leading-7">{chordProgressionText(a, tr, 'bars')}</pre>
      </div>
    </div>
  )
}

function Item({ k, v, s }: { k: string; v: string; s?: string }) {
  return (
    <div className="min-w-0">
      <dt className="label">{k}</dt>
      <dd className="text-xl font-semibold mt-0.5 truncate" title={v}>{v}</dd>
      <dd className="text-[11px] text-mute">{s}</dd>
    </div>
  )
}
