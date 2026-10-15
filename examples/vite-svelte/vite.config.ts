import poke from '@poke-dev/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    poke(),
    svelte(),
  ],
  server: {
    open: true,
    port: 5176,
  },
})
