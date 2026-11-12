// 공통 타입. 모든 분석값은 출처(source)와 신뢰도(confidence)를 함께 가진다.
export type Source = 'ai' | 'user'

export interface Valued<T> {
  value: T
  confidence: number // 0..1 (user 값은 1)
  source: Source
}

export interface TrackMeta {
  id: string // name+size+lastModified 기반 해시
  name: string
  size: number
  lastModified: number
  duration?: number
  sampleRate?: number
  channels?: number
  folder?: string
  path?: string // 데스크톱(Tauri) 전용 절대 경로
  addedAt: number
  lastPlayedAt?: number
  lastPosition?: number
  favorite?: boolean
  notes?: string
}

export interface Beat {
  t: number // 원곡 기준 초
  bar: number // 1부터
  beat: number // 마디 내 박 번호, 1부터
}

export interface TempoSegment {
  start: number
  end: number
  bpm: number
}

export interface ChordSegment {
  start: number
  end: number
  label: string // 'N' = 코드 없음
  root: number // 0..11, -1 = N
  quality: string
  bass: number // 0..11, -1 = N
  confidence: number
  source: Source
}

export interface KeySegment {
  start: number
  end: number
  tonic: number
  mode: 'major' | 'minor'
  confidence: number
}

export interface Section {
  start: number
  end: number
  label: string // Intro, Verse, Chorus, Bridge, Outro, 'A','B'...
  certain: boolean
}

export interface Analysis {
  trackId: string
  version: number
  analyzedAt: number
  duration: number
  bpm: Valued<number>
  tempoStable: boolean
  tempoSegments: TempoSegment[]
  meter: Valued<number> // 마디당 박 수 (2,3,4,5,6...)
  meterDenominator: number // 4 or 8
  beats: Beat[]
  key: Valued<{ tonic: number; mode: 'major' | 'minor' }>
  keySegments: KeySegment[]
  chords: ChordSegment[]
  sections: Section[]
  transpose: number // 사용자 Key 변경에 따른 표시 이조(반음)
  userEdited: boolean
}

export interface LoopRegion {
  id: string
  trackId: string
  a: number
  b: number
  name: string
  note?: string
  repeat: number // 0 = 무한
}

export interface Marker {
  id: string
  trackId: string
  t: number
  name: string
}

export type ClickSound = 'electronic' | 'woodblock' | 'stick' | 'cowbell' | 'kicksnare'
export type ClickSubdivision = 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'shuffle'

export interface Settings {
  theme: 'dark' | 'light'
  accent: 'orange' | 'blue'
  lang: 'ko' | 'en'
  clickSound: ClickSound
  clickVolume: number
  clickSubdivision: ClickSubdivision
  accentDownbeat: boolean
  countIn: number // 마디 수, 0 = 끔
  defaultRate: number
  defaultPitch: number
  waveformColor: string
  autoAnalyze: boolean
  analysisQuality: 'fast' | 'accurate'
  outputDeviceId: string
  volume: number
  clickOffsetMs: number // 사용자 미세 싱크 보정
  keepCopies: boolean // 음원 사본을 로컬(IndexedDB)에 보관 → 재실행 시 파일 재선택 불필요(모바일 권장)
}
