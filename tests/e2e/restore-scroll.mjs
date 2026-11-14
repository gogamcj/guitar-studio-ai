// 1) 끌어다 놓은 여러 곡이 재실행 후에도 모두 재생되는지  2) 재생 중 코드 표 자동 스크롤이 페이지(파형)를 움직이지 않는지
import { createRequire } from 'module'
import { readFileSync, writeFileSync } from 'fs'
const { chromium } = createRequire(import.meta.url)('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const results = []
const push = (test, ok, detail) => { results.push({ test, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${test} — ${detail}`) }
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } })
await ctx.route('**/__audio/**', (r) => r.fulfill({ body: readFileSync('test-audio/' + r.request().url().split('/__audio/')[1]) }))
const p = await ctx.newPage()
await p.goto(BASE + '?gstest'); await p.waitForFunction(() => window.__gs?.getState().ready)
const names = ['pop_120_G.mp3', 'ballad_92.5_Am.mp3', 'waltz_150_C.flac', 'fast_174_Em.ogg']
await p.evaluate(async (names) => {
  window.__gs.updateSettings({ keepCopies: false, autoAnalyze: true }) // PC 브라우저 기본값
  const dt = new DataTransfer()
  for (const n of names) { const bl = await (await fetch('/__audio/' + n)).blob(); dt.items.add(new File([bl], n, { lastModified: 1700000000000 })) }
  document.querySelector('#root > div').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }))
}, names)
await p.waitForFunction(() => { const s = window.__gs.getState(); return s.tracks.length >= 4 && s.duration > 0 && s.analysis && !s.analyzing }, null, { timeout: 60000 })
await p.waitForTimeout(1500)
await p.reload(); await p.waitForFunction(() => window.__gs?.getState().ready)
await p.waitForTimeout(800)
const ok = []
for (let i = 0; i < names.length; i++) {
  // 라이브러리 목록의 곡을 실제로 클릭
  await p.locator('aside').getByText(names[i].replace(/\.[^.]+$/, ''), { exact: true }).click()
  await p.waitForFunction(() => { const s = window.__gs.getState(); return !s.loading }, null, { timeout: 20000 })
  await p.waitForTimeout(300)
  const r = await p.evaluate(async () => { const s = window.__gs.getState(); if (s.needsFile || !s.duration) return { ok: false, needs: !!s.needsFile }; window.__gs.play(); await new Promise((r) => setTimeout(r, 700)); const pos = window.__gs.engine.position; window.__gs.pause(); return { ok: pos > 0.3, pos } })
  ok.push(`${i + 1}번 ${r.ok ? '재생됨' : (r.needs ? '파일 다시 선택 필요' : '실패')}`)
  if (!r.ok) { push('재실행 후 끌어다 놓은 곡 모두 재생', false, ok.join(', ')); break }
}
if (ok.length === names.length && ok.every((x) => x.includes('재생됨'))) push('재실행 후 끌어다 놓은 곡 모두 재생', true, ok.join(', '))

// 2) 코드 표 자동 스크롤
await p.locator('aside').getByText('pop_120_G', { exact: true }).click()
await p.waitForFunction(() => { const s = window.__gs.getState(); return !s.loading && s.analysis }, null, { timeout: 20000 })
const main = p.locator('main')
await main.evaluate((m) => { m.scrollTop = 0 })
const wave0 = await p.locator('canvas').first().boundingBox()
await p.evaluate(() => { window.__gs.seek(30); window.__gs.play() })
await p.waitForTimeout(5000)
const res = await p.evaluate(() => {
  const m = document.querySelector('main'); const box = [...document.querySelectorAll('div.overflow-y-auto')].find((d) => d.querySelector('[data-i]'))
  return { mainTop: m.scrollTop, tableTop: box ? box.scrollTop : -1 }
})
const wave1 = await p.locator('canvas').first().boundingBox()
await p.evaluate(() => window.__gs.pause())
push('재생 중 코드 표가 자동 스크롤돼도 파형 위치 고정', res.mainTop === 0 && Math.abs(wave1.y - wave0.y) < 1 && res.tableTop > 0, `페이지 스크롤 ${res.mainTop}px, 파형 y ${wave0.y.toFixed(0)}→${wave1.y.toFixed(0)}, 코드 표 내부 스크롤 ${res.tableTop}px`)
writeFileSync('test-results/restore-scroll.json', JSON.stringify(results, null, 2))
await b.close()
