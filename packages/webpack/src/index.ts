import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createPokeMiddlewares, getPokeClientCode, normalizeProxy } from '@poke-dev/core'
import type { PokePluginOptions } from '@poke-dev/core'

export type { PokePluginOptions }

export type PokeWebpackPluginOptions = PokePluginOptions & { clientPath?: string }

type WebpackCompiler = {
  context?: string
  options?: {
    devServer?: {
      setupMiddlewares?: (middlewares: unknown[], devServer: WebpackDevServerLike) => unknown[]
      before?: (app: ExpressLike, server: unknown, compiler: WebpackCompiler) => void
    }
    entry?: unknown
    mode?: string
    module?: { rules?: unknown[] }
  }
  // webpack 5 exposes the `webpack` namespace on the compiler; webpack 4 does not.
  webpack?: { version?: string }
}

type WebpackDevServerLike = {
  app?: ExpressLike
  compiler?: { context?: string }
}

type ExpressLike = { use: (path: string, middleware: (...args: unknown[]) => unknown) => void }

const packageDirectory = __dirname

function getBundledAssetPath(fileName: string) {
  const sourcePath = join(packageDirectory, '..', 'src', fileName)
  return existsSync(sourcePath) ? sourcePath : join(packageDirectory, fileName)
}

const clientEntryPath = getBundledAssetPath('client-entry.js')
const sourceLoaderPath = getBundledAssetPath('source-loader.cjs')
const vueSourceLoaderPath = getBundledAssetPath('vue-source-loader.cjs')

function hasEntryValue(entry: unknown, value: string): boolean {
  if (entry === value) return true
  if (Array.isArray(entry)) return entry.some((item) => hasEntryValue(item, value))
  if (entry && typeof entry === 'object') return Object.values(entry).some((item) => hasEntryValue(item, value))
  return false
}

