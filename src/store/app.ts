import { useSyncExternalStore } from 'react'
import type { FocusMode } from '../engine/focus'
import type { Analysis, Beat, ChordSegment, LoopRegion, Marker, Settings, TrackMeta } from '../types'
import { engine, computePeaks, downmix } from '../engine/AudioEngine'
import { buildClickEvents, gridBeats } from '../engine/clickEvents'
import { db, getAnalysis, loadSettings, saveAnalysis, saveLoop, saveMarker, saveSettings, saveTrack } from './db'
import { fileFromHandle, hasFSAccess, isTauri, pickFolderFSAccess, pickWithFSAccess, pickWithInput, tauriPick, tauriRead, trackIdFor, type PickedFile } from '../platform/files'
import AnalysisWorker from '../analysis/worker.ts?worker'
import { chordLabel, parseChord, transposePc, useFlats } from '../lib/music'

export type Tab = 'player' | 'copy' | 'report' | 'youtube' | 'library' | 'settings'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  accent: 'orange',
  lang: 'ko',
  clickSound: 'electronic',
  clickVolume: 0.8,
  clickSubdivision: 'quarter',
  accentDownbeat: true,
  countIn: 0,
  defaultRate: 1,
  defaultPitch: 0,
  waveformColor: '#8e8e93',
  autoAnalyze: true,
  analysisQuality: 'accurate',
  outputDeviceId: '',
  volume: 0.9,
  clickOffsetMs: 0,
  focusAmount: 0.8,
  keepCopies: !hasFSAccess() && !isTauri(),
}

export interface State {
  ready: boolean
  settings: Settings
  tab: Tab
  tracks: TrackMeta[]
  playlist: string[] // 재생 순서 (track id)
  currentId: string | null
  loading: boolean
  error: string | null
  toast: string | null
  duration: number
  peaks: Float32Array | null
  peaksPerSec: number
  analysis: Analysis | null
  analyzing: { p: number; stage: string } | null
  needsFile: TrackMeta | null // 재실행 후 파일 재선택이 필요한 곡
  // 재생 상태
  rate: number
  pitch: number
  clickOn: boolean
  musicMute: boolean
  focus: FocusMode
  loop: { enabled: boolean; a: number; b: number; repeat: number }
  loops: LoopRegion[]
  markers: Marker[]
  chordZoom: number
}

const files = new Map<string, File>() // 세션 중 메모리에만 보관 (원본 수정 없음)
const handles = new Map<string, FileSystemFileHandle>()
let monoCache: { id: string; mono: Float32Array; sr: number } | null = null

let state: State = {
  ready: false,
  settings: DEFAULT_SETTINGS,
  tab: 'player',
  tracks: [],
  playlist: [],
  currentId: null,
  loading: false,
  error: null,
  toast: null,
  duration: 0,
  peaks: null,
  peaksPerSec: 200,
  analysis: null,
  analyzing: null,
  needsFile: null,
  rate: 1,
  pitch: 0,
  clickOn: false,
  musicMute: false,
  focus: 'off',
  loop: { enabled: false, a: 0, b: 0, repeat: 0 },
  loops: [],
  markers: [],
  chordZoom: 1,
}
const listeners = new Set<() => void>()
export function getState() { return state }
export function setState(p: Partial<State> | ((s: State) => Partial<State>)) {
  const patch = typeof p === 'function' ? p(state) : p
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export function useApp<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => sel(state))
}

let toastTimer: any
export function toast(msg: string) {
  setState({ toast: msg })
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => setState({ toast: null }), 3200)
}

