import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 部署于 /admin/（nginx SPA fallback 到 index.html）；开发时 /api 反代到本地 server
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  /* 医院电脑上常见旧内核浏览器（360 安全浏览器极速模式的老版本、Win7 上没再更新的 Chrome）：
     默认产物要 Chrome 87+，旧内核遇到 ?? / ?. 这类新语法直接白屏。这里让 esbuild 把语法降到 Chrome 64 也能跑。 */
  build: { target: ['es2017', 'chrome64', 'edge79', 'firefox67', 'safari12'] },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false }
    }
  }
})