function prependEntry(entry: unknown, value: string): unknown {
  if (hasEntryValue(entry, value)) return entry
  if (!entry) return [value, './src']
  if (typeof entry === 'string') return [value, entry]
  if (Array.isArray(entry)) return [value, ...entry]
  if (typeof entry === 'function') {
    return async () => prependEntry(await entry(), value)
  }
  if (entry && typeof entry === 'object') {
    if ('import' in entry) {
      return { ...entry, import: prependEntry(entry.import, value) }
    }

    return Object.fromEntries(Object.entries(entry).map(([key, childEntry]) => [key, prependEntry(childEntry, value)]))
  }

  return entry
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function testMatchesExtension(test: unknown, extension: string) {
  if (!(test instanceof RegExp)) {
    return false
  }

  test.lastIndex = 0
  return test.test(`poke-entry${extension}`)
}

function isJsTsRule(rule: Record<string, unknown>) {
  return ['.tsx', '.jsx', '.ts', '.js'].some((extension) => testMatchesExtension(rule.test, extension))
}

function hasSourceLoader(use: unknown): boolean {
  if (use === sourceLoaderPath) {
    return true
  }

  if (Array.isArray(use)) {
    return use.some(hasSourceLoader)
  }

  return Boolean(isPlainObject(use) && use.loader === sourceLoaderPath)
}

function appendSourceLoader(use: unknown) {
  return hasSourceLoader(use) ? use : [...(Array.isArray(use) ? use : [use]), sourceLoaderPath]
}

function injectSourceLoaderIntoRules(rules: unknown[]): boolean {
  let didInject = false

  for (const rule of rules) {
    if (!isPlainObject(rule)) {
      continue
    }

    if (Array.isArray(rule.oneOf) && injectSourceLoaderIntoRules(rule.oneOf)) {
      didInject = true
    }

    if (Array.isArray(rule.rules) && injectSourceLoaderIntoRules(rule.rules)) {
      didInject = true
    }

    if (!isJsTsRule(rule) || rule.enforce) {
      continue
    }

    if ('use' in rule) {
      rule.use = appendSourceLoader(rule.use)
      didInject = true
      continue
    }

    if (typeof rule.loader === 'string') {
      const { loader, options } = rule
      delete rule.loader
      delete rule.options
      rule.use = appendSourceLoader(options === undefined ? loader : { loader, options })
      didInject = true
    }
  }

  return didInject
}

function ruleUsesVueSourceLoader(rule: unknown): boolean {
  if (!isPlainObject(rule)) {
    return false
  }

  if (rule.loader === vueSourceLoaderPath) {
    return true
  }

  if (rule.use === vueSourceLoaderPath) {
    return true
  }

  if (Array.isArray(rule.use)) {
    return rule.use.some((item) => item === vueSourceLoaderPath || (isPlainObject(item) && item.loader === vueSourceLoaderPath))
  }

  return false
}

// R7: legacy Vue2 / any webpack + vue-loader project. vue-loader builds its descriptor
// from the source of the plain `.vue` request (its block-splitting pitcher only matches
// `?vue&type=` sub-requests), so an `enforce: 'pre'` loader on the main request runs first
// and the injected template attributes propagate into the compiled render function.
function ensureVueSourceLoaderRule(rules: unknown[]): void {
  if (rules.some(ruleUsesVueSourceLoader)) {
    return
  }

  rules.unshift({
    enforce: 'pre',
    exclude: /node_modules/u,
    test: /\.vue$/u,
    use: vueSourceLoaderPath,
  })
}

export class PokeWebpackPlugin {
  readonly name = 'poke:webpack'
  constructor(private readonly options: PokeWebpackPluginOptions = {}) {}

  apply(compiler: WebpackCompiler) {
    if (!compiler.options) compiler.options = {}
    if (!compiler.options.devServer) compiler.options.devServer = {}
    if (compiler.options.mode !== 'production') {
      compiler.options.entry = prependEntry(compiler.options.entry, clientEntryPath)
      if (!compiler.options.module) compiler.options.module = {}
      const rules = compiler.options.module.rules || []
      const didInject = injectSourceLoaderIntoRules(rules)
      compiler.options.module.rules = didInject
        ? rules
        : [
            {
              enforce: 'pre',
              exclude: /node_modules/u,
              test: /\.[jt]sx$/u,
              use: sourceLoaderPath,
            },
            ...rules,
          ]
      // Vue SFC injection is independent of the JSX rules above: a `\.vue`-only rule
      // matches nothing in React-only builds, so it is safe to always register it.
      ensureVueSourceLoaderRule(compiler.options.module.rules)
    }

    const pluginOptions = this.options

    const registerRoutes = (app: ExpressLike | undefined, contextRoot?: string) => {
      if (!app) return
      const root = pluginOptions.root || contextRoot || process.cwd()
      for (const route of createPokeMiddlewares(root, pluginOptions)) {
        app.use(route.path, route.middleware as (...args: unknown[]) => unknown)
      }
      const clientMiddleware = (_req: unknown, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.end(getPokeClientCode({ base: '/', defaultProvider: pluginOptions.agents?.defaultProvider, options: pluginOptions, pluginProxy: normalizeProxy(pluginOptions.codex?.proxy ?? pluginOptions.proxy), root }))
      }
      app.use('/__poke/client.js', clientMiddleware as (...args: unknown[]) => unknown)
      if (pluginOptions.clientPath && pluginOptions.clientPath !== '/__poke/client.js') {
        app.use(pluginOptions.clientPath, clientMiddleware as (...args: unknown[]) => unknown)
      }
    }

    // webpack 5 implies webpack-dev-server 4/5 (setupMiddlewares); webpack 4 implies
    // dev-server 3, whose middleware hook is `before(app, server, compiler)`. Prefer the
    // compiler's own signal and fall back to the presence of the webpack 5 namespace.
    const isWebpackFive = Boolean(compiler.webpack)

    if (isWebpackFive) {
      const devServer = compiler.options.devServer
      if (!devServer.setupMiddlewares) devServer.setupMiddlewares = (middlewares: unknown[]) => middlewares
      const previousSetupMiddlewares = devServer.setupMiddlewares
      devServer.setupMiddlewares = (middlewares: unknown[], server: WebpackDevServerLike) => {
        registerRoutes(server?.app, server?.compiler?.context)
        return previousSetupMiddlewares(middlewares, server)
      }
    } else {
      const devServer = compiler.options.devServer
      const previousBefore = devServer.before
      devServer.before = (app: ExpressLike, server: unknown, ownCompiler: WebpackCompiler) => {
        registerRoutes(app, ownCompiler?.context)
        if (previousBefore) previousBefore(app, server, ownCompiler)
      }
    }
  }
}

export function poke(options: PokeWebpackPluginOptions = {}) {
  return new PokeWebpackPlugin(options)
}

export default PokeWebpackPlugin
