import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { PokeWebpackPlugin, pokeDevServerBefore } from '../src/index.ts'

// A minimal webpack-shaped stub is enough: apply() only mutates options.entry/module.rules
// and wraps a devServer hook (which is never invoked during apply).
type StubCompiler = {
  context: string
  options: { mode: string; module: { rules: unknown[] } }
}

// Neutral context: auto-detection is intentionally not exercised here (it depends on ambient
// module resolution); these tests pin the two `annotateJsx` branches deterministically.
function neutralContext() {
  return mkdtempSync(join(tmpdir(), 'poke-plugin-'))
}

function makeCompiler(): StubCompiler {
  return {
    context: neutralContext(),
    options: {
      mode: 'development',
      // vue-cli's `js` rule shape: matches .js/.jsx, normal phase, babel-loader.
      module: { rules: [{ test: /\.jsx$/u, use: ['babel-loader'] }] },
    },
  }
}

function jsRuleSourceLoader(compiler: StubCompiler) {
  const rule = compiler.options.module.rules.find((item) => Array.isArray((item as { use?: unknown[] }).use)
    && (item as { use: unknown[] }).use.includes('babel-loader')) as { use: unknown[] } | undefined
  return rule?.use.map((loader) => basename(String(loader))) ?? []
}

describe('PokeWebpackPlugin React-gated JSX loader', () => {
  it('annotates .jsx with the React source loader when annotation is enabled (React project)', () => {
    const compiler = makeCompiler()
    new PokeWebpackPlugin({ annotateJsx: true }).apply(compiler as never)
    // Enabled -> the React `source-loader.cjs` is appended to the js/jsx rule.
    expect(jsRuleSourceLoader(compiler)).toContain('source-loader.cjs')
  })

  it('leaves .jsx untouched when annotation is disabled (Vue JSX case)', () => {
    const compiler = makeCompiler()
    new PokeWebpackPlugin({ annotateJsx: false }).apply(compiler as never)
    // Disabled -> the React transform is NOT wired, so no `react/jsx-runtime` is injected.
    expect(jsRuleSourceLoader(compiler)).toEqual(['babel-loader'])
    // ...but the framework-independent Vue SFC rule is still registered.
    const hasVueRule = compiler.options.module.rules.some((rule) => {
      const item = rule as { test?: RegExp; use?: unknown }
      return item.test instanceof RegExp && item.test.test('App.vue') && String(item.use).includes('vue-source-loader.cjs')
    })
    expect(hasVueRule).toBe(true)
  })
})

describe('pokeDevServerBefore (vue-cli host hook)', () => {
  it('registers the client bundle + agent routes on an express-like app', () => {
    const routes = new Map<string, (req: unknown, res: unknown) => void>()
    const app = { use: (path: string, mw: (req: unknown, res: unknown) => void) => { routes.set(path, mw) } }
    // vue-cli calls `before(app, server)` with the dev-server instance as `server`.
    pokeDevServerBefore()(app, { compiler: { context: neutralContext() } })

    expect([...routes.keys()]).toContain('/__poke/client.js')
    // The client route serves JS module code.
    let body = ''
    let contentType = ''
    const res = { setHeader: (k: string, v: string) => { if (k === 'Content-Type') contentType = v }, end: (b: string) => { body = b } }
    routes.get('/__poke/client.js')?.({}, res)
    expect(contentType).toContain('javascript')
    expect(body.length).toBeGreaterThan(0)
  })
})
