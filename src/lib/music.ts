export const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// 조성에 따라 #/b 표기 선택
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]) // F Bb Eb Ab Db Gb
export function useFlats(tonic: number, mode: 'major' | 'minor') {
  const rel = mode === 'minor' ? (tonic + 3) % 12 : tonic
  return FLAT_MAJOR.has(rel)
}
export function noteName(pc: number, flats = false) {
  if (pc < 0) return 'N'
  return (flats ? FLAT : SHARP)[((pc % 12) + 12) % 12]
}

export function keyName(tonic: number, mode: 'major' | 'minor', lang: 'ko' | 'en' = 'en') {
  const n = noteName(tonic, useFlats(tonic, mode))
  if (lang === 'ko') return `${n} ${mode === 'major' ? '메이저' : '마이너'}`
  return `${n} ${mode === 'major' ? 'Major' : 'Minor'}`
}

// Camelot Wheel: 메이저 = B, 마이너 = A
const CAMELOT_MAJOR: Record<number, number> = { 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7, 0: 8, 7: 9, 2: 10, 9: 11, 4: 12 }
export function camelot(tonic: number, mode: 'major' | 'minor') {
  if (mode === 'major') return `${CAMELOT_MAJOR[tonic]}B`
  return `${CAMELOT_MAJOR[(tonic + 3) % 12]}A`
}

// 코드 품질 정의 (근음 기준 반음 구성음)
export const QUALITIES: { q: string; iv: number[]; label: string }[] = [
  { q: 'maj', iv: [0, 4, 7], label: '' },
  { q: 'min', iv: [0, 3, 7], label: 'm' },
  { q: '7', iv: [0, 4, 7, 10], label: '7' },
  { q: 'maj7', iv: [0, 4, 7, 11], label: 'maj7' },
  { q: 'min7', iv: [0, 3, 7, 10], label: 'm7' },
  { q: 'sus2', iv: [0, 2, 7], label: 'sus2' },
  { q: 'sus4', iv: [0, 5, 7], label: 'sus4' },
  { q: 'add9', iv: [0, 2, 4, 7], label: 'add9' },
  { q: 'dim', iv: [0, 3, 6], label: 'dim' },
  { q: 'aug', iv: [0, 4, 8], label: 'aug' },
  { q: 'hdim7', iv: [0, 3, 6, 10], label: 'm7b5' },
  { q: 'min6', iv: [0, 3, 7, 9], label: 'm6' },
  { q: '6', iv: [0, 4, 7, 9], label: '6' },
  { q: '5', iv: [0, 7], label: '5' },
]
export const QUALITY_LABEL: Record<string, string> = Object.fromEntries(QUALITIES.map((x) => [x.q, x.label]))

export function chordLabel(root: number, quality: string, bass: number, flats = false) {
  if (root < 0) return 'N.C.'
  const lab = noteName(root, flats) + (QUALITY_LABEL[quality] ?? quality)
  if (bass >= 0 && bass !== root) return `${lab}/${noteName(bass, flats)}`
  return lab
}

/** 사용자가 입력한 코드 문자열 파싱 (예: "F#m7/C#", "Bbmaj7", "N.C.") */
export function parseChord(s: string): { root: number; quality: string; bass: number } | null {
  const str = s.trim()
  if (!str || /^n(\.?c\.?)?$/i.test(str)) return { root: -1, quality: 'N', bass: -1 }
  const m = /^([A-Ga-g])([#b]?)([^/]*)(?:\/([A-Ga-g])([#b]?))?$/.exec(str)
  if (!m) return null
  const pc = (l: string, acc: string) => {
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[l.toUpperCase()]!
    return (base + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12
  }
  const root = pc(m[1], m[2])
  const rest = m[3]
  const alias: Record<string, string> = {
    '': 'maj', M: 'maj', maj: 'maj', m: 'min', min: 'min', '-': 'min', '7': '7', dom7: '7', maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7',
    m7: 'min7', min7: 'min7', '-7': 'min7', sus2: 'sus2', sus4: 'sus4', sus: 'sus4', add9: 'add9', add2: 'add9', dim: 'dim', o: 'dim', '°': 'dim',
    aug: 'aug', '+': 'aug', m7b5: 'hdim7', 'ø': 'hdim7', 'ø7': 'hdim7', m6: 'min6', '6': '6', '5': '5',
  }
  const quality = alias[rest] ?? rest // 알 수 없는 확장 코드는 문자열 그대로 보존
  const bass = m[4] ? pc(m[4], m[5]) : root
  return { root, quality, bass }
}

export function transposePc(pc: number, semis: number) {
  return pc < 0 ? pc : (((pc + semis) % 12) + 12) % 12
}

export function fmtTime(t: number, ms = false) {
  if (!isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const base = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  if (!ms) return base
  return `${base}.${String(Math.floor((t % 1) * 10))}`
}

/** 이조를 적용한 표시용 코드 이름 */
export function displayChordLabel(c: { root: number; quality: string; bass: number }, semis: number, keyTonic: number, keyMode: 'major' | 'minor') {
  if (c.root < 0) return 'N.C.'
  const kt = transposePc(keyTonic, semis)
  return chordLabel(transposePc(c.root, semis), c.quality, transposePc(c.bass, semis), useFlats(kt, keyMode))
}