// ───────── 초기화 / 복원 ─────────
let inited = false
export async function init() {
  if (inited) return
  inited = true
  try {
    const saved = await loadSettings()
    const settings = { ...DEFAULT_SETTINGS, ...(saved || {}) }
    const tracks = (await db.all<TrackMeta>('tracks')).sort((a, b) => a.addedAt - b.addedAt)
    const session = await db.get<any>('kv', 'session')
    const hs = (await db.keys('handles')) as string[]
    for (const k of hs) { const h = await db.get<FileSystemFileHandle>('handles', k); if (h) handles.set(k, h) }
    setState({ settings, tracks, playlist: session?.playlist?.filter((id: string) => tracks.some((t) => t.id === id)) ?? tracks.map((t) => t.id), tab: session?.tab ?? 'player', ready: true })
    applyTheme(settings)
    if (session?.currentId && tracks.some((t) => t.id === session.currentId)) {
      await selectTrack(session.currentId, { autoplay: false, restore: true })
    }
  } catch (e: any) {
    setState({ ready: true, error: '로컬 저장소를 열 수 없습니다. 기본 플레이어 기능만 사용할 수 있습니다. (' + (e?.message || e) + ')' })
  }
}

export function applyTheme(s: Settings) {
  const root = document.documentElement
  root.classList.toggle('dark', s.theme === 'dark')
  root.dataset.theme = s.theme
  root.dataset.accent = s.accent
  root.lang = s.lang
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', s.theme === 'dark' ? '#0b0b0d' : '#f5f5f7')
}

let sessionTimer: any
export function persistSession() {
  clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    const s = getState()
    db.put('kv', { currentId: s.currentId, playlist: s.playlist, tab: s.tab }, 'session').catch(() => {})
    const t = s.tracks.find((x) => x.id === s.currentId)
    // 실제로 로드되어 재생 가능한 곡일 때만 위치 저장 (파일 재선택 대기 중에는 기존 위치 보존)
    if (t && s.duration > 0 && !s.loading && !s.needsFile) {
      t.lastPosition = engine.position
      saveTrack(t).catch(() => {})
    }
  }, 400)
}

export function updateSettings(p: Partial<Settings>) {
  const settings = { ...getState().settings, ...p }
  setState({ settings })
  saveSettings(settings).catch(() => {})
  applyTheme(settings)
  if (p.clickSound) engine.setClickSound(p.clickSound)
  if (p.clickVolume !== undefined) engine.setParams({ clickGain: p.clickVolume })
  if (p.volume !== undefined) engine.setParams({ volume: p.volume })
  if (p.clickOffsetMs !== undefined) engine.setParams({ clickOffset: p.clickOffsetMs / 1000 })
  if (p.outputDeviceId !== undefined) engine.setOutputDevice(p.outputDeviceId)
  if (p.clickSubdivision || p.accentDownbeat !== undefined) pushClicks()
}

// ───────── 파일 추가 ─────────
export async function openFiles(kind: 'files' | 'folder') {
  let picked: PickedFile[] = []
  if (isTauri()) picked = await tauriPick(kind === 'folder')
  else if (hasFSAccess()) picked = kind === 'folder' ? await pickFolderFSAccess() : await pickWithFSAccess()
  else picked = await pickWithInput({ multiple: true, directory: kind === 'folder' })
  if (picked.length) await addFiles(picked, true)
}

export async function addFiles(picked: PickedFile[], playFirst: boolean) {
  const st = getState()
  const tracks = [...st.tracks]
  const playlist = [...st.playlist]
  let firstId: string | null = null
  for (const p of picked) {
    const id = trackIdFor(p.file)
    files.set(id, p.file)
    if (p.handle) { handles.set(id, p.handle); db.put('handles', p.handle, id).catch(() => {}) }
    let t = tracks.find((x) => x.id === id)
    if (t && p.path && t.path !== p.path) { t.path = p.path; saveTrack(t).catch(() => {}) }
    if (!t) {
      t = { id, name: p.file.name, size: p.file.size, lastModified: p.file.lastModified, folder: p.folder, path: p.path, addedAt: Date.now() }
      tracks.push(t)
      saveTrack(t).catch(() => {})
    }
    // 경로(데스크톱)나 파일 핸들(Chrome/Edge)로 다시 열 수 없는 파일(끌어다 놓기 등)은 항상 사본을 보관 → 재실행 후에도 재생 가능
    if (!p.path && (st.settings.keepCopies || !p.handle)) db.put('blobs', p.file, id).catch(() => toast('저장 공간이 부족하여 음원 사본을 보관하지 못했습니다.'))
    if (!playlist.includes(id)) playlist.push(id)
    if (!firstId) firstId = id
  }
  setState({ tracks, playlist, needsFile: null })
  persistSession()
  if (playFirst && firstId) await selectTrack(firstId, { autoplay: false, restore: true })
}

