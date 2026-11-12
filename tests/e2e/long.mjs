// 긴 파일(약 20분) 로드·분석·끝부분 재생 테스트
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { readFileSync } from 'node:fs'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext()
await ctx.route('**/__audio/**', (r) => r.fulfill({ body: readFileSync('test-audio/' + r.request().url().split('/__audio/')[1]) }))
const page = await ctx.newPage()
await page.goto('http://localhost:4173/?gstest')
await page.waitForFunction(() => window.__gs && window.__gs.getState().ready)
const t0 = Date.now()
await page.evaluate(async () => { const b = await (await fetch('/__audio/long_20min.mp3')).blob(); await window.__gs.addFiles([{ file: new File([b], 'long_20min.mp3', { lastModified: 9 }) }], true) })
await page.waitForFunction(() => window.__gs.getState().duration > 0, null, { timeout: 120000 })
const tLoad = Date.now() - t0
// 분석 중 UI 응답성: 메인 스레드 지연 측정
const lag = await page.evaluate(async () => { let max = 0, last = performance.now(); const id = setInterval(() => { const n = performance.now(); max = Math.max(max, n - last - 50); last = n }, 50); await new Promise((r) => setTimeout(r, 3000)); clearInterval(id); return max })
await page.waitForFunction(() => window.__gs.getState().analysis && !window.__gs.getState().analyzing, null, { timeout: 300000 })
const tAll = Date.now() - t0
const r = await page.evaluate(async () => { const g = window.__gs; const s = g.getState(); g.seek(s.duration - 20); g.setClickOn(true); g.play(); await new Promise((r) => setTimeout(r, 2000)); const p = g.engine.position; g.pause(); return { dur: s.duration, bpm: s.analysis.bpm.value, key: s.analysis.key.value, beats: s.analysis.beats.length, p, mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null } })
console.log(JSON.stringify({ loadMs: tLoad, totalMs: tAll, analyzeMs: tAll - tLoad, mainThreadMaxLagMs: Math.round(lag), ...r }))
await browser.close()
