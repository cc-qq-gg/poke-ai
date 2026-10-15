import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import poke from '@poke-dev/astro'

export default defineConfig({
  integrations: [react(), poke()],
})
