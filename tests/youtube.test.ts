import { describe, expect, it } from 'vitest'
import { parseStart, parseYouTubeId, tapBpm } from '../src/lib/youtube'

describe('YouTube 링크 해석', () => {
  const id = 'dQw4w9WgXcQ'
  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&list=PL123&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}?feature=share`,
    `youtube.com/watch?v=${id}`,
    id,
  ])('%s', (u) => expect(parseYouTubeId(u)).toBe(id))
  it.each(['https://example.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/', 'hello', 'https://youtu.be/short'])('거부: %s', (u) => expect(parseYouTubeId(u)).toBeNull())
  it('시작 시각', () => {
    expect(parseStart('https://youtu.be/dQw4w9WgXcQ?t=90')).toBe(90)
    expect(parseStart('https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toBe(90)
    expect(parseStart('https://youtube.com/watch?v=dQw4w9WgXcQ')).toBe(0)
  })
  it('탭 템포', () => {
    expect(tapBpm([0, 0.5, 1.0, 1.5, 2.0])).toBe(120)
    expect(tapBpm([0, 0.52, 1.0, 1.49, 2.01])).toBeCloseTo(120, -1)
    expect(tapBpm([0, 0.5])).toBeNull()
  })
})
