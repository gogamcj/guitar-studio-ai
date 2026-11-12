// YouTube 탭 E2E. 이 테스트 환경에서는 youtube.com 에 접속할 수 없어서, IFrame API 를 같은 인터페이스의
// 가짜 플레이어로 대체한다. 가짜 플레이어의 재생 시각은 클릭용 AudioContext 시계를 따르고,
// getCurrentTime() 은 실제 YouTube 처럼 지터(±15ms)와 갱신 간격을 흉내 낸다.
import { createRequire } from 'module'
import { writeFileSync } from 'fs'
const { chromium } = createRequire(import.meta.url)('playwright')
const BASE = process.env.BASE || 'http://localhost:4173/'
const FAKE = `
window.YT = { Player: class {
  constructor(el, o) {
    this.o = o; this.v0 = o.playerVars?.start || 0; this.c0 = null; this.rate = 1; this.state = 5; this.lastRep = 0; this.lastRepAt = -1
    el.textContent = 'FAKE PLAYER ' + o.videoId; window.__fakePlayer = this
    setTimeout(() => o.events.onReady({ target: this }), 50)
  }
  clock() { const c = window.__ytClicker && window.__ytClicker.ctx; return c ? c.currentTime : performance.now() / 1000 }
  trueTime() { return this.state === 1 ? this.v0 + (this.clock() - this.c0) * this.rate : this.v0 }
  getCurrentTime() {
    const now = this.clock()
    if (this.state === 1 && now - this.lastRepAt < 0.05) return this.lastRep
    this.lastRepAt = now
    this.lastRep = this.trueTime() + (this.state === 1 ? (Math.random() - 0.5) * 0.03 : 0)
    return this.lastRep
  }
  getDuration() { return 240 } getVideoData() { return { title: '테스트 영상 ' + this.o.videoId } }
  getAvailablePlaybackRates() { return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] }
  getPlaybackRate() { return this.rate } getPlayerState() { return this.state }
  playVideo() { this.c0 = this.clock(); this.state = 1; this.o.events.onStateChange({ data: 1, target: this }) }
  pauseVideo() { this.v0 = this.trueTime(); this.state = 2; this.o.events.onStateChange({ data: 2, target: this }) }
  seekTo(t) { const p = this.state === 1; this.v0 = t; this.c0 = this.clock(); window.__seeks = (window.__seeks || 0) + 1 }
  setPlaybackRate(r) { if (this.state === 1) { this.v0 = this.trueTime(); this.c0 = this.clock() } this.rate = r; this.o.events.onPlaybackRateChange({ data: r }) }
  destroy() {}
} }
setTimeout(() => window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady(), 10)
`
const results = []
const push = (test, ok, detail) => { results.push({ test, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${test} — ${detail}`) }
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
const ytRequests = []
await ctx.route('https://www.youtube.com/iframe_api', (r) => { ytRequests.push(r.request().url()); r.fulfill({ contentType: 'text/javascript', body: FAKE }) })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(BASE + '?gstest'); await page.waitForFunction(() => window.__gs?.getState().ready)
push('다른 탭에서는 YouTube 에 접속하지 않음', ytRequests.length === 0, `요청 ${ytRequests.length}건`)

await page.getByRole('button', { name: 'YouTube' }).first().click()
push('YouTube 탭에서 하단 파일 재생바 숨김', await page.getByRole('group', { name: '악기 강조' }).count() === 0, '숨김')
await page.getByLabel('YouTube 링크').fill('https://example.com/abc')
await page.getByRole('button', { name: '불러오기' }).click()
push('잘못된 링크 안내', await page.getByRole('alert').isVisible(), (await page.getByRole('alert').textContent()).slice(0, 40))
await page.getByLabel('YouTube 링크').fill('https://youtu.be/dQw4w9WgXcQ?t=30')
await page.getByRole('button', { name: '불러오기' }).click()
await page.getByText('테스트 영상 dQw4w9WgXcQ').first().waitFor()
push('링크로 영상 불러오기 (시작 시각 t=30 반영)', await page.evaluate(() => window.__fakePlayer.v0) === 30, `영상 ID dQw4w9WgXcQ, 시작 ${await page.evaluate(() => window.__fakePlayer.v0)}s, API 요청 ${ytRequests.length}건`)

// 재생 / 배속 / A-B
await page.getByTitle('재생/일시정지').click(); await page.waitForTimeout(600)
const t1 = await page.evaluate(() => window.__fakePlayer.trueTime())
push('재생', t1 > 30.3, `위치 ${t1.toFixed(2)}s`)
await page.getByLabel('YouTube 배속').selectOption('0.75')
push('배속 변경 (0.75×)', await page.evaluate(() => window.__fakePlayer.rate) === 0.75, '0.75')
await page.evaluate(() => window.__fakePlayer.seekTo(40)); await page.waitForTimeout(100)
await page.getByTitle('현재 위치를 A 로').click()
await page.evaluate(() => window.__fakePlayer.seekTo(42)); await page.waitForTimeout(100)
await page.getByTitle('현재 위치를 B 로').click()
await page.getByTitle('A-B 반복').click()
await page.waitForTimeout(4000)
const loopPos = await page.evaluate(() => window.__fakePlayer.trueTime())
push('A-B 반복', loopPos >= 39.9 && loopPos <= 42.2 && (await page.evaluate(() => window.__seeks)) >= 3, `4초 후 위치 ${loopPos.toFixed(2)}s (구간 40~42s), 되감기 ${await page.evaluate(() => window.__seeks)}회`)
await page.getByTitle('A-B 반복').click()

// 탭 템포
await page.getByLabel('YouTube 배속').selectOption('1')
await page.evaluate(async () => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === '탭'); for (let i = 0; i < 5; i++) { b.click(); await new Promise((r) => setTimeout(r, 500)) } })
const tapped = +(await page.getByLabel('BPM 직접 입력').inputValue())
push('탭 템포 (0.5초 간격 → 120)', Math.abs(tapped - 120) < 4, `${tapped} BPM`)

// 클릭 동기화: 예약된 클릭 시각 vs 가짜 플레이어의 실제 박 시각
await page.getByLabel('BPM 직접 입력').fill('100')
await page.evaluate(() => {
  window.__clicks = []
  const orig = AudioBufferSourceNode.prototype.start
  AudioBufferSourceNode.prototype.start = function (when, ...a) { window.__clicks.push(when); return orig.call(this, when, ...a) }
})
async function measure(rate, secs = 6) {
  await page.getByLabel('YouTube 배속').selectOption(String(rate))
  await page.evaluate(() => { window.__fakePlayer.seekTo(60) }); await page.waitForTimeout(300)
  await page.evaluate(() => { window.__clicks = [] })
  await page.waitForTimeout(secs * 1000)
  return page.evaluate(() => {
    const p = window.__fakePlayer, off = 0 // offset 은 아래에서 읽음
    const it = window.__ytClickerItem
    const errs = []
    for (const w of window.__clicks) {
      const v = p.v0 + (w - p.c0) * p.rate // 그 클릭 시각에 실제 영상 위치
      const period = 60 / window.__bpm
      const k = Math.round((v - window.__off) / period)
      errs.push(((v - window.__off) - k * period) / p.rate * 1000)
    }
    const abs = errs.map(Math.abs)
    return { n: errs.length, mean: errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length), max: Math.max(0, ...abs) }
  })
}
// 클릭을 먼저 켜고(오디오 시계 생성) 다시 재생 → 가짜 플레이어가 같은 시계를 사용
await page.getByTitle('재생/일시정지').click()
await page.getByTitle('클릭 ON/OFF').click()
await page.getByTitle('재생/일시정지').click()
await page.evaluate(() => { window.__fakePlayer.seekTo(60) })
await page.waitForTimeout(200)
await page.getByRole('button', { name: '지금이 1박' }).click()
const off = 0
for (const rate of [1, 0.75, 0.5, 1.5]) {
  await page.evaluate(({ off }) => { window.__bpm = 100; window.__off = JSON.parse(localStorage.getItem('x') || 'null') ?? off }, { off })
  // 실제 저장된 offset 사용
  const item = await page.evaluate(async () => { const r = await new Promise((res) => { const q = indexedDB.open('guitar-studio-ai'); q.onsuccess = () => { const t = q.result.transaction('kv').objectStore('kv').get('youtube'); t.onsuccess = () => res(t.result) } }); return r && r[0] })
  await page.evaluate((o) => { window.__off = o }, item.offset)
  const m = await measure(rate)
  const expectN = Math.floor(6 * rate * 100 / 60) - 1
  push(`YouTube 클릭 동기화 ${rate}× (가짜 플레이어, 위치 보고 지터 ±15ms)`, m.n >= expectN && m.max < 25, `클릭 ${m.n}개 · 평균 ${m.mean.toFixed(1)}ms · 최대 ${m.max.toFixed(1)}ms`)
}
await page.getByTitle('클릭 ON/OFF').click()
await page.getByTitle('재생/일시정지').click()

// 저장 목록·재실행 후 복원
await page.getByPlaceholder('예: 2절 솔로 0.75배').fill('솔로 연습')
await page.waitForTimeout(300)
await page.reload(); await page.waitForFunction(() => window.__gs?.getState().ready)
await page.getByRole('button', { name: 'YouTube' }).first().click()
const saved = await page.getByText('테스트 영상 dQw4w9WgXcQ').first().isVisible()
const savedMeta = await page.getByText(/100 BPM \(직접 입력\)/).first().textContent()
push('저장 목록 유지 (재실행 후)', saved && /메모/.test(savedMeta), savedMeta)

push('콘솔 오류 없음', errors.length === 0, errors.slice(0, 3).join(' | ') || '없음')
await page.setViewportSize({ width: 390, height: 844 })
await page.getByText('테스트 영상 dQw4w9WgXcQ').first().click(); await page.waitForTimeout(300)
await page.screenshot({ path: 'test-results/youtube-mobile.png', fullPage: false })
push('모바일 390px 가로 넘침 없음', !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), '확인')
writeFileSync('test-results/youtube-e2e.json', JSON.stringify(results, null, 2))
await browser.close()
