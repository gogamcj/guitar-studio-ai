// YouTube 공식 IFrame 플레이어 (영상 소리를 받아오지 않음 — 이용약관 준수).
// 이 탭을 열고 영상을 불러올 때만 YouTube 서버에 접속한다.

/** 다양한 형태의 YouTube 링크(또는 11자리 ID)에서 영상 ID 추출 */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  let u: URL
  try { u = new URL(s.startsWith('http') ? s : 'https://' + s) } catch { return null }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else {
      const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]{11})/)
      if (m) id = m[2]
    }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null
}

/** 링크의 t= / start= 파라미터(초) */
export function parseStart(input: string): number {
  try {
    const u = new URL(input.trim().startsWith('http') ? input.trim() : 'https://' + input.trim())
    const t = u.searchParams.get('t') || u.searchParams.get('start')
    if (!t) return 0
    if (/^\d+$/.test(t)) return +t
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/)
    return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0
  } catch { return 0 }
}

let apiPromise: Promise<any> | null = null
export function loadYouTubeApi(): Promise<any> {
  const w = window as any
  if (w.YT?.Player) return Promise.resolve(w.YT)
  if (apiPromise) return apiPromise
  apiPromise = new Promise((resolve, reject) => {
    const prev = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT) }
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    s.async = true
    s.onerror = () => { apiPromise = null; s.remove(); reject(new Error('YouTube 에 연결할 수 없습니다. 인터넷 연결을 확인하세요.')) }
    document.head.appendChild(s)
  })
  return apiPromise
}

/** 탭 템포: 최근 탭 간격의 중앙값으로 BPM */
export function tapBpm(taps: number[]): number | null {
  if (taps.length < 3) return null
  const iv = taps.slice(1).map((t, i) => t - taps[i]).slice(-8).sort((a, b) => a - b)
  const med = iv[iv.length >> 1]
  return med > 0.15 && med < 2.5 ? Math.round((600 / med)) / 10 : null
}
