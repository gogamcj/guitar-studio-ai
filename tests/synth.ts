// 정답(BPM/박자/Key/코드)이 알려진 테스트 음원 합성기
import { parseChord } from '../src/lib/music'
import { QUALITIES } from '../src/lib/music'

export interface SongSpec {
  name: string
  bpm: number | ((bar: number) => number)
  meter: number
  bars: string[] // 마디별 코드 (반복)
  repeat: number
  key: { tonic: number; mode: 'major' | 'minor' }
  lead: number // 앞 무음(초)
  sr?: number
  /** 2마디마다 한 번 등 박 중간 코드 변경을 원하면 "C|G" 형식 */
  hat?: 'eighth' | 'sixteenth'
  seed?: number
  /** 튜닝 편차(센트), 멜로디(보컬 대용), 잡음(dB) — 실제 녹음 조건에 가깝게 */
  detuneCents?: number
  melody?: boolean
  noiseDb?: number
}

export interface Truth {
  beats: { t: number; beat: number }[]
  chords: { start: number; end: number; root: number; quality: string; bass: number; label: string }[]
  duration: number
}


export function synthSong(spec: SongSpec): { pcm: Float32Array; sr: number; truth: Truth } {
  const sr = spec.sr ?? 44100
  const tune = Math.pow(2, (spec.detuneCents ?? 0) / 1200)
  const midiHz = (m: number) => 440 * tune * Math.pow(2, (m - 69) / 12)
  const bpmAt = typeof spec.bpm === 'function' ? spec.bpm : () => spec.bpm as number
  const allBars: string[] = []
  for (let r = 0; r < spec.repeat; r++) allBars.push(...spec.bars)
  // 비트 시간 계산
  const beats: { t: number; beat: number }[] = []
  let t = spec.lead
  const barStart: number[] = []
  for (let b = 0; b < allBars.length; b++) {
    barStart.push(t)
    const p = 60 / bpmAt(b)
    for (let k = 0; k < spec.meter; k++) { beats.push({ t, beat: k + 1 }); t += p }
  }
  const end = t
  const duration = end + 1.5
  const pcm = new Float32Array(Math.ceil(duration * sr))
  let seed = spec.seed ?? 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1 }
  const addTone = (start: number, dur: number, hz: number, amp: number, harmonics: number[], decay: number) => {
    const s0 = Math.round(start * sr), n = Math.round(dur * sr)
    for (let i = 0; i < n && s0 + i < pcm.length; i++) {
      const tt = i / sr
      const env = Math.min(1, tt / 0.005) * Math.exp(-tt / decay) * Math.min(1, (dur - tt) / 0.02)
      let v = 0
      for (let h = 0; h < harmonics.length; h++) v += harmonics[h] * Math.sin(2 * Math.PI * hz * (h + 1) * tt)
      pcm[s0 + i] += amp * env * v
    }
  }
  const kick = (st: number) => {
    const s0 = Math.round(st * sr)
    for (let i = 0; i < 0.25 * sr && s0 + i < pcm.length; i++) {
      const tt = i / sr
      pcm[s0 + i] += 0.8 * Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-tt / 0.03)) * tt) * Math.exp(-tt / 0.09)
    }
  }
  const snare = (st: number) => {
    const s0 = Math.round(st * sr)
    for (let i = 0; i < 0.2 * sr && s0 + i < pcm.length; i++) {
      const tt = i / sr
      pcm[s0 + i] += (0.35 * rnd() + 0.2 * Math.sin(2 * Math.PI * 190 * tt)) * Math.exp(-tt / 0.05)
    }
  }
  const hat = (st: number, a: number) => {
    const s0 = Math.round(st * sr)
    let prev = 0
    for (let i = 0; i < 0.05 * sr && s0 + i < pcm.length; i++) {
      const x = rnd()
      pcm[s0 + i] += a * (x - prev) * Math.exp(-(i / sr) / 0.012)
      prev = x
    }
  }
  const chords: Truth['chords'] = []
  const guitarH = [1, 0.6, 0.45, 0.3, 0.2, 0.12, 0.08]
  for (let b = 0; b < allBars.length; b++) {
    const parts = allBars[b].split('|')
    const p = 60 / bpmAt(b)
    const beatsPerPart = spec.meter / parts.length
    parts.forEach((cs, pi) => {
      const ch = parseChord(cs)!
      const st = barStart[b] + pi * beatsPerPart * p
      const en = st + beatsPerPart * p
      const q = QUALITIES.find((x) => x.q === ch.quality)!
      chords.push({ start: st, end: en, root: ch.root, quality: ch.quality, bass: ch.bass, label: cs })
      // 베이스: 박마다 베이스 음 (E1~D#2 범위)
      const bassMidi = 28 + ((ch.bass - 4 + 12) % 12)
      for (let k = 0; k < beatsPerPart; k++) addTone(st + k * p, p * 0.9, midiHz(bassMidi), 0.35, [1, 0.5, 0.25], 0.5)
      // 기타/키보드: 3~5 옥타브 보이싱, 박마다 스트럼
      const tones = q.iv.map((iv) => 52 + ((ch.root + iv - 4 + 12) % 12) + (iv >= 12 ? 12 : 0))
      const voicing = [...tones, tones[0] + 12, (tones[2] ?? tones[1]) + 12]
      for (let k = 0; k < beatsPerPart; k++) {
        voicing.forEach((m, vi) => addTone(st + k * p + vi * 0.008, p * 0.95, midiHz(m), 0.09, guitarH, 0.6))
      }
    })
    // 드럼
    for (let k = 0; k < spec.meter; k++) {
      const bt = barStart[b] + k * p
      if (spec.meter === 3) { if (k === 0) kick(bt); else snare(bt) }
      else { if (k % 2 === 0) kick(bt); else snare(bt) }
      const sub = spec.hat === 'sixteenth' ? 4 : 2
      for (let s = 0; s < sub; s++) hat(bt + (s * p) / sub, s === 0 ? 0.25 : 0.15)
    }
  }
  // 멜로디: 조성 음계에서 무작위 8분음표 (비브라토 포함, 코드 외 음 포함 → 실제 보컬/리드와 유사)
  if (spec.melody) {
    const scale = spec.key.mode === 'major' ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]
    for (let i = 0; i + 1 < beats.length; i++) {
      const p = beats[i + 1].t - beats[i].t
      for (let h = 0; h < 2; h++) {
        if (rnd() < -0.6) continue
        const deg = scale[Math.floor((rnd() + 1) * 3.5) % 7]
        const m = 72 + ((spec.key.tonic + deg) % 12)
        const st = beats[i].t + h * p / 2
        const s0 = Math.round(st * sr), n = Math.round((p / 2) * 0.95 * sr)
        for (let k = 0; k < n && s0 + k < pcm.length; k++) {
          const tt = k / sr
          const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * tt)
          const env = Math.min(1, tt / 0.03) * Math.min(1, (n / sr - tt) / 0.03)
          pcm[s0 + k] += 0.16 * env * (Math.sin(2 * Math.PI * midiHz(m) * vib * tt) + 0.3 * Math.sin(4 * Math.PI * midiHz(m) * vib * tt))
        }
      }
    }
  }
  if (spec.noiseDb !== undefined) {
    let mx0 = 0
    for (const v of pcm) mx0 = Math.max(mx0, Math.abs(v))
    const a = mx0 * Math.pow(10, spec.noiseDb / 20)
    for (let i = 0; i < pcm.length; i++) pcm[i] += a * rnd()
  }
  // 정규화
  let mx = 0
  for (const v of pcm) mx = Math.max(mx, Math.abs(v))
  for (let i = 0; i < pcm.length; i++) pcm[i] = (pcm[i] / mx) * 0.9
  return { pcm, sr, truth: { beats, chords, duration } }
}

export function writeWav(pcm: Float32Array, sr: number): Uint8Array {
  const n = pcm.length
  const buf = new ArrayBuffer(44 + n * 2)
  const dv = new DataView(buf)
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) }
  ws(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE'); ws(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true)
  dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), true)
  return new Uint8Array(buf)
}