async function obtainFile(t: TrackMeta): Promise<File | null> {
  const f = files.get(t.id)
  if (f) return f
  if (t.path && isTauri()) { const x = await tauriRead(t.path); if (x) { files.set(t.id, x); return x } }
  const h = handles.get(t.id)
  if (h) { const x = await fileFromHandle(h); if (x) { files.set(t.id, x); return x } }
  const blob = await db.get<File>('blobs', t.id).catch(() => null)
  if (blob) { const x = blob instanceof File ? blob : new File([blob], t.name); files.set(t.id, x); return x }
  return null
}

/** 재선택한 파일이 원래 곡과 동일한지 확인 후 연결 */
export async function relinkFile(t: TrackMeta) {
  const picked = isTauri() ? (await tauriPick(false)).slice(0, 1) : await pickWithInput({ multiple: false })
  if (!picked.length) return
  const f = picked[0].file
  // 같은 파일인지: ID 일치, 또는 이름·크기가 같으면 같은 곡으로 봄(데스크톱 수정 시각 차이 허용)
  const same = trackIdFor(f) === t.id || (f.name === t.name && f.size === t.size)
  const id = t.id
  if (!same) {
    // 다른 파일 → 새 곡으로 추가
    await addFiles(picked, true)
    return
  }
  files.set(id, f)
  if (picked[0].path) { t.path = picked[0].path; saveTrack(t).catch(() => {}) }
  else if (!picked[0].handle) db.put('blobs', f, id).catch(() => {})
  setState({ needsFile: null })
  await selectTrack(id, { autoplay: false, restore: true })
}

// ───────── 곡 선택 / 로드 ─────────
let loadToken = 0
export async function selectTrack(id: string, opts: { autoplay?: boolean; restore?: boolean } = {}) {
  const st = getState()
  const t = st.tracks.find((x) => x.id === id)
  if (!t) return
  const token = ++loadToken
  if (st.currentId) persistSession()
  engine.pause()
  setState({ currentId: id, loading: true, error: null, analysis: null, peaks: null, duration: 0, loop: { enabled: false, a: 0, b: 0, repeat: 0 }, needsFile: null })
  const file = await obtainFile(t)
  if (token !== loadToken) return
  if (!file) {
    setState({ loading: false, needsFile: t })
    return
  }
  try {
    await engine.init()
    const buf = await file.arrayBuffer()
    const { buffer } = await engine.decode(buf)
    if (token !== loadToken) return
    engine.load(buffer)
    const mono = downmix(buffer)
    monoCache = { id, mono, sr: buffer.sampleRate }
    const pps = 200
    const peaks = computePeaks(mono, Math.max(1, Math.round(buffer.duration * pps)))
    t.duration = buffer.duration
    t.sampleRate = buffer.sampleRate
    t.channels = buffer.numberOfChannels
    t.lastPlayedAt = Date.now()
    saveTrack(t).catch(() => {})
    const [analysis, loops, markers] = await Promise.all([
      getAnalysis(id).catch(() => null),
      db.byTrack<LoopRegion>('loops', id).catch(() => []),
      db.byTrack<Marker>('markers', id).catch(() => []),
    ])
    if (token !== loadToken) return
    const s = getState().settings
    setState({ loading: false, duration: buffer.duration, peaks, peaksPerSec: peaks.length / 2 / buffer.duration, analysis: analysis || null, loops, markers, tracks: [...getState().tracks] })
    setRate(s.defaultRate)
    setPitch(s.defaultPitch)
    engine.setParams({ volume: s.volume, clickGain: s.clickVolume, clickOffset: s.clickOffsetMs / 1000, clickOn: getState().clickOn, musicMute: getState().musicMute, focusMode: getState().focus, focusAmount: s.focusAmount })
    pushClicks()
    if (opts.restore && t.lastPosition && t.lastPosition < buffer.duration - 1) engine.seek(t.lastPosition)
    if (!analysis && s.autoAnalyze) runAnalysis()
    if (opts.autoplay) play()
    persistSession()
  } catch (e: any) {
    if (token !== loadToken) return
    setState({ loading: false, error: decodeErrorMessage(t.name, e) })
  }
}

