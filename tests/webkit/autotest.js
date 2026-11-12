// WebKit(데스크톱 WebView/Safari 계열) 인페이지 자동 테스트. dist/ 에 복사해 ?gstest&autotest 로 실행
const out = document.createElement('pre')
out.style.cssText = 'position:fixed;left:0;top:0;right:0;z-index:99999;background:#000;color:#0f0;font:13px monospace;padding:8px;white-space:pre-wrap;max-height:100vh;overflow:auto'
document.body.appendChild(out)
const log = (s) => { out.textContent += s + '\n' }
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 60000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(100) } }
try {
  log('UA: ' + navigator.userAgent)
  log('AudioWorklet: ' + (typeof AudioWorkletNode !== 'undefined'))
  await until(() => window.__gs && window.__gs.getState().ready)
  const g = window.__gs
  for (const f of ['pop_120_G.mp3', 'waltz_150_C.flac', 'slash_76_D.m4a', 'fast_174_Em.ogg', 'sync_ticks_100.wav']) {
    try {
      const b = await (await fetch('./ta/' + f)).blob()
      await g.addFiles([{ file: new File([b], f, { lastModified: 7 }) }], true)
      await until(() => { const s = g.getState(); return (!s.loading && s.analysis && !s.analyzing) || s.error })
      const s = g.getState()
      if (s.error) { log(`FAIL ${f}: ${s.error}`); g.setState({ error: null }); continue }
      const a = s.analysis
      log(`OK ${f}: BPM ${a.bpm.value} ${a.meter.value}박 key ${a.key.value.tonic}/${a.key.value.mode} chords ${a.chords.filter((c) => c.root >= 0).slice(0, 6).map((c) => c.label).join(' ')}`)
    } catch (e) { log(`FAIL ${f}: ${e}`) }
  }
  // WSOLA 처리 속도 (실시간 대비)
  {
    const sr = 44100, x = new Float32Array(sr * 10).map((_, i) => Math.sin(i * 0.05) * 0.3)
    const w = new g.WSOLA(sr); w.reset(0); const o = { l: 0, r: 0, s: 0 }
    const t0 = performance.now(); const n = sr * 3
    for (let i = 0; i < n; i++) w.next(x, x, 0.7, 1, o)
    const ms = performance.now() - t0
    log(`WSOLA 3초 출력 처리 ${ms.toFixed(0)}ms (실시간 대비 ${(ms / 3000 * 100).toFixed(1)}%)`)
  }
  // 재생 진행 + 클릭 싱크 (출력 녹음)
  const e = g.engine, ctx = e.ctx
  log('ctx state ' + ctx.state + ' sr ' + ctx.sampleRate)
  const code = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=(m)=>{this.on=m.data}}process(i){if(this.on&&i[0]&&i[0][0])this.port.postMessage(i[0][0].slice(0));return true}}registerProcessor('gs-rec',R)`
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
  const rec = new AudioWorkletNode(ctx, 'gs-rec', { channelCount: 1, channelCountMode: 'explicit' })
  const z = ctx.createGain(); z.gain.value = 0; e.node.connect(rec); rec.connect(z); z.connect(ctx.destination)
  for (const rate of [1, 0.7, 1.5]) {
    const chunks = []; rec.port.onmessage = (m) => chunks.push(m.data)
    g.setRate(rate); g.setClickOn(true); g.seek(5); await wait(300)
    rec.port.postMessage(true); g.play(); await wait(5000); const p = e.position; g.pause(); rec.port.postMessage(false); await wait(200)
    const n = chunks.reduce((s, c) => s + c.length, 0); const x = new Float32Array(n); let o = 0; for (const c of chunks) { x.set(c, o); o += c.length }
    const sr = ctx.sampleRate, hop = Math.round(sr * 0.0005), win = Math.round(sr * 0.002)
    const hpE = [], cE = []
    const gz = (s, f) => { const w = 2 * Math.PI * f / sr, c = 2 * Math.cos(w); let a = 0, b = 0; for (let i = s; i < s + win; i++) { const y = x[i] + c * a - b; b = a; a = y } return a * a + b * b - c * a * b }
    for (let s = 1; s + win < x.length; s += hop) { let en = 0; for (let i = s; i < s + win; i++) { const d = x[i] - x[i - 1]; en += d * d } hpE.push(en); cE.push(gz(s, 1320) + gz(s, 1760)) }
    const on = (E, rel) => { let mx = 0; for (const v of E) mx = Math.max(mx, v); const thr = mx * rel, r = []; let last = -1e9; for (let i = 1; i < E.length; i++) if (E[i] >= thr && E[i - 1] < thr && i - last > 400) { r.push(i * hop / sr); last = i } return r }
    const ticks = on(hpE, 0.05), clicks = on(cE, 0.08)
    const d = clicks.map((c) => ticks.reduce((b, t) => (Math.abs(c - t) < Math.abs(b) ? c - t : b), 1e9)).filter((v) => Math.abs(v) < 0.1).map((v) => v * 1000)
    log(`sync rate=${rate}: 위치 ${p.toFixed(2)}s 녹음 ${(n / sr).toFixed(2)}s 클릭 ${clicks.length} 틱 ${ticks.length} 매칭 ${d.length} 평균 ${(d.reduce((a, b) => a + b, 0) / (d.length || 1)).toFixed(2)}ms 최대 ${Math.max(...d.map(Math.abs)).toFixed(2)}ms`)
  }
  g.setRate(1)
  log('DONE')
} catch (err) { log('ERROR ' + err + '\n' + err.stack) }
