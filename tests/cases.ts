import type { SongSpec } from './synth'

export const CASES: SongSpec[] = [
  { name: 'pop_120_G', bpm: 120, meter: 4, bars: ['G', 'D', 'Em', 'C'], repeat: 8, key: { tonic: 7, mode: 'major' }, lead: 0.37 },
  { name: 'ballad_92.5_Am', bpm: 92.5, meter: 4, bars: ['Am', 'F', 'C', 'G'], repeat: 6, key: { tonic: 9, mode: 'minor' }, lead: 0.8 },
  { name: 'waltz_150_C', bpm: 150, meter: 3, bars: ['C', 'C', 'G7', 'G7', 'Am', 'Am', 'F', 'G'], repeat: 5, key: { tonic: 0, mode: 'major' }, lead: 0.2 },
  { name: 'slash_76_D', bpm: 76, meter: 4, bars: ['D', 'A/C#', 'Bm', 'G', 'Em7', 'A7', 'D', 'D'], repeat: 4, key: { tonic: 2, mode: 'major' }, lead: 0.5 },
  { name: 'fast_174_Em', bpm: 174, meter: 4, bars: ['Em', 'C', 'G', 'D'], repeat: 12, key: { tonic: 4, mode: 'minor' }, lead: 0.1, hat: 'eighth' },
  { name: 'jazzish_110_F', bpm: 110, meter: 4, bars: ['Fmaj7', 'Dm7', 'Gm7', 'C7', 'Am7', 'Dm7', 'Bbmaj7', 'C7'], repeat: 4, key: { tonic: 5, mode: 'major' }, lead: 0.3 },
  { name: 'halfbar_100_A', bpm: 100, meter: 4, bars: ['A|E', 'F#m|D', 'A|E', 'D|E'], repeat: 8, key: { tonic: 9, mode: 'major' }, lead: 0.6 },
  { name: 'tempo_change_100to112_C', bpm: (b) => (b < 16 ? 100 : 112), meter: 4, bars: ['C', 'Am', 'F', 'G'], repeat: 8, key: { tonic: 0, mode: 'major' }, lead: 0.4 },
  // 실제 녹음 조건 근사: 튜닝 편차 + 멜로디(코드 외 음) + 잡음
  { name: 'real_pop_120_G_detune+35_melody_noise', bpm: 120, meter: 4, bars: ['G', 'D', 'Em', 'C'], repeat: 8, key: { tonic: 7, mode: 'major' }, lead: 0.37, detuneCents: 35, melody: true, noiseDb: -30, seed: 11 },
  { name: 'real_ballad_92.5_Am_detune-20_melody', bpm: 92.5, meter: 4, bars: ['Am', 'F', 'C', 'G'], repeat: 6, key: { tonic: 9, mode: 'minor' }, lead: 0.8, detuneCents: -20, melody: true, noiseDb: -35, seed: 12 },
  { name: 'real_jazz_110_F_melody_noise', bpm: 110, meter: 4, bars: ['Fmaj7', 'Dm7', 'Gm7', 'C7', 'Am7', 'Dm7', 'Bbmaj7', 'C7'], repeat: 4, key: { tonic: 5, mode: 'major' }, lead: 0.3, melody: true, noiseDb: -30, seed: 13 },
  { name: 'real_slash_76_D_A432_melody', bpm: 76, meter: 4, bars: ['D', 'A/C#', 'Bm', 'G', 'Em7', 'A7', 'D', 'D'], repeat: 4, key: { tonic: 2, mode: 'major' }, lead: 0.5, detuneCents: -31.8, melody: true, noiseDb: -32, seed: 14 },
]
