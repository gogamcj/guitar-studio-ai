import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { readFileSync } from 'node:fs'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext()
await ctx.route('**/__audio/**', (r) => r.fulfill({ body: readFileSync('test-audio/' + r.request().url().split('/__audio/')[1]) }))
const page = await ctx.newPage()
await page.goto('http://localhost:4173/?gstest')
await page.waitForFunction(() => window.__gs && window.__gs.getState().ready)
await page.evaluate(async () => { const b = await (await fetch('/__audio/pop_120_G.mp3')).blob(); await window.__gs.addFiles([{ file: new File([b], 'pop_120_G.mp3', { lastModified: 5 }) }], true) })
await page.waitForFunction(() => window.__gs.getState().duration > 0)
const r = await page.evaluate(async () => {
  const g = window.__gs; g.seek(33.3)
  const a = g.engine.position
  await new Promise((r) => setTimeout(r, 900))
  const b = g.engine.position
  const t = g.getState().tracks[0]
  return { a, b, lp: t.lastPosition }
})
console.log(r)
await browser.close()
