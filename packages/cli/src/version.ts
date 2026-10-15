// Version detection + compatibility gate for the installer.
// Pure and side-effect free (only reads files) so it can be unit tested without
// running the CLI. The command layer in index.ts decides how to react (block / warn).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type DependencyCheck = 'vite' | 'webpack' | 'webpack-dev-server'
export type VersionStatus = 'ok' | 'unsupported' | 'untested' | 'unknown' | 'absent'
export type VersionSource = 'node_modules' | 'package.json' | 'none'

export interface VersionReport {
  name: DependencyCheck
  label: string
  status: VersionStatus
  floor: number
  testedMax: number
  major: number | null
  detail: string
  source: VersionSource
}

type DependencySpec = { floor: number; label: string; testedMax: number }

// Minimum we support and the newest major we actually exercised in this fork.
// Floors match the compatibility work in Loops 5/6 (webpack4/ds3, vite4).
export const SUPPORTED: Record<DependencyCheck, DependencySpec> = {
  vite: { label: 'Vite', floor: 4, testedMax: 8 },
  webpack: { label: 'Webpack', floor: 4, testedMax: 5 },
  'webpack-dev-server': { label: 'Webpack Dev Server', floor: 3, testedMax: 5 },
}

type PackageJsonLike = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

// Which dependencies to verify per bundler. `required:false` means "only check
// if the project actually has it" (e.g. dev-server), so absence is not an error.
export function checksForBundler(bundler: string): Array<{ name: DependencyCheck; required: boolean }> {
  if (bundler === 'vite') return [{ name: 'vite', required: true }]
  if (bundler === 'webpack') {
    return [
      { name: 'webpack', required: true },
      { name: 'webpack-dev-server', required: false },
    ]
  }

  return []
}

// Read the leading major from an installed package.json under root/node_modules
// (pnpm/yarn/npm all expose the resolved package there, symlink included).
export function installedMajor(root: string, name: DependencyCheck): { major: number; version: string } | null {
  const manifestPath = join(root, 'node_modules', name, 'package.json')
  if (!existsSync(manifestPath)) return null
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { version?: string }
    if (typeof manifest.version !== 'string') return null
    const match = manifest.version.match(/^(\d+)/u)
    if (!match) return null

    return { major: Number(match[1]), version: manifest.version }
  } catch {
    return null
  }
}

export function declaredRange(packageJson: PackageJsonLike, name: DependencyCheck): string | undefined {
  return packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name]
}

// Extract one major per `||` alternative (the first integer in that alternative).
// Taking the first integer per alternative is robust against prerelease tails
// (e.g. "3.0.0-beta.4" -> 3, not 4). We then treat the *highest* alternative as
// the best case: block only when no alternative can reach the supported floor.
export function parseRangeMajors(range: string): number[] {
  const majors: number[] = []
  for (const alternative of range.split('||')) {
    const match = alternative.match(/\d+/u)
    if (match) majors.push(Number(match[0]))
  }

  return majors
}

export function evaluateDependency(root: string, packageJson: PackageJsonLike, name: DependencyCheck): VersionReport {
  const spec = SUPPORTED[name]
  const base = { name, label: spec.label, floor: spec.floor, testedMax: spec.testedMax }

  const installed = installedMajor(root, name)
  if (installed) {
    const status = installed.major < spec.floor ? 'unsupported' : installed.major > spec.testedMax ? 'untested' : 'ok'

    return { ...base, status, major: installed.major, detail: `installed ${installed.version}`, source: 'node_modules' }
  }

  const range = declaredRange(packageJson, name)
  if (range !== undefined) {
    const majors = parseRangeMajors(range)
    if (majors.length === 0) {
      return { ...base, status: 'unknown', major: null, detail: `range "${range}"`, source: 'package.json' }
    }

    const best = Math.max(...majors)
    const status = best < spec.floor ? 'unsupported' : best > spec.testedMax ? 'untested' : 'ok'

    return { ...base, status, major: best, detail: `range "${range}"`, source: 'package.json' }
  }

  return { ...base, status: 'absent', major: null, detail: 'not found', source: 'none' }
}

export type CompatibilityResult = { blocking: VersionReport[]; notices: VersionReport[] }

export function assessCompatibility(root: string, packageJson: PackageJsonLike, bundler: string): CompatibilityResult {
  const blocking: VersionReport[] = []
  const notices: VersionReport[] = []

  for (const check of checksForBundler(bundler)) {
    const report = evaluateDependency(root, packageJson, check.name)
    if (report.status === 'unsupported') {
      blocking.push(report)
      continue
    }
    // A required bundler we detected but cannot pin a version for -> warn, don't block.
    if (report.status === 'untested' || (report.status === 'unknown' && check.required)) {
      notices.push(report)
    }
  }

  return { blocking, notices }
}

export function formatBlockingMessage(report: VersionReport): string {
  const tested = `supports ${report.label} ${report.floor}+ (tested up to ${report.testedMax})`

  return `detected ${report.label} — ${report.detail} — but Poke only ${tested}.`
}

export function formatNoticeMessage(report: VersionReport): string {
  if (report.status === 'untested') {
    return `${report.label} ${report.major ?? ''} is newer than the version Poke has been tested against (${report.testedMax}); it should work, but this combination is unverified.`
  }

  return `could not determine the ${report.label} version (${report.detail}); proceeding without a version check.`
}
