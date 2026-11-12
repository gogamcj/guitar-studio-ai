// 분석 Web Worker: UI 스레드를 막지 않도록 백그라운드에서 실행
import { analyze } from './analyze'

self.onmessage = (e: MessageEvent) => {
  const { id, mono, sr, opts } = e.data
  try {
    const result = analyze(mono, sr, opts, (p, stage) => (self as any).postMessage({ id, type: 'progress', p, stage }))
    ;(self as any).postMessage({ id, type: 'done', result })
  } catch (err: any) {
    ;(self as any).postMessage({ id, type: 'error', message: String(err?.message || err) })
  }
}
