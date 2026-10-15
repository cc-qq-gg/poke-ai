import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectTransitiveBundler, isVueCliProject } from '../src/detect.js'

// A root with an (empty) node_modules directory so we control exactly which
// packages appear to be hoisted there.
let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'poke-detect-'))
  mkdirSync(join(root, 'node_modules'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { force: true, recursive: true })
})

function touchPackage(name: string) {
  const dir = join(root, 'node_modules', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
}

describe('detectTransitiveBundler', () => {
  it('returns nothing for an empty node_modules', () => {
    expect(detectTransitiveBundler(root)).toEqual([])
  })

  it('detects webpack from a hoisted webpack dependency', () => {
    touchPackage('webpack')
    expect(detectTransitiveBundler(root)).toEqual(['webpack'])
  })

  it('detects webpack from webpack-dev-server alone', () => {
    touchPackage('webpack-dev-server')
    expect(detectTransitiveBundler(root)).toEqual(['webpack'])
  })

  it('detects vite when hoisted', () => {
    touchPackage('vite')
    expect(detectTransitiveBundler(root)).toEqual(['vite'])
  })

  it('reports multiple bundlers when both vite and webpack are hoisted', () => {
    touchPackage('vite')
    touchPackage('webpack')
    expect(detectTransitiveBundler(root)).toEqual(['vite', 'webpack'])
  })
})

describe('isVueCliProject', () => {
  it('is true when vue.config.js exists', () => {
    writeFileSync(join(root, 'vue.config.js'), 'module.exports = {}\n')
    expect(isVueCliProject(root, {})).toBe(true)
  })

  it('is true when @vue/cli-service is a dev dependency', () => {
    expect(isVueCliProject(root, { devDependencies: { '@vue/cli-service': '^3.12.1' } })).toBe(true)
  })

  it('is false for a plain webpack project', () => {
    expect(isVueCliProject(root, { devDependencies: { webpack: '^4.0.0' } })).toBe(false)
  })
})
