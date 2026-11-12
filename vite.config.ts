import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // main.tsx 에서 직접 등록 (Tauri 데스크톱에서는 서비스워커 불필요)
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Guitar Studio AI',
        short_name: 'Guitar Studio',
        description: '기타리스트를 위한 로컬 음악 분석 플레이어',
        lang: 'ko',
        theme_color: '#0b0b0d',
        background_color: '#0b0b0d',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  worker: { format: 'es' },
  server: { port: 5173 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], testTimeout: 120000 },
} as never)
