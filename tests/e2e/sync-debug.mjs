import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { readFileSync, writeFileSync } from 'node:fs'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext()
await ctx.route('**/__audio/**', (r) => r.fulfill({ body: readFileSync('test-audio/' + r.request().url().split('/__audio/')[1]) }))
const page = await ctx.newPage()
await page.goto('http://localhost:4173/?gstest')
await page.waitForFunction(() => window.__gs && window.__gs.getState().ready)
const f = process.argv[2] || 'sync_ticks_100.wav'
const rate = +(process.argv[3] || 0.7)
await page.evaluate(async (f) => { const b = await (await fetch('/__audio/' + f)).blob(); await window.__gs.addFiles([{ file: new File([b], f, { lastModified: 5 }) }], true) }, f)
await page.waitForFunction(() => window.__gs.getState().analysis && !window.__gs.getState().analyzing)
const res = await page.evaluate(async (rate) => {
  const g = window.__gs, e = g.engine, ctx = e.ctx
  const code = `class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=(m)=>{this.on=m.data}}process(i){if(this.on&&i[0]&&i[0][0])this.port.postMessage(i[0][0].slice(0));return true}}registerProcessor('gs-rec',R)`
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })))
  const rec = new AudioWorkletNode(ctx, 'gs-rec', { channelCount: 1, channelCountMode: 'explicit' })
  const z = ctx.createGain(); z.gain.value = 0; e.node.connect(rec); rec.connect(z); z.connect(ctx.destination)
  const chunks = []; rec.port.onmessage = (m) => chunks.push(m.data)
  g.setRate(rate); g.setClickOn(true); g.seek(5)
  await new Promise((r) => setTimeout(r, 300)); rec.port.postMessage(true); g.play()
  await new Promise((r) => setTimeout(r, 6000)); g.pause(); rec.port.postMessage(false)
  await new Promise((r) => setTimeout(r, 200))
  const n = chunks.reduce((s, c) => s + c.length, 0); const out = new Float32Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length }
  return { sr: ctx.sampleRate, data: Array.from(out), beats: g.getState().analysis.beats.slice(0, 20).map((b) => b.t) }
}, rate)
writeFileSync('/tmp/claude-0/rec.json', JSON.stringify(res))
console.log('sr', res.sr, 'beats', res.beats.slice(0, 5).map((t) => t.toFixed(4)).join(' '))
await browser.close()
