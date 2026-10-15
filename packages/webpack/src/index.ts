import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { createPokeMiddlewares, getPokeClientCode, normalizeProxy } from '@poke-dev/core'
import type { PokePluginOptions } from '@poke-dev/core'

export type { PokePluginOptions }

export type PokeWebpackPluginOptions = PokePluginOptions & {
  clientPath?: string
  /**
   * Force-enable/disable the React JSX source annotation.
   * Default `undefined` = auto-detect (only annotate when the host project depends on React),
   * so non-React projects that use `.jsx`/`.tsx` (Vue JSX, Solid, ...) are left untouched.
   */
  annotateJsx?: boolean
}

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

// The JSX source loader rewrites markup with the automatic JSX runtime, which emits an
// `import ... from 'react/jsx-runtime'`. That only makes sense for React apps. Detect React
// by resolving it from the build context so non-React projects that still use `.jsx`/`.tsx`
// (Vue JSX, Solid, ...) are never handed the React transform - and never broken by the
// missing `react/jsx-runtime` when React isn't a dependency.
function projectHasReact(context: string | undefined): boolean {
  const root = context || process.cwd()
  try {
    const resolveFromRoot = createRequire(join(root, 'poke-resolve-host.js'))
    resolveFromRoot.resolve('react')
    return true
  } catch {
    return false
  }
}

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

// Mount every Poke HTTP route (agent APIs + the client bundle) onto an express-like app.
// Shared by the plugin's dev-server hook and by `pokeDevServerBefore` (for hosts such as
// vue-cli that snapshot `devServer` before plugin `apply()` runs and therefore can't see the
// plugin's own `devServer.before`).
function mountPokeRoutes(app: ExpressLike, options: PokeWebpackPluginOptions, contextRoot?: string): void {
  const root = options.root || contextRoot || process.cwd()
  for (const route of createPokeMiddlewares(root, options)) {
    app.use(route.path, route.middleware as (...args: unknown[]) => unknown)
  }
  const clientMiddleware = (_req: unknown, res: { setHeader: (key: string, value: string) => void; end: (body: string) => void }) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
    res.end(getPokeClientCode({ base: '/', defaultProvider: options.agents?.defaultProvider, options, pluginProxy: normalizeProxy(options.codex?.proxy ?? options.proxy), root }))
  }
  app.use('/__poke/client.js', clientMiddleware as (...args: unknown[]) => unknown)
  if (options.clientPath && options.clientPath !== '/__poke/client.js') {
    app.use(options.clientPath, clientMiddleware as (...args: unknown[]) => unknown)
  }
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
      // React JSX annotation is opt-in by React presence (see projectHasReact), or forced via
      // `annotateJsx`. Vue SFC injection below is independent of it.
      const shouldAnnotateJsx = typeof this.options.annotateJsx === 'boolean' ? this.options.annotateJsx : projectHasReact(compiler.context)
      if (shouldAnnotateJsx) {
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
      } else {
        compiler.options.module.rules = rules
      }
      // Vue SFC injection is independent of the JSX rules above and of React: register it
      // for every build (a `\.vue`-only rule matches nothing in React-only builds).
      ensureVueSourceLoaderRule(compiler.options.module.rules)
    }

    const pluginOptions = this.options

    const registerRoutes = (app: ExpressLike | undefined, contextRoot?: string) => {
      if (!app) return
      mountPokeRoutes(app, pluginOptions, contextRoot)
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

// Host-side dev-server middleware hook for setups that don't read the plugin's own
// `devServer.before` (e.g. @vue/cli-service, which resolves `devServer` before webpack()
// runs plugin `apply()`). Wire it into `vue.config.js`:
//   devServer: { before: (app, server) => { myExistingBefore(app, server); pokeDevServerBefore()(app, server) } }
// It registers the same `/__poke/*` routes + `/__poke/client.js` the plugin would.
export function pokeDevServerBefore(options: PokeWebpackPluginOptions = {}) {
  return function (app: ExpressLike, server?: WebpackDevServerLike, compiler?: WebpackCompiler) {
    if (!app) return
    mountPokeRoutes(app, options, server?.compiler?.context || compiler?.context)
  }
}

export default PokeWebpackPlugin
