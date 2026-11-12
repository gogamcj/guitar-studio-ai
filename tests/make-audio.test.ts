// 브라우저 테스트용 음원 생성: npx vitest run tests/make-audio.test.ts
import { it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { CASES } from './cases'
import { synthSong, writeWav } from './synth'

it('make test audio', () => {
  mkdirSync('test-audio', { recursive: true })
  const truth: Record<string, unknown> = {}
  for (const spec of CASES) {
    const { pcm, sr, truth: t } = synthSong(spec)
    writeFileSync(`test-audio/${spec.name}.wav`, writeWav(pcm, sr))
    truth[spec.name] = { bpm: typeof spec.bpm === 'number' ? spec.bpm : 'variable', meter: spec.meter, key: spec.key, firstBeat: t.beats[0].t, chords: spec.bars }
  }
  // 싱크 측정용: 100 BPM 광대역 틱 (정답 비트 = 0.5초부터 0.6초 간격)
  const sr = 44100, dur = 40
  const pcm = new Float32Array(sr * dur)
  let seed = 3
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1 }
  for (let k = 0; ; k++) {
    const t = 0.5 + k * 0.6
    if (t > dur - 1) break
    const s0 = Math.round(t * sr)
    let prev = 0
    for (let i = 0; i < 0.004 * sr; i++) { const x = rnd(); pcm[s0 + i] += (k % 4 === 0 ? 0.9 : 0.6) * (x - prev) * Math.exp(-i / (0.0015 * sr)); prev = x }
  }
  writeFileSync('test-audio/sync_ticks_100.wav', writeWav(pcm, sr))
  writeFileSync('test-audio/truth.json', JSON.stringify(truth, null, 2))
})
