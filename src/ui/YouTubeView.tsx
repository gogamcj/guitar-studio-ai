import { useEffect, useRef, useState } from 'react'
import { YtClicker } from '../engine/ytClick'
import { fmtTime } from '../lib/music'
import { loadYouTubeApi, parseStart, parseYouTubeId, tapBpm } from '../lib/youtube'
import { useApp } from '../store/app'
import { db } from '../store/db'
import { IMetronome, IPause, IPlay, IRepeat, ITrash } from './icons'

export interface YtItem {
  vid: string
  title: string
  bpm: number | null // 사용자가 입력/탭한 값 (AI 분석 아님)
  offset: number // 첫 박 위치(초)
  meter: number
  a: number
  b: number
  note: string
  lastPos: number
  savedAt: number
}

const KEY = 'youtube'
export const loadYtList = async () => ((await db.get<YtItem[]>('kv', KEY).catch(() => null)) || [])
const saveYtList = (l: YtItem[]) => db.put('kv', l, KEY).catch(() => {})

const clicker = new YtClicker()
if (typeof location !== 'undefined' && location.search.includes('gstest')) (window as any).__ytClicker = clicker

export function YouTubeView() {
  const settings = useApp((s) => s.settings)
  const [url, setUrl] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [list, setList] = useState<YtItem[]>([])
  const [item, setItem] = useState<YtItem | null>(null)
  const [ready, setReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [dur, setDur] = useState(0)
  const [rate, setRate] = useState(1)
  const [rates, setRates] = useState<number[]>([0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2])
  const [loopOn, setLoopOn] = useState(false)
  const [clickOn, setClickOn] = useState(false)
  const [latencyMs, setLatencyMs] = useState(0)
  const [taps, setTaps] = useState<number[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const host = useRef<HTMLDivElement>(null)
  const player = useRef<any>(null)
  const itemRef = useRef<YtItem | null>(null)
  itemRef.current = item
  const loopRef = useRef(loopOn)
  loopRef.current = loopOn

  useEffect(() => { loadYtList().then(setList) }, [])
  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on); window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])
  useEffect(() => { clicker.setSound(settings.clickSound); clicker.gain = settings.clickVolume }, [settings.clickSound, settings.clickVolume])
  useEffect(() => { clicker.latency = latencyMs / 1000 }, [latencyMs])
  useEffect(() => { if (clickOn) clicker.start(); else clicker.stop() }, [clickOn])

  // 위치 확인·A-B 반복·클릭 예약 (클릭 자체는 AudioContext 시각에 예약됨)
  useEffect(() => {
    let raf = 0, lastSave = 0
    const loop = () => {
      const p = player.current
      const it = itemRef.current
      if (p?.getCurrentTime && it) {
        const cur = p.getCurrentTime() || 0
        const st = p.getPlayerState?.()
        const isPlaying = st === 1
        if (loopRef.current && it.b > it.a && cur >= it.b) p.seekTo(it.a, true)
        clicker.tick(cur, p.getPlaybackRate?.() || 1, isPlaying, it.bpm ? { bpm: it.bpm, offset: it.offset, meter: it.meter } : null)
        setT(cur)
        if (isPlaying && performance.now() - lastSave > 5000) { lastSave = performance.now(); update({ lastPos: cur }) }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => () => { clicker.stop(); try { player.current?.destroy() } catch { /* */ } }, [])

  function update(p: Partial<YtItem>) {
    const it = itemRef.current
    if (!it) return
    const next = { ...it, ...p }
    itemRef.current = next
    setItem(next)
    setList((l) => { const nl = l.some((x) => x.vid === next.vid) ? l.map((x) => (x.vid === next.vid ? next : x)) : [next, ...l]; saveYtList(nl); return nl })
  }

  async function open(vid: string, start = 0, existing?: YtItem) {
    setErr(null)
    const base: YtItem = existing || list.find((x) => x.vid === vid) || { vid, title: '', bpm: null, offset: 0, meter: 4, a: 0, b: 0, note: '', lastPos: 0, savedAt: Date.now() }
    const it = { ...base, savedAt: Date.now() }
    setItem(it); itemRef.current = it
    setReady(false); setLoopOn(false); setTaps([])
    try {
      const YT = await loadYouTubeApi()
      try { player.current?.destroy() } catch { /* */ }
      const el = document.createElement('div')
      host.current!.innerHTML = ''
      host.current!.appendChild(el)
      player.current = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId: vid,
        width: '100%', height: '100%',
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(start || it.lastPos || 0), origin: location.origin },
        events: {
          onReady: (e: any) => {
            setReady(true)
            setDur(e.target.getDuration() || 0)
            const r = e.target.getAvailablePlaybackRates?.()
            if (r?.length) setRates(r)
            const title = e.target.getVideoData?.().title || it.title || vid
            update({ title })
          },
          onStateChange: (e: any) => { setPlaying(e.data === 1); if (e.data === 1) setDur(e.target.getDuration() || 0) },
          onPlaybackRateChange: (e: any) => setRate(e.data),
          onError: (e: any) => setErr(e.data === 101 || e.data === 150 ? '이 영상은 소유자가 다른 사이트에서의 재생을 허용하지 않아 재생할 수 없습니다.' : e.data === 100 ? '영상을 찾을 수 없습니다(삭제 또는 비공개).' : `영상을 재생할 수 없습니다 (오류 ${e.data}).`),
        },
      })
    } catch (e: any) { setErr(e.message || String(e)) }
  }

  function submit() {
    const vid = parseYouTubeId(url)
    if (!vid) { setErr('YouTube 링크를 인식할 수 없습니다. 예: https://www.youtube.com/watch?v=... 또는 https://youtu.be/...'); return }
    open(vid, parseStart(url))
    setUrl('')
  }

  const p = player.current
  const cur = t
  const tap = () => {
    const now = performance.now() / 1000
    const nt = [...taps.filter((x) => now - x < 3), now]
    setTaps(nt)
    const bpm = tapBpm(nt)
    if (bpm) update({ bpm, offset: cur })
  }
  const remove = (vid: string) => setList((l) => { const nl = l.filter((x) => x.vid !== vid); saveYtList(nl); return nl })

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <input className="input flex-1 min-w-[14rem]" placeholder="YouTube 링크 붙여넣기 (youtube.com/watch?v=… , youtu.be/…)" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} aria-label="YouTube 링크" />
          <button className="btn btn-accent" onClick={submit} disabled={!url.trim() || !online}>불러오기</button>
        </div>
        <p className="text-xs text-mute mt-2">
          YouTube 공식 플레이어로 재생합니다. 이 탭에서 영상을 불러올 때만 YouTube 에 접속하며, 내 음악 파일은 전송되지 않습니다.
          YouTube 소리는 앱이 받을 수 없어 <b>AI 분석·피치 변경·악기 강조는 사용할 수 없습니다</b>.
        </p>
        {!online && <p className="text-xs text-warn mt-1">인터넷에 연결되어 있지 않아 YouTube 를 재생할 수 없습니다.</p>}
        {err && <p className="text-sm text-warn mt-2" role="alert">{err}</p>}
      </div>

      <div className={item ? 'grid lg:grid-cols-[1fr_20rem] gap-4' : 'hidden'}>
        <div className="space-y-3">
          <div className="card overflow-hidden"><div className="aspect-video bg-black" ref={host} /></div>
          {item && (
            <div className="card p-3 space-y-3">
              <div className="font-semibold truncate">{item.title || '불러오는 중…'}</div>
              <div className="flex items-center gap-3">
                <span className="text-xs tabular text-mute w-12 text-right">{fmtTime(cur)}</span>
                <input type="range" className="flex-1 h-1.5" min={0} max={dur || 1} step={0.1} value={Math.min(cur, dur || 1)} disabled={!ready} onChange={(e) => p?.seekTo(+e.target.value, true)} aria-label="YouTube 재생 위치" />
                <span className="text-xs tabular text-mute w-12">{fmtTime(dur)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-accent h-11 w-11 rounded-full px-0" disabled={!ready} onClick={() => (playing ? p.pauseVideo() : p.playVideo())} title="재생/일시정지">{playing ? <IPause size={20} /> : <IPlay size={20} />}</button>
                <button className="chip" disabled={!ready} onClick={() => p.seekTo(Math.max(0, cur - 5), true)}>−5초</button>
                <button className="chip" disabled={!ready} onClick={() => p.seekTo(cur + 5, true)}>+5초</button>
                <label className="flex items-center gap-1.5 ml-2">
                  <span className="label">배속</span>
                  <select className="input h-8 text-xs" value={rate} disabled={!ready} onChange={(e) => p.setPlaybackRate(+e.target.value)} aria-label="YouTube 배속">
                    {rates.map((r) => <option key={r} value={r}>{r}×</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-1.5 ml-2">
                  <button className="chip" disabled={!ready} onClick={() => update({ a: cur, b: Math.max(item.b, cur) })} title="현재 위치를 A 로">A {item.b > item.a || item.a ? fmtTime(item.a) : ''}</button>
                  <button className="chip" disabled={!ready} onClick={() => update({ b: cur, a: Math.min(item.a, cur) })} title="현재 위치를 B 로">B {item.b ? fmtTime(item.b) : ''}</button>
                  <button className={`btn btn-icon h-9 ${loopOn ? 'btn-accent' : ''}`} disabled={!ready || !(item.b > item.a)} onClick={() => { setLoopOn(!loopOn); if (!loopOn && (cur < item.a || cur > item.b)) p.seekTo(item.a, true) }} title="A-B 반복"><IRepeat /></button>
                </div>
              </div>
            </div>
          )}
        </div>

        {item && (
          <div className="space-y-3">
            <div className="card p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm">클릭(메트로놈)</span>
                <button className={`btn btn-icon h-9 ${clickOn ? 'btn-accent' : ''}`} disabled={!item.bpm} onClick={() => setClickOn(!clickOn)} title={item.bpm ? '클릭 ON/OFF' : 'BPM 을 먼저 입력하세요'}><IMetronome /></button>
              </div>
              <p className="text-xs text-mute">YouTube 영상은 분석할 수 없어 BPM 을 직접 입력하거나 박자에 맞춰 <b>탭</b>하세요. 클릭 정확도는 내 파일 재생보다 낮습니다.</p>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5"><span className="label">BPM</span>
                  <input className="input h-8 w-20 tabular" type="number" min={30} max={300} step={0.1} value={item.bpm ?? ''} placeholder="—" onChange={(e) => update({ bpm: e.target.value ? Math.max(30, Math.min(300, +e.target.value)) : null })} aria-label="BPM 직접 입력" />
                </label>
                <button className="btn h-8" onClick={tap} disabled={!ready} title="박자에 맞춰 3번 이상 누르세요">탭</button>
                <label className="flex items-center gap-1.5"><span className="label">박자</span>
                  <select className="input h-8 text-xs" value={item.meter} onChange={(e) => update({ meter: +e.target.value })} aria-label="박자">
                    {[2, 3, 4, 5, 6].map((m) => <option key={m} value={m}>{m}/4</option>)}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button className="chip" disabled={!ready || !item.bpm} onClick={() => update({ offset: cur })} title="재생 중 마디 첫 박에서 누르세요">지금이 1박</button>
                <button className="chip" disabled={!item.bpm} onClick={() => update({ offset: item.offset - 0.02 })}>−20ms</button>
                <button className="chip" disabled={!item.bpm} onClick={() => update({ offset: item.offset + 0.02 })}>+20ms</button>
              </div>
              <label className="flex items-center gap-2 text-xs"><span className="label">출력 지연 보정</span>
                <input type="range" min={-150} max={150} step={5} value={latencyMs} onChange={(e) => setLatencyMs(+e.target.value)} className="flex-1" aria-label="클릭 지연 보정" />
                <span className="tabular w-12 text-right">{latencyMs}ms</span>
              </label>
            </div>
            <div className="card p-3">
              <label className="label">연습 메모</label>
              <textarea className="input w-full h-20 mt-1 text-sm" value={item.note} onChange={(e) => update({ note: e.target.value })} placeholder="예: 2절 솔로 0.75배" />
            </div>
          </div>
        )}
      </div>

      <div className="card p-3">
        <div className="font-semibold text-sm mb-2">저장된 YouTube 영상 <span className="text-mute font-normal">({list.length})</span></div>
        {list.length === 0 && <p className="text-xs text-mute">불러온 영상은 여기에 자동 저장됩니다(BPM, 구간, 메모, 마지막 위치).</p>}
        {list.map((x) => (
          <div key={x.vid} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${item?.vid === x.vid ? 'bg-accent/10' : 'hover:bg-panel2'}`}>
            <button className="flex-1 min-w-0 text-left" onClick={() => open(x.vid, 0, x)} disabled={!online}>
              <div className="text-sm truncate">{x.title || x.vid}</div>
              <div className="text-xs text-mute">{x.bpm ? `${x.bpm} BPM (직접 입력)` : 'BPM —'}{x.lastPos ? ` · 이어듣기 ${fmtTime(x.lastPos)}` : ''}{x.note ? ' · 메모' : ''}</div>
            </button>
            <button className="btn btn-ghost btn-icon h-8 w-8" onClick={() => remove(x.vid)} title="목록에서 삭제"><ITrash size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  )
}
