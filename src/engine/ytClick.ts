// YouTube 재생용 클릭: YouTube 플레이어의 재생 시각을 AudioContext 시계에 맞춰 추정하고,
// 클릭은 AudioContext 의 정확한 시각에 예약한다(룩어헤드 스케줄링). YouTube 소리는 받을 수 없어서
// 내 파일 재생(샘플 단위 동기화)보다 정확도가 낮다(수십 ms 수준 어긋남 가능).
import { synthClicks } from './clickSounds'
import type { ClickSound } from '../types'

export interface YtBeatGrid { bpm: number; offset: number; meter: number }

export class YtClicker {
  ctx: AudioContext | null = null
  bufs: AudioBuffer[] = []
  sound: ClickSound = 'electronic'
  gain = 0.8
  latency = 0 // 사용자 보정(초) — +면 클릭을 늦춤
  private anchorV = 0 // 영상 시각
  private anchorC = 0 // AudioContext 시각
  private rate = 1
  private lastBeat = -1
  private lastRep = NaN
  private running = false
  private out: GainNode | null = null
  private scheduled: AudioBufferSourceNode[] = []

  private ensure() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      this.out = this.ctx.createGain()
      this.out.connect(this.ctx.destination)
      this.setSound(this.sound)
    }
    if (this.ctx.state === 'suspended') this.ctx.resume()
    return this.ctx
  }
  setSound(s: ClickSound) {
    this.sound = s
    if (!this.ctx) return
    const sr = this.ctx.sampleRate
    this.bufs = synthClicks(s, sr).map((d) => { const b = this.ctx!.createBuffer(1, Math.max(1, d.length), sr); b.copyToChannel(new Float32Array(d), 0); return b })
  }
  start() { this.ensure(); this.running = true; this.lastBeat = -1e9 }
  stop() {
    this.running = false
    for (const s of this.scheduled) { try { s.stop() } catch { /* 이미 끝남 */ } }
    this.scheduled = []
  }
  /** 재생 중 주기적으로 호출: v = 플레이어가 보고한 현재 영상 시각 */
  tick(v: number, rate: number, playing: boolean, grid: YtBeatGrid | null) {
    if (!this.running || !this.ctx || !grid || !(grid.bpm > 0)) return
    const now = this.ctx.currentTime
    if (!playing) { this.anchorV = v; this.anchorC = now; this.rate = rate; this.lastBeat = this.beatIndexAt(v, grid) - 1e-6; this.cancelFuture(); return }
    const pred = this.anchorV + (now - this.anchorC) * this.rate
    // YouTube 는 재생 위치를 띄엄띄엄 갱신하므로, 값이 새로 바뀐 순간만 측정값으로 사용
    const fresh = v !== this.lastRep
    this.lastRep = v
    if (rate !== this.rate || Math.abs(v - pred) > 0.12) {
      // 큰 차이(탐색·버퍼링·배속 변경) → 다시 맞춤
      this.anchorV = v; this.anchorC = now; this.rate = rate
      this.cancelFuture()
      this.lastBeat = this.beatIndexAt(v, grid) - 1e-6
    } else {
      // 작은 차이 → 천천히 보정(지터 평균화)
      this.anchorV = fresh ? pred + (v - pred) * 0.08 : pred
      this.anchorC = now
    }
    const period = 60 / grid.bpm
    const ahead = this.anchorV + 0.15 * this.rate
    let k = Math.floor(this.lastBeat) + 1
    for (; grid.offset + k * period <= ahead; k++) {
      const bv = grid.offset + k * period
      if (bv < this.anchorV - 0.01) continue
      const when = this.anchorC + (bv - this.anchorV) / this.rate + this.latency
      if (when < now) continue
      const src = this.ctx.createBufferSource()
      const kind = ((k % grid.meter) + grid.meter) % grid.meter === 0 ? 0 : 1
      src.buffer = this.bufs[kind]
      const g = this.ctx.createGain(); g.gain.value = this.gain
      src.connect(g); g.connect(this.out!)
      src.start(when)
      src.onended = () => { this.scheduled = this.scheduled.filter((x) => x !== src) }
      this.scheduled.push(src)
      this.lastBeat = k
    }
  }
  private beatIndexAt(v: number, g: YtBeatGrid) { return (v - g.offset) / (60 / g.bpm) }
  private cancelFuture() {
    if (!this.ctx) return
    for (const s of this.scheduled) { try { s.stop() } catch { /* */ } }
    this.scheduled = []
  }
}
