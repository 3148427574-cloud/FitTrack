import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages 项目站点跑在 /FitTrack/ 子路径下，base 必须跟仓库名一致
export default defineConfig({
  base: '/FitTrack/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'FitTrack',
        short_name: 'FitTrack',
        description: '训练计划、配重与卡路里估算、体重与饮食管理',
        lang: 'zh-CN',
        theme_color: '#111417',
        background_color: '#111417',
        display: 'standalone',
        start_url: '/FitTrack/',
        scope: '/FitTrack/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
