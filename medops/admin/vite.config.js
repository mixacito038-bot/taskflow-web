import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 部署于 /admin/（nginx SPA fallback 到 index.html）；开发时 /api 反代到本地 server
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false }
    }
  }
})
