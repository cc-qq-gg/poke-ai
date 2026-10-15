// Pure, side-effect-free detection helpers shared by the installer command
// layer and its unit tests. Kept out of index.ts because that module runs the
// CLI (and calls process.exit) as soon as it is imported.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type Bundler = 'astro' | 'nextjs' | 'vite' | 'webpack'

type DependencyMap = { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }

// Membership test against a loose package.json shape so helpers stay unit-testable.
export function hasDependencyName(packageJson: DependencyMap, name: string) {
  return Boolean(packageJson.dependencies?.[name] || packageJson.devDependencies?.[name])
}

// A bundler hoisted into node_modules without being a direct dependency: a
// framework wrapper (e.g. @vue/cli-service) pulls it in transitively.
export function isPresentInNodeModules(root: string, name: string) {
  return existsSync(join(root, 'node_modules', name))
}

// Transitive bundler detection. Only consulted when direct detection found
// nothing, so a project that declares vite won't be misread because some
// unrelated package happens to hoist webpack into node_modules.
export function detectTransitiveBundler(root: string): Bundler[] {
  const found: Bundler[] = []
  if (isPresentInNodeModules(root, 'astro')) found.push('astro')
  if (isPresentInNodeModules(root, 'next')) found.push('nextjs')
  if (isPresentInNodeModules(root, 'vite')) found.push('vite')
  if (isPresentInNodeModules(root, 'webpack') || isPresentInNodeModules(root, 'webpack-dev-server')) found.push('webpack')

  return found
}

// Vue CLI wraps webpack behind vue.config.js (configureWebpack / chainWebpack),
// which is not a webpack config root, so Poke cannot safely rewrite it.
export function isVueCliProject(root: string, packageJson: DependencyMap) {
  return existsSync(join(root, 'vue.config.js')) || hasDependencyName(packageJson, '@vue/cli-service')
}