function decodeErrorMessage(name: string, e: any) {
  const ext = name.split('.').pop()?.toUpperCase()
  return `"${name}" 파일을 재생할 수 없습니다. 이 기기의 브라우저/시스템이 ${ext} 형식을 지원하지 않거나 파일이 손상되었을 수 있습니다. (${e?.message || e})`
}

export function removeTrack(id: string) {
  const st = getState()
  setState({ tracks: st.tracks.filter((t) => t.id !== id), playlist: st.playlist.filter((x) => x !== id), ...(st.currentId === id ? { currentId: null, analysis: null, peaks: null, duration: 0 } : {}) })
  if (st.currentId === id) { engine.pause(); engine.node?.port.postMessage({ type: 'unload' }) }
  db.del('tracks', id).catch(() => {})
  db.del('blobs', id).catch(() => {})
  db.del('handles', id).catch(() => {})
  files.delete(id)
  persistSession()
}

export function updateTrack(id: string, p: Partial<TrackMeta>) {
  const tracks = getState().tracks.map((t) => (t.id === id ? { ...t, ...p } : t))
  setState({ tracks })
  const t = tracks.find((x) => x.id === id)
  if (t) saveTrack(t).catch(() => {})
}

export function movePlaylist(id: string, dir: -1 | 1) {
  const pl = [...getState().playlist]
  const i = pl.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= pl.length) return
  ;[pl[i], pl[j]] = [pl[j], pl[i]]
  setState({ playlist: pl })
  persistSession()
}

// ───────── 재생 제어 ─────────
export function play() {
  const st = getState()
  if (!st.currentId || !st.duration) return
  const s = st.settings
  const a = st.analysis
  if (s.countIn > 0 && a && a.beats.length > 1) {
    // 현재 위치 직전 비트에서 시작하도록 맞추고 그 앞에 카운트인
    const pos = engine.position
    let i = a.beats.findIndex((b) => b.t >= pos - 0.02)
    if (i < 0) i = a.beats.length - 1
    // 마디 첫 박으로 정렬
    while (i > 0 && a.beats[i].beat !== 1 && a.beats[i].t > pos - 0.02) i--
    const bt = a.beats[i]
    const period = 60 / (a.bpm.value || 120)
    engine.play({ beats: s.countIn * a.meter.value, period, meter: a.meter.value, startAt: bt.t })
  } else engine.play()
}
export function pause() { engine.pause(); persistSession() }
export function togglePlay() { engine.playing ? pause() : play() }
export function seek(t: number) {
  engine.seek(Math.max(0, Math.min(getState().duration, t)))
  persistSession()
}
export function nextTrack(dir: 1 | -1) {
  const st = getState()
  if (!st.playlist.length) return
  if (dir === -1 && engine.position > 3) { seek(0); return }
  const i = st.playlist.indexOf(st.currentId || '')
  const j = i + dir
  if (j < 0 || j >= st.playlist.length) return
  selectTrack(st.playlist[j], { autoplay: engine.playing || dir === 1 })
}
engine.onEnded = () => {
  const st = getState()
  const i = st.playlist.indexOf(st.currentId || '')
  if (i >= 0 && i + 1 < st.playlist.length) selectTrack(st.playlist[i + 1], { autoplay: true })
}
engine.onLoopDone = () => {
  setState((s) => ({ loop: { ...s.loop, enabled: false } }))
  toast('반복 횟수를 모두 재생했습니다.')
}

