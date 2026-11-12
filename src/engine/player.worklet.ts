/* Guitar Studio AI — 플레이어 AudioWorklet
 * 원곡 재생 + 배속(WSOLA) + 피치(리샘플) + A-B 반복 + 클릭 합성을 "하나의 오디오 스레드"에서 처리한다.
 * 클릭은 매 출력 샘플의 원곡 위치(srcPos)가 분석된 비트 타임스탬프를 지나는 순간 트리거되므로
 * 배속/피치/루프와 무관하게 원곡 박자에 샘플 단위로 고정된다. (setInterval/UI 타이머 미사용)
 */
declare const sampleRate: number
declare const currentTime: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor()
}

import { WSOLA } from './wsola'

const BLOCK_REPORT = 6 // 6블록(768샘플)마다 위치 보고

interface Voice { buf: Float32Array; i: number; gain: number }

class PlayerProcessor extends AudioWorkletProcessor {
  L = new Float32Array(0)
  R = new Float32Array(0)
  len = 0
  playing = false
  pos = 0 // 원곡 위치(샘플) — bypass 모드에서 사용
  srcPos = 0 // 현재 출력 샘플의 원곡 위치(샘플)
  volume = 1
  rate = 1
  pitch = 0
  musicMute = false
  clickOn = false
  clickGain = 0.8
  clickOffset = 0 // 초
  loopOn = false
  loopA = 0
  loopB = 0
  loopRepeat = 0
  loopCount = 0
  fadeIn = 0
  times = new Float64Array(0)
  kinds = new Uint8Array(0)
  nextEv = 0
  sounds: Float32Array[] = [new Float32Array(0), new Float32Array(0), new Float32Array(0)]
  voices: Voice[] = []
  wsola: WSOLA | null = null
  stretchActive = false
  countInLeft = 0 // 남은 카운트인 클릭 수
  countInTimer = 0 // 다음 카운트인 클릭까지 출력 샘플
  countInPeriod = 0
  countInMeter = 4
  countInIdx = 0
  blocks = 0
  tmp = { l: 0, r: 0, s: 0 }

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent) => this.onMsg(e.data)
  }

  onMsg(m: any) {
    switch (m.type) {
      case 'load':
        this.L = m.L
        this.R = m.R || m.L
        this.len = this.L.length
        this.pos = 0
        this.srcPos = 0
        this.playing = false
        this.loopOn = false
        this.wsola = null
        this.resyncEvents()
        this.report(true)
        break
      case 'unload':
        this.L = new Float32Array(0); this.R = this.L; this.len = 0; this.playing = false; this.wsola = null
        break
      case 'play':
        if (!this.len) return
        if (this.pos >= this.len - 1) this.seekTo(0)
        this.playing = true
        this.fadeIn = 256
        if (m.countIn && m.countIn.beats > 0) {
          this.countInLeft = m.countIn.beats
          this.countInPeriod = (m.countIn.period * sampleRate) / this.rate
          this.countInMeter = m.countIn.meter || 4
          this.countInIdx = 0
          this.countInTimer = 0
          if (typeof m.countIn.startAt === 'number') this.seekTo(m.countIn.startAt * sampleRate)
        }
        this.report(true)
        break
      case 'pause':
        this.playing = false
        this.countInLeft = 0
        this.report(true)
        break
      case 'seek':
        this.seekTo(m.t * sampleRate)
        this.loopCount = 0
        this.report(true)
        break
      case 'params':
        if (m.volume !== undefined) this.volume = m.volume
        if (m.musicMute !== undefined) this.musicMute = m.musicMute
        if (m.clickOn !== undefined) this.clickOn = m.clickOn
        if (m.clickGain !== undefined) this.clickGain = m.clickGain
        if (m.clickOffset !== undefined) { this.clickOffset = m.clickOffset; this.resyncEvents() }
        if (m.rate !== undefined || m.pitch !== undefined) {
          if (m.rate !== undefined) this.rate = m.rate
          if (m.pitch !== undefined) this.pitch = m.pitch
          this.updateStretchMode()
        }
        break
      case 'loop':
        this.loopOn = !!m.enabled && m.b > m.a
        this.loopA = m.a * sampleRate
        this.loopB = m.b * sampleRate
        this.loopRepeat = m.repeat || 0
        this.loopCount = 0
        break
      case 'clicks':
        this.times = m.times
        this.kinds = m.kinds
        this.resyncEvents()
        break
      case 'sounds':
        this.sounds = [m.accent, m.beat, m.sub]
        break
    }
  }

  updateStretchMode() {
    const need = Math.abs(this.rate - 1) > 1e-6 || Math.abs(this.pitch) > 1e-6
    if (need && !this.stretchActive) {
      if (!this.wsola) this.wsola = new WSOLA(sampleRate)
      this.wsola.reset(this.srcPos)
    } else if (!need && this.stretchActive) {
      this.pos = this.srcPos
    }
    this.stretchActive = need
  }

  seekTo(samples: number, keepVoices = false) {
    const s = Math.max(0, Math.min(this.len - 1, samples))
    this.pos = s
    this.srcPos = s
    if (this.stretchActive && this.wsola) this.wsola.reset(s)
    this.fadeIn = 256
    if (!keepVoices) this.voices.length = 0
    this.resyncEvents()
  }

  resyncEvents() {
    // srcPos 이후 첫 이벤트 인덱스 (이진 탐색)
    const t = this.srcPos / sampleRate - this.clickOffset
    let lo = 0, hi = this.times.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.times[mid] < t) lo = mid + 1
      else hi = mid
    }
    this.nextEv = lo
  }

  trigger(kind: number) {
    const buf = this.sounds[kind] || this.sounds[1]
    if (!buf || !buf.length) return
    if (this.voices.length > 6) this.voices.shift()
    this.voices.push({ buf, i: 0, gain: 1 })
  }

  report(force = false) {
    this.blocks++
    if (!force && this.blocks % BLOCK_REPORT !== 0) return
    this.port.postMessage({
      type: 'pos',
      src: this.srcPos / sampleRate,
      ctxTime: currentTime,
      playing: this.playing,
      countIn: this.countInLeft,
      loopCount: this.loopCount,
    })
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]
    const oL = out[0]
    const oR = out[1] || out[0]
    const n = oL.length
    if (!this.playing || !this.len) {
      // 정지 중에도 남은 클릭 꼬리는 재생
      for (let i = 0; i < n; i++) { const c = this.mixVoices(); oL[i] = c; oR[i] = c }
      if (!this.playing && this.blocks % 30 === 0) this.report()
      else this.blocks++
      return true
    }
    const L = this.L, R = this.R, len = this.len
    const tmp = this.tmp
    const pitchRatio = Math.pow(2, this.pitch / 12)
    const speed = this.rate / pitchRatio
    const fadeLen = 192
    for (let i = 0; i < n; i++) {
      // 카운트인: 원곡은 멈춘 채 클릭만 출력 (n개 클릭 후 n*P 시점에 원곡 시작)
      if (this.countInLeft > 0) {
        if (this.countInTimer <= 0) {
          if (this.countInIdx < this.countInLeft) {
            this.trigger(this.countInIdx % this.countInMeter === 0 ? 0 : 1)
            this.countInIdx++
            this.countInTimer += this.countInPeriod
          } else {
            this.countInLeft = 0
            this.resyncEvents()
          }
        }
        if (this.countInLeft > 0) {
          this.countInTimer--
          const c = this.mixVoices()
          oL[i] = c; oR[i] = c
          continue
        }
      }
      let l: number, r: number
      if (this.stretchActive && this.wsola) {
        this.wsola.next(L, R, speed, pitchRatio, tmp)
        l = tmp.l; r = tmp.r
        this.srcPos = tmp.s
      } else {
        const p = this.pos
        const i0 = p | 0
        const fr = p - i0
        if (i0 + 1 < len) {
          l = L[i0] + (L[i0 + 1] - L[i0]) * fr
          r = R[i0] + (R[i0 + 1] - R[i0]) * fr
        } else { l = 0; r = 0 }
        this.srcPos = p
        this.pos = p + 1
      }
      // A-B 반복
      let g = this.volume
      if (this.loopOn) {
        const remain = (this.loopB - this.srcPos) / this.rate
        if (remain < fadeLen && remain > 0) g *= remain / fadeLen
        if (this.srcPos >= this.loopB) {
          this.loopCount++
          if (this.loopRepeat > 0 && this.loopCount >= this.loopRepeat) {
            this.loopOn = false
            this.port.postMessage({ type: 'loopDone' })
          } else {
            this.seekTo(this.loopA, true)
            g = 0
          }
        }
      }
      if (this.fadeIn > 0) { g *= 1 - this.fadeIn / 256; this.fadeIn-- }
      if (this.musicMute) g = 0
      // 클릭: 원곡 위치가 다음 비트 타임스탬프를 지나는 순간 트리거
      const tSec = this.srcPos / sampleRate - this.clickOffset
      while (this.nextEv < this.times.length && this.times[this.nextEv] <= tSec) {
        // 탐색/루프 직후 오래된 이벤트는 건너뜀 (20ms 이상 지난 것)
        if (this.clickOn && tSec - this.times[this.nextEv] < 0.02) this.trigger(this.kinds[this.nextEv])
        this.nextEv++
      }
      const c = this.mixVoices()
      oL[i] = l * g + c
      oR[i] = r * g + c
      if (this.srcPos >= len - 1) {
        this.playing = false
        this.pos = len - 1
        this.port.postMessage({ type: 'ended' })
        for (let j = i + 1; j < n; j++) { oL[j] = 0; oR[j] = 0 }
        break
      }
    }
    this.report()
    return true
  }

  mixVoices() {
    if (!this.voices.length) return 0
    let s = 0
    for (let v = this.voices.length - 1; v >= 0; v--) {
      const vo = this.voices[v]
      s += vo.buf[vo.i++] * vo.gain
      if (vo.i >= vo.buf.length) this.voices.splice(v, 1)
    }
    return s * this.clickGain
  }
}

registerProcessor('gs-player', PlayerProcessor)
