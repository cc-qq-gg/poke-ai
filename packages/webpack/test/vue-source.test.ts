import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// The injector ships as CommonJS (a webpack loader must be CJS); load it through
// createRequire so the ESM test runner and `tsc --noEmit` both stay happy.
const require = createRequire(import.meta.url)
const { injectVueSourceAttributes } = require('../src/vue-source.cjs') as {
  injectVueSourceAttributes: (code: string, fileName: string) => string | null
}

const FILE = '/abs/src/App.vue'

describe('injectVueSourceAttributes (webpack / Vue2 path)', () => {
  it('tags native elements with file:line:col coordinates', () => {
    const out = injectVueSourceAttributes('<template>\n  <div id="app"></div>\n</template>', FILE)

    expect(out).toContain('<div data-poke-source="/abs/src/App.vue:2:3"')
    expect(out).toContain('data-poke-source-range="/abs/src/App.vue:2:3-')
  })

  it('skips components, <template> wrappers and <slot> (only native DOM elements)', () => {
    const sfc = `<template>
  <CompA msg="hi" />
  <template #header><h1>t</h1></template>
  <slot name="x" />
</template>`
    const out = injectVueSourceAttributes(sfc, FILE) ?? ''

    expect(out).not.toContain('<CompA data-poke-source')
    expect(out).not.toMatch(/<template data-poke-source/)
    expect(out).not.toContain('<slot data-poke-source')
    // the native <h1> inside the named slot still gets tagged
    expect(out).toContain('<h1 data-poke-source')
  })

  it('ignores markup inside comments and never touches <script>/<style>', () => {
    const sfc = `<template>
  <!-- <div>commented</div> -->
  <span>ok</span>
</template>

<script>
export default { render() { return '<div>in script</div>' } }
</script>
<style>.a{color:red}</style>`
    const out = injectVueSourceAttributes(sfc, FILE) ?? ''

    expect(out).not.toMatch(/<!--\s*<div data-poke-source/)
    expect(out).toContain('<span data-poke-source')
    const scriptBlock = out.slice(out.indexOf('<script>'), out.indexOf('</script>'))
    expect(scriptBlock).not.toContain('data-poke-source')
  })

  it('is idempotent: already-injected elements are not tagged twice', () => {
    const once = injectVueSourceAttributes('<template><p>x</p></template>', FILE) ?? ''
    // The loader keeps the original source when the injector has nothing to add.
    const twice = injectVueSourceAttributes(once, FILE) ?? once

    expect(twice).toBe(once)
    expect((twice.match(/data-poke-source="/g) ?? []).length).toBe(1)
  })

  it('escapes HTML entities in the coordinate value', () => {
    const out = injectVueSourceAttributes('<template><p>x</p></template>', '/a&b/"q.vue') ?? ''

    expect(out).toContain('/a&amp;b/&quot;q.vue')
  })

  it('tags void/self-closing native elements', () => {
    const out = injectVueSourceAttributes('<template><img src="a.png"><br></template>', FILE) ?? ''

    expect(out).toContain('<img data-poke-source')
    expect(out).toContain('<br data-poke-source')
  })

  it('returns null when the SFC has no <template> block', () => {
    expect(injectVueSourceAttributes('<script>export default {}</script>', FILE)).toBeNull()
  })
})

// The loader wraps the injector with a per-file memo; exercise it through a fake
// webpack loader context (`this.resourcePath`).
const pokeVueSourceLoader = require('../src/vue-source-loader.cjs') as (
  this: { resourcePath: string },
  source: string,
) => string

describe('pokeVueSourceLoader memoization', () => {
  const src = '<template>\n  <div>hi</div>\n</template>\n<script>export default {}</script>'

  it('injects source coords through the loader', () => {
    const out = pokeVueSourceLoader.call({ resourcePath: '/abs/src/Loader.vue' }, src)

    expect(out).toContain('data-poke-source="/abs/src/Loader.vue:2:3"')
  })

  it('returns the exact same markup for repeated sub-requests of one source', () => {
    const a = pokeVueSourceLoader.call({ resourcePath: '/abs/src/Sub.vue' }, src)
    const b = pokeVueSourceLoader.call({ resourcePath: '/abs/src/Sub.vue' }, src)

    expect(a).toContain('data-poke-source')
    expect(b).toBe(a)
  })

  it('recomputes on content change and passes non-.vue requests through untouched', () => {
    const path = '/abs/src/Edit.vue'
    pokeVueSourceLoader.call({ resourcePath: path }, src)
    const changed = pokeVueSourceLoader.call({ resourcePath: path }, src.replace('hi', 'bye'))

    expect(changed).toContain('>bye<')
    expect(pokeVueSourceLoader.call({ resourcePath: '/abs/main.js' }, src)).toBe(src)
  })
})