export function setRate(r: number) {
  const rate = Math.max(0.25, Math.min(2, Math.round(r * 100) / 100))
  setState({ rate })
  engine.setParams({ rate })
}
export function setPitch(p: number) {
  const pitch = Math.max(-12, Math.min(12, Math.round(p * 10) / 10))
  setState({ pitch })
  engine.setParams({ pitch })
}
export function setClickOn(on: boolean) { setState({ clickOn: on }); engine.setParams({ clickOn: on }) }
export function setMusicMute(m: boolean) { setState({ musicMute: m }); engine.setParams({ musicMute: m }) }
export function setFocus(mode: FocusMode) { setState({ focus: mode }); engine.setParams({ focusMode: mode, focusAmount: getState().settings.focusAmount }) }
export function setFocusAmount(a: number) { updateSettings({ focusAmount: a }); engine.setParams({ focusAmount: a }) }

export function setLoop(p: Partial<State['loop']>) {
  const loop = { ...getState().loop, ...p }
  if (loop.b < loop.a) [loop.a, loop.b] = [loop.b, loop.a]
  setState({ loop })
  engine.setLoop(loop.enabled, loop.a, loop.b, loop.repeat)
}
export function setLoopPoint(which: 'a' | 'b') {
  const t = engine.position
  const l = getState().loop
  if (which === 'a') setLoop({ a: t, b: l.b > t ? l.b : Math.min(getState().duration, t + 4), enabled: l.enabled })
  else setLoop({ b: t, a: l.a < t ? l.a : Math.max(0, t - 4), enabled: true })
}
/** 반복 구간을 가장 가까운 비트로 맞춤 */
export function snapLoopToBeats() {
  const a = getState().analysis
  const l = getState().loop
  if (!a || !a.beats.length) return
  const near = (t: number) => a.beats.reduce((best, b) => (Math.abs(b.t - t) < Math.abs(best - t) ? b.t : best), a.beats[0].t)
  setLoop({ a: near(l.a), b: near(l.b) })
}
export function saveCurrentLoop(name: string, note?: string) {
  const st = getState()
  if (!st.currentId) return
  const l: LoopRegion = { id: crypto.randomUUID?.() || String(Date.now()), trackId: st.currentId, a: st.loop.a, b: st.loop.b, name, note, repeat: st.loop.repeat }
  setState({ loops: [...st.loops, l] })
  saveLoop(l).catch(() => {})
}
export function updateLoopRegion(id: string, p: Partial<LoopRegion>) {
  const loops = getState().loops.map((l) => (l.id === id ? { ...l, ...p } : l))
  setState({ loops })
  const l = loops.find((x) => x.id === id)
  if (l) saveLoop(l).catch(() => {})
}
export function deleteLoopRegion(id: string) {
  setState({ loops: getState().loops.filter((l) => l.id !== id) })
  db.del('loops', id).catch(() => {})
}
export function addMarker(name?: string) {
  const st = getState()
  if (!st.currentId) return
  const m: Marker = { id: crypto.randomUUID?.() || String(Date.now()), trackId: st.currentId, t: engine.position, name: name || `M${st.markers.length + 1}` }
  setState({ markers: [...st.markers, m].sort((x, y) => x.t - y.t) })
  saveMarker(m).catch(() => {})
}
export function deleteMarker(id: string) {
  setState({ markers: getState().markers.filter((m) => m.id !== id) })
  db.del('markers', id).catch(() => {})
}

// ───────── 분석 ─────────
let worker: Worker | null = null
let jobId = 0
export function runAnalysis() {
  const st = getState()
  if (!st.currentId || !monoCache || monoCache.id !== st.currentId) return
  if (st.analyzing) return
  const id = ++jobId
  const trackId = st.currentId
  setState({ analyzing: { p: 0, stage: 'start' } })
  try {
    if (!worker) worker = new AnalysisWorker()
  } catch (e: any) {
    setState({ analyzing: null, error: '분석 작업을 시작할 수 없습니다: ' + (e?.message || e) })
    return
  }
  const mono = new Float32Array(monoCache.mono) // 복사본 전송 (재생용 데이터 유지)
  worker.onmessage = (e) => {
    const m = e.data
    if (m.id !== id) return
    if (m.type === 'progress') setState({ analyzing: { p: m.p, stage: m.stage } })
    else if (m.type === 'done') {
      const a: Analysis = m.result
      setState({ analyzing: null })
      if (getState().currentId === trackId) { setState({ analysis: a }); pushClicks() }
      saveAnalysis(a).catch(() => {})
      toast('분석 완료')
    } else if (m.type === 'error') {
      setState({ analyzing: null, error: '분석에 실패했습니다. BPM·박자·Key 를 직접 입력해 사용할 수 있습니다. (' + m.message + ')' })
    }
  }
  worker.onerror = (e) => {
    setState({ analyzing: null, error: '분석 중 오류: ' + e.message })
    worker?.terminate()
    worker = null
  }
  worker.postMessage({ id, mono, sr: monoCache.sr, opts: { quality: st.settings.analysisQuality, trackId } }, [mono.buffer])
}
export function cancelAnalysis() {
  worker?.terminate()
  worker = null
  setState({ analyzing: null })
}

