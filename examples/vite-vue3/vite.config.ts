import poke from '@poke-dev/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [poke(), vue()],
  server: {
    port: 5174,
    open: true,
  },
})