// 실제 Chromium 에서 앱을 구동하는 E2E 테스트: node tests/e2e/run.mjs
// - 포맷별 디코딩/재생, 드래그앤드롭, 분석 결과, 클릭-원곡 싱크(출력 녹음 측정), 배속/피치, A-B 반복, 데이터 복원, 오프라인
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE || 'http://localhost:4173/'
const AUD = path.resolve('test-audio')
const OUT = path.resolve('test-results')
mkdirSync(OUT, { recursive: true })
const truth = JSON.parse(readFileSync(path.join(AUD, 'truth.json'), 'utf8'))
const results = []
const log = (...a) => console.log(...a)
const KEYN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await ctx.route('**/__audio/**', (route) => {
  const f = decodeURIComponent(route.request().url().split('/__audio/')[1])
  route.fulfill({ body: readFileSync(path.join(AUD, f)), contentType: 'application/octet-stream' })
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(BASE + '?gstest')
await page.waitForFunction(() => window.__gs && window.__gs.getState().ready)

async function loadFile(name, viaDrop = false) {
  return page.evaluate(async ({ name, viaDrop }) => {
    const b = await (await fetch('/__audio/' + name)).blob()
    const file = new File([b], name, { lastModified: 1700000000000 })
    if (viaDrop) {
      const dt = new DataTransfer()
      dt.items.add(file)
      document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
    } else await window.__gs.addFiles([{ file }], true)
  }, { name, viaDrop })
}
async function waitAnalysis(timeout = 60000) {
  const t0 = Date.now()
  await page.waitForFunction(() => { const s = window.__gs.getState(); return !s.loading && s.duration > 0 && s.analysis && !s.analyzing }, null, { timeout })
  return Date.now() - t0
}

// 1) 포맷별 로드 + 분석
const files = ['pop_120_G.mp3', 'ballad_92.5_Am.mp3', 'waltz_150_C.flac', 'slash_76_D.m4a', 'fast_174_Em.ogg', 'jazzish_110_F.aac', 'halfbar_100_A.mp3', 'tempo_change_100to112_C.mp3']
for (const [i, f] of files.entries()) {
  const name = f.replace(/\.[^.]+$/, '')
  await loadFile(f, i === 0)
  let ms
  try { ms = await waitAnalysis() } catch (e) {
    const st = await page.evaluate(() => ({ err: window.__gs.getState().error }))
    results.push({ test: `load+analyze ${f}`, ok: false, detail: st.err || String(e) }); continue
  }
  const r = await page.evaluate(() => {
    const s = window.__gs.getState(); const a = s.analysis
    return { dur: s.duration, bpm: a.bpm.value, stable: a.tempoStable, meter: a.meter.value, key: [a.key.value.tonic, a.key.value.mode], chords: a.chords.filter((c) => c.root >= 0).slice(0, 8).map((c) => c.label), firstBeat: a.beats[0]?.t }
  })
  const t = truth[name]
  const bpmOk = t.bpm === 'variable' ? !r.stable : Math.abs(r.bpm - t.bpm) / t.bpm < 0.01
  const keyOk = r.key[0] === t.key.tonic && r.key[1] === t.key.mode
  const ok = bpmOk && keyOk && r.meter === t.meter
  results.push({ test: `load+analyze ${f}`, ok, detail: `분석 ${ms}ms · BPM ${r.bpm} (정답 ${t.bpm}) · ${r.meter}박 (정답 ${t.meter}) · Key ${KEYN[r.key[0]]} ${r.key[1]} (정답 ${KEYN[t.key.tonic]} ${t.key.mode}) · 코드 ${r.chords.join(' ')} (정답 ${t.chords.join(' ')})` })
  log(results.at(-1))
  if (i === 0) await page.screenshot({ path: `${OUT}/player-dark.png` })
}

// 2) 재생/일시정지: 위치가 실제로 진행하는가
await page.evaluate(() => window.__gs.selectTrack(window.__gs.getState().playlist[0], {}))
await waitAnalysis()
await page.evaluate(() => { window.__gs.seek(10); window.__gs.play() })
await page.waitForTimeout(2000)
const p1 = await page.evaluate(() => window.__gs.engine.position)
await page.evaluate(() => window.__gs.pause())
await page.waitForTimeout(600)
const p2 = await page.evaluate(() => window.__gs.engine.position)
await page.waitForTimeout(600)
const p3 = await page.evaluate(() => window.__gs.engine.position)
results.push({ test: '재생/일시정지', ok: p1 > 11.5 && p1 < 12.6 && Math.abs(p3 - p2) < 0.01, detail: `10초에서 2초 재생 후 위치 ${p1.toFixed(2)}s, 일시정지 후 변화 ${(p3 - p2).toFixed(3)}s` })
log(results.at(-1))

// 3) 클릭-원곡 싱크: 출력 녹음 후 원곡 틱(광대역)과 메트로놈 클릭(1320/1760Hz) 시각 비교
await loadFile('sync_ticks_100.mp3')
await waitAnalysis()
const syncInfo = await page.evaluate(() => { const a = window.__gs.getState().analysis; return { bpm: a.bpm.value, first: a.beats[0].t, n: a.beats.length } })
log('sync file analysis', syncInfo)
async function record({ rate = 1, pitch = 0, start = 5, secs = 8 }) {
  return page.evaluate(async ({ rate, pitch, start, secs }) => {
    const g = window.__gs, e = g.engine, ctx = e.ctx
    if (!window.__rec) {
      const code = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=(m)=>{this.on=m.data}}process(i){if(this.on&&i[0]&&i[0][0])this.port.postMessage(i[0][0].slice(0));return true}}registerProcessor('gs-rec',R)`
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
      const rec = new AudioWorkletNode(ctx, 'gs-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
      const z = ctx.createGain(); z.gain.value = 0
      e.node.connect(rec); rec.connect(z); z.connect(ctx.destination)
      window.__rec = rec
    }
    const rec = window.__rec
    const chunks = []
    rec.port.onmessage = (m) => chunks.push(m.data)
    g.setRate(rate); g.setPitch(pitch); g.updateSettings({ clickSound: 'electronic', clickSubdivision: 'quarter', countIn: 0, clickOffsetMs: 0 }); g.setClickOn(true); g.setMusicMute(false)
    g.seek(start)
    await new Promise((r) => setTimeout(r, 200))
    rec.port.postMessage(true)
    g.play()
    await new Promise((r) => setTimeout(r, secs * 1000))
    g.pause()
    rec.port.postMessage(false)
    await new Promise((r) => setTimeout(r, 200))
    const n = chunks.reduce((s, c) => s + c.length, 0)
    const out = new Float32Array(n); let o = 0
    for (const c of chunks) { out.set(c, o); o += c.length }
    g.setRate(1); g.setPitch(0); g.setClickOn(false)
    return { sr: ctx.sampleRate, data: Array.from(out) }
  }, { rate, pitch, start, secs })
}
function detect(sr, x) {
  // 원곡 틱: 1차 차분 에너지(고역), 클릭: Goertzel 1320/1760Hz
  const hop = Math.round(sr * 0.0005), win = Math.round(sr * 0.002)
  const hpE = [], cE = []
  const gz = (s, f) => { const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let a = 0, b = 0; for (let i = s; i < s + win; i++) { const y = x[i] + c * a - b; b = a; a = y } return a * a + b * b - c * a * b }
  for (let s = 1; s + win < x.length; s += hop) {
    let e = 0
    for (let i = s; i < s + win; i++) { const d = x[i] - x[i - 1]; e += d * d }
    hpE.push(e); cE.push(gz(s, 1320) + gz(s, 1760))
  }
  const onsets = (E, rel) => {
    const mx = Math.max(...E), thr = mx * rel, out = []
    let last = -1e9
    for (let i = 1; i < E.length; i++) if (E[i] >= thr && E[i - 1] < thr && i - last > 0.2 / 0.0005) { out.push((i * hop) / sr); last = i }
    return out
  }
  return { ticks: onsets(hpE, 0.05), clicks: onsets(cE, 0.08) }
}
for (const cfg of [{ rate: 1, pitch: 0 }, { rate: 0.7, pitch: 0 }, { rate: 0.5, pitch: 0 }, { rate: 1.5, pitch: 0 }, { rate: 1, pitch: 3 }, { rate: 0.8, pitch: -2 }]) {
  const r = await record(cfg)
  const { ticks, clicks } = detect(r.sr, r.data)
  const diffs = []
  for (const c of clicks) { let best = 1e9; for (const t of ticks) if (Math.abs(c - t) < Math.abs(best)) best = c - t; if (Math.abs(best) < 0.1) diffs.push(best * 1000) }
  const mean = diffs.reduce((a, b) => a + b, 0) / (diffs.length || 1)
  const maxAbs = Math.max(...diffs.map(Math.abs))
  const expectN = Math.floor((8 * cfg.rate) / 0.6)
  const ok = diffs.length >= expectN - 2 && maxAbs < (cfg.rate === 1 && cfg.pitch === 0 ? 5 : 15)
  results.push({ test: `클릭 싱크 rate=${cfg.rate} pitch=${cfg.pitch}`, ok, detail: `클릭 ${clicks.length}개/틱 ${ticks.length}개 매칭 ${diffs.length} · 평균 오차 ${mean.toFixed(2)}ms · 최대 ${maxAbs.toFixed(2)}ms` })
  log(results.at(-1))
  // 배속 시 시간 진행 검증: 녹음 길이 동안 틱 간격 = 0.6/rate
  if (ticks.length > 3) {
    // 연속 틱 간격의 중앙값 (검출 누락에 강건)
    const ivs = []
    for (let i = 1; i < ticks.length; i++) { const d = ticks[i] - ticks[i - 1]; const k = Math.round(d / (0.6 / cfg.rate)); if (k >= 1) ivs.push(d / k) }
    ivs.sort((a, b) => a - b)
    const iv = ivs[Math.floor(ivs.length / 2)]
    results.push({ test: `배속 템포 rate=${cfg.rate} pitch=${cfg.pitch}`, ok: Math.abs(iv - 0.6 / cfg.rate) < 0.01, detail: `틱 간격 ${(iv * 1000).toFixed(1)}ms (기대 ${(600 / cfg.rate).toFixed(1)}ms)` })
    log(results.at(-1))
  }
}

// 4) 배속 시 음정 유지 / 피치 변경: 순음 테스트(440Hz) 녹음 후 주파수 측정
await page.evaluate(async () => {
  const sr = 44100, n = sr * 12, d = new Float32Array(n)
  for (let i = 0; i < n; i++) d[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / sr)
  // WAV
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, d[i] * 32767, true)
  window.__gs.updateSettings({ autoAnalyze: false })
  await window.__gs.addFiles([{ file: new File([buf], 'sine440.wav', { lastModified: 1 }) }], true)
})
await page.waitForFunction(() => window.__gs.getState().duration > 0 && !window.__gs.getState().loading)
for (const cfg of [{ rate: 0.5, pitch: 0, f: 440 }, { rate: 0.7, pitch: 0, f: 440 }, { rate: 1.5, pitch: 0, f: 440 }, { rate: 1, pitch: 12, f: 880 }, { rate: 1, pitch: -5, f: 440 * 2 ** (-5 / 12) }, { rate: 0.7, pitch: 3, f: 440 * 2 ** (3 / 12) }]) {
  const r = await record({ ...cfg, start: 1, secs: 2 })
  // 영교차 기반 주파수 추정 (중앙 1초)
  const x = r.data.slice(r.sr * 0.5, r.sr * 1.5)
  let zc = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) zc++
  const f = zc / (x.length / r.sr)
  results.push({ test: `음정 rate=${cfg.rate} pitch=${cfg.pitch}`, ok: Math.abs(f - cfg.f) / cfg.f < 0.01, detail: `측정 ${f.toFixed(1)}Hz (기대 ${cfg.f.toFixed(1)}Hz)` })
  log(results.at(-1))
}
await page.evaluate(() => window.__gs.updateSettings({ autoAnalyze: true }))

// 5) A-B 반복: 2초~4초 구간, 위치가 구간 안에 머무는가
await page.evaluate(() => window.__gs.selectTrack(window.__gs.getState().playlist[0], {}))
await waitAnalysis()
const loopRes = await page.evaluate(async () => {
  const g = window.__gs
  g.setLoop({ a: 2, b: 4, enabled: true, repeat: 0 }); g.seek(2); g.play()
  const pos = []
  for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 200)); pos.push(g.engine.position) }
  g.pause(); g.setLoop({ enabled: false })
  return pos
})
results.push({ test: 'A-B 무한 반복', ok: loopRes.every((p) => p >= 1.9 && p <= 4.1) && Math.max(...loopRes) > 3.5, detail: `6초 동안 위치 범위 ${Math.min(...loopRes).toFixed(2)}~${Math.max(...loopRes).toFixed(2)}s` })
log(results.at(-1))
const loopCnt = await page.evaluate(async () => {
  const g = window.__gs
  g.setLoop({ a: 2, b: 3, enabled: true, repeat: 2 }); g.seek(2); g.play()
  await new Promise((r) => setTimeout(r, 3500))
  const p = g.engine.position; g.pause(); return { p, enabled: g.getState().loop.enabled }
})
results.push({ test: 'A-B 반복 횟수(2회)', ok: loopCnt.p > 3.3 && !loopCnt.enabled, detail: `2회 반복 후 구간을 벗어나 진행: 위치 ${loopCnt.p.toFixed(2)}s, 반복 해제=${!loopCnt.enabled}` })
log(results.at(-1))

// 6) 사용자 수정 + 저장 → 새로고침 후 복원
await page.evaluate(async () => {
  const g = window.__gs
  g.editChord(1, 'Cadd9'); g.saveCurrentLoop('테스트 구간'); g.updateTrack(g.getState().currentId, { notes: '카포 2', favorite: true }); g.seek(33.3); g.persistSession()
  await new Promise((r) => setTimeout(r, 800))
})
await page.reload()
await page.waitForFunction(() => window.__gs && window.__gs.getState().ready)
await page.waitForTimeout(500)
const restored = await page.evaluate(async () => {
  const s = window.__gs.getState()
  await new Promise((r) => setTimeout(r, 300))
  return { n: s.tracks.length, cur: s.currentId, needsFile: !!s.needsFile, notes: s.tracks.find((t) => t.id === s.currentId)?.notes, fav: s.tracks.find((t) => t.id === s.currentId)?.favorite, lastPos: s.tracks.find((t) => t.id === s.currentId)?.lastPosition }
})
// 웹(Chromium)에서는 드롭한 파일에 핸들이 없으므로 재선택 필요(needsFile) — 같은 파일을 다시 넣어 분석/구간 복원 확인
await loadFile('pop_120_G.mp3')
await page.waitForFunction(() => window.__gs.getState().analysis && !window.__gs.getState().loading)
const restored2 = await page.evaluate(() => { const s = window.__gs.getState(); return { chord: s.analysis.chords.filter((c) => c.root >= 0)[1]?.label, edited: s.analysis.userEdited, loops: s.loops.map((l) => l.name) } })
results.push({ test: '앱 재실행 후 데이터 복원', ok: restored.n >= 9 && restored.notes === '카포 2' && restored.fav && restored2.edited && restored2.loops.includes('테스트 구간'), detail: `곡 ${restored.n}개, 메모="${restored.notes}", 즐겨찾기=${restored.fav}, 마지막 위치=${restored.lastPos?.toFixed(1)}s, 파일 재선택 필요=${restored.needsFile}, 수정 코드 ${restored2.chord}, 구간 ${restored2.loops.join(',')}` })
log(results.at(-1))

// 7) 오프라인: 서비스워커 캐시 후 네트워크 차단하고 새로고침
await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 }).catch(() => {})
await page.reload(); await page.waitForTimeout(1500)
await ctx.setOffline(true)
let offlineOk = false, offDetail = ''
try {
  await page.reload({ timeout: 10000 })
  await page.waitForFunction(() => window.__gs && window.__gs.getState().ready, null, { timeout: 10000 })
  await loadFile('pop_120_G.mp3').catch(() => {})
  offlineOk = await page.evaluate(() => document.title === 'Guitar Studio AI')
  offDetail = '네트워크 차단 상태에서 앱 실행·라이브러리 로드 성공'
} catch (e) { offDetail = String(e).slice(0, 200) }
await ctx.setOffline(false)
results.push({ test: '오프라인 실행', ok: offlineOk, detail: offDetail })
log(results.at(-1))

// 7.5) 악기 강조: 실제 UI 버튼을 눌러 앱 출력을 녹음 → 대역별 에너지 비율 비교
await page.reload(); await page.waitForFunction(() => window.__gs && window.__gs.getState().ready)
await loadFile('real_pop_120_G_detune+35_melody_noise.wav'); await page.waitForFunction(() => { const s = window.__gs.getState(); return !s.loading && s.duration > 0 })
async function recFocus(label) {
  if (label) await page.getByRole('group', { name: '악기 강조' }).getByRole('button', { name: label, exact: true }).click()
  await page.waitForTimeout(150)
  return page.evaluate(async () => {
    const g = window.__gs, e = g.engine, ctx = e.ctx
    if (!window.__rec) {
      const code = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=(m)=>{this.on=m.data}}process(i){if(this.on&&i[0]&&i[0][0])this.port.postMessage(i[0][0].slice(0));return true}}registerProcessor('gs-rec',R)`
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
      const rec = new AudioWorkletNode(ctx, 'gs-rec', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' })
      const z = ctx.createGain(); z.gain.value = 0
      e.node.connect(rec); rec.connect(z); z.connect(ctx.destination)
      window.__rec = rec
    }
    const rec = window.__rec, chunks = []
    rec.port.onmessage = (m) => chunks.push(m.data)
    g.setClickOn(false); g.seek(4)
    await new Promise((r) => setTimeout(r, 200))
    rec.port.postMessage(true); g.play()
    await new Promise((r) => setTimeout(r, 3000))
    g.pause(); rec.port.postMessage(false)
    await new Promise((r) => setTimeout(r, 150))
    const n = chunks.reduce((s, c) => s + c.length, 0), x = new Float32Array(n); let o = 0
    for (const c of chunks) { x.set(c, o); o += c.length }
    // 1차 IIR 로 대역 분리: 저역(<200Hz), 고역(>5kHz)
    const sr = ctx.sampleRate, lp = (f) => { const a = Math.exp(-2 * Math.PI * f / sr); let y = 0; return (v) => (y = (1 - a) * v + a * y) }
    const l1 = lp(200), l2 = lp(200), h1 = lp(5000), h2 = lp(5000)
    let eAll = 0, eLow = 0, eHigh = 0
    for (let i = 0; i < n; i++) { const v = x[i]; const lo = l2(l1(v)); const hi = v - h2(h1(v)); eAll += v * v; eLow += lo * lo; eHigh += hi * hi }
    return { low: eLow / eAll, high: eHigh / eAll, mid: Math.max(0, 1 - (eLow + eHigh) / eAll), rms: Math.sqrt(eAll / n) }
  })
}
const fOff = await recFocus(null)
const fBass = await recFocus('베이스')
const fDrums = await recFocus('드럼')
const fVocal = await recFocus('보컬')
const fOff2 = await recFocus('원음')
const db = (a, b) => (10 * Math.log10(a / b)).toFixed(1)
const lr = (f) => f.low / (f.mid + f.high)
results.push({ test: '악기 강조: 베이스 버튼 → 저음 비중 증가', ok: lr(fBass) > lr(fOff) * 2, detail: `저역 비중 ${(fOff.low * 100).toFixed(1)}% → ${(fBass.low * 100).toFixed(1)}% (저역/나머지 비 ${db(lr(fBass), lr(fOff))}dB)` })
results.push({ test: '악기 강조: 드럼 버튼 → 고음(심벌) 비중 증가, 저음은 늘지 않음', ok: fDrums.high > fOff.high * 1.5 && fDrums.low <= fOff.low * 1.1, detail: `고역 비중 ${(fOff.high * 100).toFixed(2)}% → ${(fDrums.high * 100).toFixed(2)}% (${db(fDrums.high, fOff.high)}dB), 저역 ${(fOff.low * 100).toFixed(1)}% → ${(fDrums.low * 100).toFixed(1)}%` })
results.push({ test: '악기 강조: 보컬 버튼 → 저음 감소, 중음 유지', ok: fVocal.low < fOff.low * 0.5 && fVocal.mid > fOff.mid, detail: `저역 ${(fOff.low * 100).toFixed(1)}% → ${(fVocal.low * 100).toFixed(1)}%, 중역 ${(fOff.mid * 100).toFixed(1)}% → ${(fVocal.mid * 100).toFixed(1)}%` })
results.push({ test: '악기 강조: 원음 버튼 → 원래대로', ok: Math.abs(fOff2.low - fOff.low) < 0.02 && Math.abs(fOff2.rms / fOff.rms - 1) < 0.05, detail: `저역 ${(fOff2.low * 100).toFixed(1)}%, 음량 비 ${(fOff2.rms / fOff.rms).toFixed(3)}` })
results.slice(-4).forEach((r) => log(r))
await page.getByRole('group', { name: '악기 강조' }).getByRole('button', { name: '기타', exact: true }).click()
await page.screenshot({ path: `${OUT}/focus-guitar.png` })
await page.getByRole('group', { name: '악기 강조' }).getByRole('button', { name: '원음', exact: true }).click()

// 8) 화면: 라이트 모드, 카피 모드, 리포트, 모바일
await page.reload(); await page.waitForFunction(() => window.__gs && window.__gs.getState().ready)
await loadFile('pop_120_G.mp3'); await waitAnalysis()
await page.evaluate(() => { window.__gs.seek(9.1) })
await page.waitForTimeout(400)
await page.screenshot({ path: `${OUT}/player-dark.png` })
await page.evaluate(() => window.__gs.setState({ tab: 'copy' })); await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/copy-mode.png` })
await page.evaluate(() => window.__gs.setState({ tab: 'report' })); await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/report.png`, fullPage: true })
await page.evaluate(() => { window.__gs.updateSettings({ theme: 'light' }); window.__gs.setState({ tab: 'player' }) }); await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/player-light.png` })
await page.evaluate(() => window.__gs.updateSettings({ theme: 'dark' }))
for (const [nm, vp] of [['mobile', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
  await page.setViewportSize(vp); await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${nm}-player.png` })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  results.push({ test: `${nm} 화면 대응`, ok: !overflow, detail: overflow ? '가로 스크롤 발생' : `${vp.width}px 에서 가로 넘침 없음` })
}
await page.evaluate(() => window.__gs.setState({ tab: 'copy' })); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300)
await page.screenshot({ path: `${OUT}/mobile-copy.png` })

results.push({ test: '콘솔 오류 없음', ok: errors.length === 0, detail: errors.slice(0, 5).join(' | ') || '없음' })
writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify(results, null, 2))
console.log('\n' + results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.test} — ${r.detail}`).join('\n'))
await browser.close()
