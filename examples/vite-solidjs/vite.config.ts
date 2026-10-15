import poke from '@poke-dev/vite'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'

export default defineConfig({
  plugins: [
    poke(),
    solid(),
  ],
  server: {
    open: true,
    port: 5175,
  },
})
