import type { FocusMode } from './focus'
import workletUrl from './player.worklet.ts?worker&url'
import { synthClicks } from './clickSounds'
import type { ClickSound } from '../types'

type Listener = () => void

export interface LoadedAudio {
  duration: number
  sampleRate: number
  channels: number
  // 분석용 모노 다운믹스 (원본 sampleRate)
  mono: Float32Array
}

// 메인 스레드 측 오디오 엔진. 실제 재생/클릭 타이밍은 전부 AudioWorklet에서 처리된다.
export class AudioEngine {
  ctx: AudioContext | null = null
  node: AudioWorkletNode | null = null
  private ready: Promise<void> | null = null
  private listeners = new Set<Listener>()
  // 워크렛 보고값
  private lastSrc = 0
  private lastCtxTime = 0
  playing = false
  countIn = 0
  loopCount = 0
  duration = 0
  rate = 1
  onEnded: (() => void) | null = null
  onLoopDone: (() => void) | null = null
  private clickSound: ClickSound = 'electronic'

  subscribe(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { this.listeners.forEach((f) => f()) }

  init() {
    if (this.ready) return this.ready
    this.ready = (async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      this.ctx = ctx
      await ctx.audioWorklet.addModule(workletUrl)
      const node = new AudioWorkletNode(ctx, 'gs-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] })
      node.connect(ctx.destination)
      node.port.onmessage = (e) => this.onMsg(e.data)
      this.node = node
      this.setClickSound(this.clickSound)
    })()
    return this.ready
  }

  private onMsg(m: any) {
    if (m.type === 'pos') {
      this.lastSrc = m.src
      this.lastCtxTime = m.ctxTime
      const changed = this.playing !== m.playing || this.countIn !== m.countIn || this.loopCount !== m.loopCount
      this.playing = m.playing
      this.countIn = m.countIn
      this.loopCount = m.loopCount
      if (changed) this.emit()
    } else if (m.type === 'ended') {
      this.playing = false
      this.emit()
      this.onEnded?.()
    } else if (m.type === 'loopDone') {
      this.onLoopDone?.()
    }
  }

  async resume() {
    await this.init()
    if (this.ctx!.state !== 'running') await this.ctx!.resume()
  }

  /** 파일 디코딩 (원본은 읽기만 함) */
  async decode(data: ArrayBuffer): Promise<{ buffer: AudioBuffer }> {
    await this.init()
    const buffer = await this.ctx!.decodeAudioData(data)
    return { buffer }
  }

  load(buffer: AudioBuffer) {
    const L = new Float32Array(buffer.getChannelData(0))
    const R = buffer.numberOfChannels > 1 ? new Float32Array(buffer.getChannelData(1)) : null
    this.duration = buffer.duration
    this.lastSrc = 0
    this.playing = false
    const transfer = R ? [L.buffer, R.buffer] : [L.buffer]
    this.node!.port.postMessage({ type: 'load', L, R }, transfer)
    this.emit()
  }

  /** 현재 "들리는" 원곡 위치(초). 출력 지연을 보정해 화면 표시용으로 사용 */
  get position() {
    if (!this.ctx) return 0
    if (!this.playing || this.countIn > 0) return this.lastSrc
    const now = this.ctx.currentTime
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0)
    const p = this.lastSrc + (now - this.lastCtxTime - lat) * this.rate
    return Math.max(0, Math.min(this.duration, p))
  }

  play(countIn?: { beats: number; period: number; meter: number; startAt?: number }) {
    this.resume().then(() => {
      this.node!.port.postMessage({ type: 'play', countIn })
      this.playing = true
      this.emit()
    })
  }
  pause() { this.node?.port.postMessage({ type: 'pause' }); this.playing = false; this.emit() }
  seek(t: number) { this.node?.port.postMessage({ type: 'seek', t }); this.lastSrc = t; this.lastCtxTime = this.ctx?.currentTime ?? 0; this.emit() }
  setParams(p: { volume?: number; rate?: number; pitch?: number; musicMute?: boolean; clickOn?: boolean; clickGain?: number; clickOffset?: number; focusMode?: FocusMode; focusAmount?: number }) {
    if (p.rate !== undefined) this.rate = p.rate
    this.node?.port.postMessage({ type: 'params', ...p })
  }
  setLoop(enabled: boolean, a: number, b: number, repeat: number) {
    this.node?.port.postMessage({ type: 'loop', enabled, a, b, repeat })
  }
  setClicks(times: Float64Array, kinds: Uint8Array) {
    this.node?.port.postMessage({ type: 'clicks', times, kinds })
  }
  setClickSound(kind: ClickSound) {
    this.clickSound = kind
    if (!this.ctx || !this.node) return
    const [accent, beat, sub] = synthClicks(kind, this.ctx.sampleRate)
    this.node.port.postMessage({ type: 'sounds', accent, beat, sub })
  }
  async setOutputDevice(id: string) {
    const c = this.ctx as any
    if (c && typeof c.setSinkId === 'function') {
      try { await c.setSinkId(id || ''); return true } catch { return false }
    }
    return false
  }
  get supportsOutputSelect() {
    return typeof (AudioContext.prototype as any).setSinkId === 'function'
  }
}

export const engine = new AudioEngine()

/** 모노 다운믹스 + 파형 피크 계산 */
export function downmix(buffer: AudioBuffer): Float32Array {
  const n = buffer.length
  const out = new Float32Array(n)
  const ch = buffer.numberOfChannels
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) out[i] += d[i] / ch
  }
  return out
}

/** 파형 피크: bins개 구간의 [min,max] (확대용 고해상도 1개) */
export function computePeaks(mono: Float32Array, bins: number): Float32Array {
  const out = new Float32Array(bins * 2)
  const step = mono.length / bins
  for (let b = 0; b < bins; b++) {
    const s = Math.floor(b * step), e = Math.min(mono.length, Math.floor((b + 1) * step))
    let mn = 0, mx = 0
    for (let i = s; i < e; i++) { const v = mono[i]; if (v < mn) mn = v; if (v > mx) mx = v }
    out[b * 2] = mn
    out[b * 2 + 1] = mx
  }
  return out
}