/** 비트 → 클릭 이벤트 → 워크렛 */
export function pushClicks() {
  const st = getState()
  const a = st.analysis
  if (!a) { engine.setClicks(new Float64Array(0), new Uint8Array(0)); return }
  const ev = buildClickEvents(a.beats, st.settings.clickSubdivision, st.settings.accentDownbeat)
  engine.setClicks(ev.times, ev.kinds)
}

function commitAnalysis(a: Analysis) {
  a.userEdited = true
  setState({ analysis: { ...a } })
  saveAnalysis(a).catch(() => {})
  pushClicks()
}

/** 수동 분석값(분석 실패 시 또는 분석 없이) — 사용자가 입력한 BPM/첫 박으로 비트 그리드 생성 */
export function createManualAnalysis(bpm: number, firstBeat: number, meter: number) {
  const st = getState()
  if (!st.currentId) return
  const beats = gridBeats(bpm, firstBeat, meter, st.duration)
  const a: Analysis = {
    trackId: st.currentId, version: 1, analyzedAt: Date.now(), duration: st.duration,
    bpm: { value: bpm, confidence: 1, source: 'user' }, tempoStable: true, tempoSegments: [],
    meter: { value: meter, confidence: 1, source: 'user' }, meterDenominator: meter === 6 ? 8 : 4, beats,
    key: { value: { tonic: 0, mode: 'major' }, confidence: 0, source: 'user' }, keySegments: [], chords: [], sections: [], transpose: 0, userEdited: true,
  }
  commitAnalysis(a)
}

/** BPM 수동 수정: 분석된 비트 위치를 유지한 채 배수(×2, ÷2) 또는 균일 그리드 재생성 */
export function editBpm(mode: 'double' | 'half' | 'set', value?: number) {
  const a = getState().analysis
  if (!a) return
  let beats: Beat[] = a.beats
  if (mode === 'double') {
    const nb: Beat[] = []
    for (let i = 0; i < beats.length; i++) {
      nb.push({ ...beats[i] })
      if (i + 1 < beats.length) nb.push({ ...beats[i], t: (beats[i].t + beats[i + 1].t) / 2 })
    }
    beats = nb
    a.bpm = { value: Math.round(a.bpm.value * 200) / 100, confidence: 1, source: 'user' }
  } else if (mode === 'half') {
    beats = beats.filter((_, i) => i % 2 === 0)
    a.bpm = { value: Math.round(a.bpm.value * 50) / 100, confidence: 1, source: 'user' }
  } else if (value && value > 10) {
    const first = beats[0]?.t ?? 0
    beats = gridBeats(value, first, a.meter.value, a.duration)
    a.bpm = { value, confidence: 1, source: 'user' }
    a.tempoStable = true
  }
  a.beats = renumber(beats, a.meter.value, 0)
  commitAnalysis(a)
}

function renumber(beats: Beat[], meter: number, phase: number): Beat[] {
  return beats.map((b, i) => { const k = i - phase; return { ...b, bar: Math.floor(k / meter) + 1, beat: (((k % meter) + meter) % meter) + 1 } })
}

