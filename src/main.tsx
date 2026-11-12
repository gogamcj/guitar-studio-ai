import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 자동화 테스트 전용 훅 (?gstest 쿼리일 때만 노출)
if (location.search.includes('gstest')) {
  Promise.all([import('./engine/AudioEngine'), import('./store/app'), import('./engine/wsola')]).then(([e, s, w]) => {
    ;(window as any).__gs = { engine: e.engine, WSOLA: w.WSOLA, ...s }
    if (location.search.includes('autotest')) import(/* @vite-ignore */ new URL('autotest.js', location.href).href)
  })
}

// PWA 오프라인 캐시: 브라우저에서만 서비스워커 등록 (데스크톱 앱은 파일이 이미 로컬에 있음)
if ('serviceWorker' in navigator && !('__TAURI_INTERNALS__' in window) && location.protocol !== 'file:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {}) })
}
