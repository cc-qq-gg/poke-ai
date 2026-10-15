import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assessCompatibility, evaluateDependency, parseRangeMajors } from '../src/version.js'

// A root with no node_modules/<dep> so evaluateDependency falls back to the
// declared range in package.json (deterministic, no install needed).
let emptyRoot = ''
// A root with node_modules/<dep>/package.json so the installed version wins.
let installedRoot = ''

beforeEach(() => {
  emptyRoot = mkdtempSync(join(tmpdir(), 'poke-empty-'))
  installedRoot = mkdtempSync(join(tmpdir(), 'poke-installed-'))
})

afterEach(() => {
  rmSync(emptyRoot, { force: true, recursive: true })
  rmSync(installedRoot, { force: true, recursive: true })
})

function writeInstalled(root: string, name: string, version: string) {
  const dir = join(root, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version }))
}

function pkg(dep: string, range?: string) {
  return range ? { devDependencies: { [dep]: range } } : {}
}

describe('parseRangeMajors', () => {
  it('reads one major per || alternative, first integer each', () => {
    expect(parseRangeMajors('^4.5.0')).toEqual([4])
    expect(parseRangeMajors('~3.0.1')).toEqual([3])
    expect(parseRangeMajors('>=4 <5')).toEqual([4])
    expect(parseRangeMajors('^3 || ^5')).toEqual([3, 5])
    expect(parseRangeMajors('4.5.5')).toEqual([4])
  })

  it('ignores prerelease tails and non-numeric ranges', () => {
    expect(parseRangeMajors('^8.0.0-beta.1')).toEqual([8])
    expect(parseRangeMajors('npm:vite@^4')).toEqual([4])
    expect(parseRangeMajors('latest')).toEqual([])
    expect(parseRangeMajors('workspace:*')).toEqual([])
  })
})

describe('evaluateDependency — declared range (no install)', () => {
  it('flags vite below the floor as unsupported', () => {
    expect(evaluateDependency(emptyRoot, pkg('vite', '^3.0.0'), 'vite').status).toBe('unsupported')
  })

  it('accepts vite 4 and warns on versions beyond the tested max', () => {
    expect(evaluateDependency(emptyRoot, pkg('vite', '^4.5.0'), 'vite').status).toBe('ok')
    expect(evaluateDependency(emptyRoot, pkg('vite', '^9.0.0'), 'vite').status).toBe('untested')
  })

  it('treats an unparseable range as unknown rather than blocking', () => {
    expect(evaluateDependency(emptyRoot, pkg('vite', 'latest'), 'vite').status).toBe('unknown')
  })

  it('allows a mixed range if any alternative can satisfy the floor', () => {
    expect(evaluateDependency(emptyRoot, pkg('webpack', '^3 || ^5'), 'webpack').status).toBe('ok')
  })

  it('reports absent when the dependency is nowhere to be found', () => {
    expect(evaluateDependency(emptyRoot, pkg('webpack-dev-server'), 'webpack-dev-server').status).toBe('absent')
  })

  it('gates webpack-dev-server with its own floor of 3', () => {
    expect(evaluateDependency(emptyRoot, pkg('webpack-dev-server', '^2.0.0'), 'webpack-dev-server').status).toBe('unsupported')
    expect(evaluateDependency(emptyRoot, pkg('webpack-dev-server', '^3.11.3'), 'webpack-dev-server').status).toBe('ok')
  })

  it('prefers the installed version over a permissive declared range', () => {
    writeInstalled(installedRoot, 'vite', '3.2.1')
    const report = evaluateDependency(installedRoot, pkg('vite', '^4.0.0'), 'vite')
    expect(report.status).toBe('unsupported')
    expect(report.source).toBe('node_modules')
    expect(report.detail).toBe('installed 3.2.1')
  })
})

describe('assessCompatibility', () => {
  it('blocks on an unsupported vite and lists no notices when clean', () => {
    const { blocking } = assessCompatibility(emptyRoot, pkg('vite', '^3.0.0'), 'vite')
    expect(blocking.map((report) => report.name)).toEqual(['vite'])
  })

  it('warns (not blocks) when the version cannot be determined for a required bundler', () => {
    const { blocking, notices } = assessCompatibility(emptyRoot, pkg('vite', 'latest'), 'vite')
    expect(blocking).toHaveLength(0)
    expect(notices.map((report) => report.name)).toEqual(['vite'])
  })

  it('ignores an absent webpack-dev-server but blocks when it is present and old', () => {
    const clean = assessCompatibility(emptyRoot, { devDependencies: { webpack: '^4.0.0' } }, 'webpack')
    expect(clean.blocking).toHaveLength(0)

    const stale = assessCompatibility(emptyRoot, { devDependencies: { webpack: '^5.0.0', 'webpack-dev-server': '^2.0.0' } }, 'webpack')
    expect(stale.blocking.map((report) => report.name)).toEqual(['webpack-dev-server'])
  })

  it('does not gate astro or nextjs', () => {
    expect(assessCompatibility(emptyRoot, pkg('vite', '^3.0.0'), 'astro').blocking).toHaveLength(0)
    expect(assessCompatibility(emptyRoot, {}, 'nextjs').blocking).toHaveLength(0)
  })
})
