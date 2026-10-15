import { describe, expect, it } from 'vitest'
import { patchArrayProperty, patchPlugins } from '../src/installer.js'

describe('patchPlugins — targets the config root, never a nested array', () => {
  it('inserts into webpack top-level plugins, skipping postcss-loader plugins inside module.rules', () => {
    const code = [
      "const { PokeWebpackPlugin } = require('@poke-dev/webpack')",
      '',
      'module.exports = {',
      '  module: {',
      '    rules: [',
      '      {',
      "        test: /\\.css$/,",
      "        use: [{ loader: 'postcss-loader', options: { plugins: ['postcss-import'] } }],",
      '      },',
      '    ],',
      '  },',
      '  plugins: [existingPlugin()],',
      '}',
      '',
    ].join('\n')

    const patched = patchPlugins(code, 'new PokeWebpackPlugin()')

    expect(patched).not.toBeNull()
    // postcss array must stay untouched (the bug inserted the plugin here).
    expect(patched).toContain("plugins: ['postcss-import']")
    // the plugin lands in the top-level array instead.
    expect(patched).toContain('plugins: [existingPlugin(), new PokeWebpackPlugin()]')
    expect(patched?.match(/new PokeWebpackPlugin\(\)/g)).toHaveLength(1)
  })

  it('inserts into vite defineConfig root plugins at the start, skipping css.postcss.plugins', () => {
    const code = [
      "import { defineConfig } from 'vite'",
      '',
      'export default defineConfig({',
      '  css: { postcss: { plugins: [autoprefixer()] } },',
      '  plugins: [react()],',
      '})',
      '',
    ].join('\n')

    const patched = patchPlugins(code, 'poke()', 'start')

    expect(patched).not.toBeNull()
    expect(patched).toContain('plugins: [autoprefixer()]')
    expect(patched).toContain('plugins: [poke(), react()]')
  })

  it('handles export default object literal without defineConfig', () => {
    const code = ['export default {', '  plugins: [react()],', '  css: { postcss: { plugins: [] } },', '}', ''].join('\n')

    const patched = patchPlugins(code, 'poke()', 'start')

    expect(patched).toContain('plugins: [poke(), react()]')
  })
})

describe('patchPlugins — creates a plugins array when the root lacks one', () => {
  it('adds plugins to a vite root object that has none', () => {
    const code = [
      'export default defineConfig({',
      '  resolve: { alias: {} },',
      '})',
      '',
    ].join('\n')

    const patched = patchPlugins(code, 'poke()', 'start')

    expect(patched).not.toBeNull()
    expect(patched).toContain('plugins: [poke()]')
    expect(patched).toContain('resolve: { alias: {} }')
  })

  it('adds plugins to a webpack root object that has none', () => {
    const code = ['module.exports = {', "  mode: 'development',", '}', ''].join('\n')

    const patched = patchPlugins(code, 'new PokeWebpackPlugin()')

    expect(patched).toContain('plugins: [new PokeWebpackPlugin()]')
    expect(patched).toContain("mode: 'development'")
  })
})

describe('patchPlugins — function and array config exports', () => {
  it('inserts into an arrow function returning a parenthesized object', () => {
    const code = [
      'module.exports = (env, argv) => ({',
      "  mode: 'development',",
      '  plugins: [new webpack.DefinePlugin()],',
      '})',
      '',
    ].join('\n')

    const patched = patchPlugins(code, 'new PokeWebpackPlugin()')

    expect(patched).toContain('new webpack.DefinePlugin(), new PokeWebpackPlugin()')
  })

  it('inserts into a function that assigns the config to a local const and returns it', () => {
    const code = [
      'module.exports = (env) => {',
      '  const config = {',
      '    module: { rules: [] },',
      '    plugins: [basePlugin()],',
      '  }',
      '  return config',
      '}',
      '',
    ].join('\n')

    const patched = patchPlugins(code, 'new PokeWebpackPlugin()')

    expect(patched).toContain('plugins: [basePlugin(), new PokeWebpackPlugin()]')
  })

  it('inserts into the first config object of a webpack multi-config array', () => {
    const code = [
      'module.exports = [',
      '  { name: \'client\', plugins: [clientPlugin()] },',
      '  { name: \'server\', plugins: [serverPlugin()] },',
      ']',
      '',
    ].join('\n')

    const patched = patchPlugins(code, 'new PokeWebpackPlugin()')

    expect(patched).toContain("name: 'client', plugins: [clientPlugin(), new PokeWebpackPlugin()]")
    expect(patched).toContain("name: 'server', plugins: [serverPlugin()]")
  })
})

describe('patchArrayProperty — generic property name', () => {
  it('patches astro integrations without confusing a nested plugins array', () => {
    const code = [
      'export default defineConfig({',
      '  vite: { plugins: [nested()] },',
      '  integrations: [react()],',
      '})',
      '',
    ].join('\n')

    const patched = patchArrayProperty(code, 'integrations', 'poke()')

    expect(patched).toContain('vite: { plugins: [nested()] }')
    expect(patched).toContain('integrations: [react(), poke()]')
  })

  it('returns null when no config root can be understood', () => {
    expect(patchPlugins('const x = 1', 'poke()')).toBeNull()
  })
})
