import type { ClickSound } from '../types'

// 클릭 음색을 실시간 합성(샘플 파일 없음 → 라이선스 문제 없음). [강박, 박, 세분] 순서.
export function synthClicks(kind: ClickSound, sr: number): [Float32Array, Float32Array, Float32Array] {
  const mk = (dur: number) => new Float32Array(Math.round(dur * sr))
  // 결정적 노이즈
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x3fffffff - 1 }

  const tone = (freq: number, dur: number, decay: number, amp: number, harm = 0) => {
    const b = mk(dur)
    for (let i = 0; i < b.length; i++) {
      const t = i / sr
      const env = Math.exp(-t / decay) * Math.min(1, i / (0.0005 * sr))
      b[i] = amp * env * (Math.sin(2 * Math.PI * freq * t) + harm * Math.sin(2 * Math.PI * freq * 2.76 * t))
    }
    return b
  }
  const noise = (dur: number, decay: number, amp: number, hp = 0.9) => {
    const b = mk(dur)
    let prev = 0, prevOut = 0
    for (let i = 0; i < b.length; i++) {
      const x = rnd()
      const y = hp * (prevOut + x - prev) // 1차 하이패스
      prev = x; prevOut = y
      b[i] = amp * y * Math.exp(-(i / sr) / decay)
    }
    return b
  }
  const add = (a: Float32Array, b: Float32Array) => { for (let i = 0; i < Math.min(a.length, b.length); i++) a[i] += b[i]; return a }

  switch (kind) {
    case 'electronic':
      return [tone(1760, 0.06, 0.012, 0.9), tone(1320, 0.05, 0.01, 0.7), tone(1320, 0.04, 0.007, 0.4)]
    case 'woodblock':
      return [tone(1200, 0.09, 0.02, 0.9, 0.4), tone(900, 0.08, 0.018, 0.75, 0.4), tone(900, 0.06, 0.012, 0.45, 0.4)]
    case 'stick':
      return [add(noise(0.05, 0.006, 1.2, 0.97), tone(2500, 0.03, 0.004, 0.4)), noise(0.04, 0.005, 0.9, 0.97), noise(0.03, 0.004, 0.5, 0.97)]
    case 'cowbell': {
      const bell = (amp: number, dur: number) => add(tone(562, dur, 0.06, amp * 0.6), tone(845, dur, 0.05, amp * 0.5))
      return [bell(1, 0.25), bell(0.7, 0.2), bell(0.4, 0.12)]
    }
    case 'kicksnare': {
      const kick = mk(0.25)
      for (let i = 0; i < kick.length; i++) {
        const t = i / sr
        const f = 50 + 110 * Math.exp(-t / 0.03)
        kick[i] = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.08)
      }
      const snare = add(noise(0.2, 0.05, 0.9, 0.8), tone(190, 0.2, 0.04, 0.4))
      const hat = noise(0.05, 0.01, 0.5, 0.98)
      return [kick, snare, hat]
    }
  }
}
