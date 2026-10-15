import poke from '@poke-dev/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    poke(), // 注册 Poke 插件
    react(),
  ],
  server: {
    open: true,
    port: 5173,
  },
})