export function editMeter(meter: number) {
  const a = getState().analysis
  if (!a) return
  // 현재 첫 다운비트 유지
  const first = Math.max(0, a.beats.findIndex((b) => b.beat === 1))
  a.meter = { value: meter, confidence: 1, source: 'user' }
  a.meterDenominator = meter === 6 || meter === 9 || meter === 12 ? 8 : 4
  a.beats = renumber(a.beats, meter, first % meter)
  commitAnalysis(a)
}
/** 지정 비트를 마디 첫 박(다운비트)으로 설정 */
export function setDownbeatAt(t: number) {
  const a = getState().analysis
  if (!a || !a.beats.length) return
  let idx = 0
  a.beats.forEach((b, i) => { if (Math.abs(b.t - t) < Math.abs(a.beats[idx].t - t)) idx = i })
  a.beats = renumber(a.beats, a.meter.value, idx % a.meter.value)
  a.meter = { ...a.meter, source: 'user', confidence: 1 }
  commitAnalysis(a)
}
/** 비트 전체를 미세 이동 (싱크 보정) */
export function nudgeBeats(ms: number) {
  const a = getState().analysis
  if (!a) return
  a.beats = a.beats.map((b) => ({ ...b, t: b.t + ms / 1000 }))
  commitAnalysis(a)
}

export function editKey(tonic: number, mode: 'major' | 'minor', transposeChords: boolean) {
  const a = getState().analysis
  if (!a) return
  if (transposeChords) {
    const cur = a.key.value.tonic + a.transpose
    const diff = (((tonic - cur) % 12) + 18) % 12 - 6
    a.transpose += diff
    a.key = { ...a.key, value: { tonic: a.key.value.tonic, mode } }
  } else {
    a.key = { value: { tonic: (((tonic - a.transpose) % 12) + 12) % 12, mode }, confidence: 1, source: 'user' }
  }
  commitAnalysis(a)
}
export function resetTranspose() {
  const a = getState().analysis
  if (!a) return
  a.transpose = 0
  commitAnalysis(a)
}

export function editChord(index: number, text: string): boolean {
  const a = getState().analysis
  if (!a) return false
  const c = parseChord(text)
  if (!c) return false
  const seg = a.chords[index]
  // 입력은 화면(이조 적용) 기준 → 원래 키로 역변환해서 저장
  const tr = displayTranspose()
  seg.root = transposePc(c.root, -tr)
  seg.bass = transposePc(c.bass, -tr)
  seg.quality = c.quality
  seg.label = chordLabel(seg.root, seg.quality, seg.bass, useFlats(a.key.value.tonic, a.key.value.mode))
  seg.source = 'user'
  seg.confidence = 1
  // 인접 동일 코드 병합
  const merged: ChordSegment[] = []
  for (const s of a.chords) {
    const l = merged[merged.length - 1]
    if (l && l.root === s.root && l.quality === s.quality && l.bass === s.bass) { l.end = s.end; if (s.source === 'user') l.source = 'user'; continue }
    merged.push(s)
  }
  a.chords = merged
  commitAnalysis(a)
  return true
}
/** 코드 구간 분할 (현재 위치에서) */
export function splitChordAt(t: number) {
  const a = getState().analysis
  if (!a) return
  const i = a.chords.findIndex((c) => t > c.start + 0.05 && t < c.end - 0.05)
  if (i < 0) return
  const c = a.chords[i]
  // 가장 가까운 비트에 맞춤
  let st = t
  if (a.beats.length) st = a.beats.reduce((best, b) => (Math.abs(b.t - t) < Math.abs(best - t) ? b.t : best), a.beats[0].t)
  if (st <= c.start || st >= c.end) st = t
  a.chords.splice(i + 1, 0, { ...c, start: st, source: 'user' })
  c.end = st
  commitAnalysis(a)
}

/** 화면 표시 이조량 = 사용자 Key 이조 + 피치 조절(정수 반음) */
export function displayTranspose(s: State = getState()) {
  return (s.analysis?.transpose || 0) + Math.round(s.pitch)
}

export async function clearAllData() {
  for (const s of ['tracks', 'analyses', 'loops', 'markers', 'kv', 'handles', 'blobs'] as const) await db.clear(s)
}
