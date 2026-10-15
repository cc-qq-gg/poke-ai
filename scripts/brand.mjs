#!/usr/bin/env node
// 品牌改名 codemod：brand.config.json 是唯一品牌源。
// 用法：
//   pnpm brand:apply          按配置从 from 改写到 to（首次分叉改名）
//   pnpm brand:apply --check  只检查是否还残留 from 痕迹（不写文件）
// 发布前换名：改 brand.config.json 的 from/to（from 填上一次的名字），再跑 brand:apply。
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const checkOnly = process.argv.includes('--check')

// `docs` is skipped on purpose: the design docs deliberately quote the
// historical tokens (the from->to mapping table, the before/after bug sample),
// so a rebrand must neither rewrite that prose nor be flagged by --check for it.
// `.poke` is the tool's own runtime output (agent session logs / run json), which
// embeds arbitrary user file paths; those can incidentally contain the old kebab
// token, so generated runtime dirs are excluded just like the build dirs above.
// `.pnpm-store` is a local package cache (like `node_modules`), never source.
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.pnpm-store', 'dist', '.astro', '.next', '.svelte-kit', '.poke', 'coverage', 'docs'])
// `.git` is listed here too: inside a worktree it is a *file* (a gitdir pointer),
// so the directory guard above does not catch it and rewriting it would corrupt it.
const SKIPPED_FILES = new Set(['pnpm-lock.yaml', 'brand.config.json', '.git'])
// The root `README.md` documents this fork's upstream origin (the old brand name
// and the from->to mapping), like the `docs/` prose, so it is exempt by path.
const SKIPPED_PATHS = new Set(['README.md'])

function walk(directory) {
  const entries = readdirSync(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...walk(join(directory, entry.name)))
      continue
    }
    if (!SKIPPED_FILES.has(entry.name) && !entry.name.endsWith('.lockb') && entry.name !== '.git') files.push(join(directory, entry.name))
  }
  return files
}

function isTextFile(fileName) {
  if (/\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|eot|zip|gz)$/iu.test(fileName)) return false
  const buffer = readFileSync(fileName)
  return !(buffer.includes(0) && buffer.length > 0)
}

// 替换顺序很重要：先长 token / 带修饰 token，最后裸 kebab，避免 @poke-dev 被拆成 @poke。
const ORDER = ['scope', 'upper', 'pascal', 'camel', 'titleSpaced', 'kebab']

const config = JSON.parse(readFileSync(join(root, 'brand.config.json'), 'utf-8'))
const pairs = ORDER.filter((key) => config.from[key] && config.to[key] && config.from[key] !== config.to[key]).map((key) => [config.from[key], config.to[key]])

let changedFiles = 0
for (const fileName of walk(root)) {
  if (SKIPPED_PATHS.has(relative(root, fileName))) continue
  if (!isTextFile(fileName)) continue
  const source = readFileSync(fileName, 'utf-8')
  let text = source
  for (const [from, to] of pairs) {
    text = text.split(from).join(to)
  }

  if (text !== source) {
    changedFiles += 1
    if (checkOnly) {
      console.log(`would rewrite: ${relative(root, fileName)}`)
    } else {
      writeFileSync(fileName, text)
    }
  }
}

function walkAll(directory) {
  const paths = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue
      paths.push(target, ...walkAll(target))
      continue
    }
    paths.push(target)
  }
  return paths
}

// 文件名/目录名改名（如 packages/core/src/client/poke-dom.js、examples/poke-panel-react）。
// 自底向上重命名，父目录改名不影响尚未处理子项的绝对路径。
const kebabFrom = config.from.kebab
if (!checkOnly && kebabFrom && kebabFrom !== config.to.kebab) {
  const targets = walkAll(root).filter((target) => target.split('/').at(-1).includes(kebabFrom))
  targets.sort((left, right) => right.split('/').length - left.split('/').length)
  for (const target of targets) {
    if (!existsSync(target)) continue
    const name = target.split('/').at(-1)
    const nextName = name.split(kebabFrom).join(config.to.kebab)
    renameSync(target, join(dirname(target), nextName))
    console.log(`renamed: ${relative(root, target)} -> ${nextName}`)
  }
}

console.log(checkOnly ? `brand:check found ${changedFiles} file(s) still carrying old brand tokens` : `brand:apply rewrote ${changedFiles} file(s)`)
if (checkOnly && changedFiles > 0) process.exit(1)
