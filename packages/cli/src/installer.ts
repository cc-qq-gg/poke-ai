/**
 * Structure-aware bundler-config patcher.
 *
 * The old installer located the target array with a naive `\bplugins:\s*\[`
 * regex and always wrote to the *first* hit anywhere in the file. Real configs
 * nest other arrays named `plugins` (postcss-loader options, inline postcss,
 * `module.rules` loaders, ...), so the plugin could land inside postcss
 * instead of the bundler's top-level plugins array.
 *
 * These helpers only touch a `plugins` (or `integrations`) property that is a
 * *direct* child of the configuration root object — never a nested one — and
 * understand the wrapper shapes configs actually use:
 *   - `defineConfig({ ... })` / `export default defineConfig({ ... })`
 *   - `export default { ... }`
 *   - `module.exports = { ... }`
 *   - `module.exports = [ {...}, {...} ]` (multi-config)
 *   - `module.exports = (env) => ({ ... })` / `(env) => { return {...} }`
 *   - `module.exports = (env) => { const cfg = {...}; return cfg }`
 */

export type BracketPair = readonly ['(' , ')'] | readonly ['[', ']'] | readonly ['{', '}']

type ArrayValueSpan = { kind: 'array'; open: number; close: number }
type NonArrayValueSpan = { kind: 'non-array' }
type DirectPropertySpan = ArrayValueSpan | NonArrayValueSpan

const IDENT_START = /[A-Za-z_$]/u
const IDENT_PART = /[A-Za-z0-9_$]/u
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v'])

/**
 * Marks every character that lives inside a string literal or comment as
 * insignificant, so bracket counting and keyword scans ignore fake brackets.
 */
function buildMask(code: string): boolean[] {
  const mask = new Array<boolean>(code.length).fill(true)
  let index = 0

  while (index < code.length) {
    const char = code[index]
    const next = code[index + 1]

    if (char === '/' && next === '/') {
      let cursor = index
      while (cursor < code.length && code[cursor] !== '\n') {
        mask[cursor] = false
        cursor += 1
      }
      index = cursor
      continue
    }

    if (char === '/' && next === '*') {
      let cursor = index
      while (cursor < code.length && !(code[cursor] === '*' && code[cursor + 1] === '/')) {
        mask[cursor] = false
        cursor += 1
      }
      mask[cursor] = false
      mask[cursor + 1] = false
      index = cursor + 2
      continue
    }

    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      let cursor = index
      let escaped = false
      mask[cursor] = false
      cursor += 1
      while (cursor < code.length) {
        if (escaped) {
          escaped = false
          mask[cursor] = false
          cursor += 1
          continue
        }
        if (code[cursor] === '\\') {
          escaped = true
          mask[cursor] = false
          cursor += 1
          continue
        }
        mask[cursor] = false
        if (code[cursor] === quote) {
          cursor += 1
          break
        }
        cursor += 1
      }
      index = cursor
      continue
    }

    index += 1
  }

  return mask
}

/** Advances past whitespace and comments without relying on the mask. */
function skipTrivia(code: string, index: number): number {
  let cursor = index
  while (cursor < code.length) {
    const char = code[cursor]
    if (WHITESPACE.has(char)) {
      cursor += 1
      continue
    }
    if (char === '/' && code[cursor + 1] === '/') {
      while (cursor < code.length && code[cursor] !== '\n') cursor += 1
      continue
    }
    if (char === '/' && code[cursor + 1] === '*') {
      cursor += 2
      while (cursor < code.length && !(code[cursor] === '*' && code[cursor + 1] === '/')) cursor += 1
      cursor += 2
      continue
    }
    break
  }
  return cursor
}

/** Returns the index of the bracket that closes the one at `openIndex`. */
export function findMatchingBracket(code: string, openIndex: number, openChar: string, closeChar: string): number {
  const mask = buildMask(code)
  return matchBracket(code, mask, openIndex, openChar, closeChar)
}

function matchBracket(code: string, mask: boolean[], openIndex: number, openChar: string, closeChar: string): number {
  let depth = 0
  for (let index = openIndex; index < code.length; index += 1) {
    if (!mask[index]) continue
    const char = code[index]
    if (char === openChar) {
      depth += 1
    } else if (char === closeChar) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function isWordStart(code: string, index: number) {
  return index === 0 || !IDENT_PART.test(code[index - 1] ?? '')
}

function getLineIndent(code: string, index: number): string {
  const lineStart = code.lastIndexOf('\n', index) + 1
  const match = code.slice(lineStart, index).match(/^\s*/u)
  return match?.[0] ?? ''
}

/**
 * Collects the opening `{` index of every candidate configuration root object,
 * in source order, ignoring anything nested that could masquerade as `plugins`.
 */
export function collectRootObjectOpens(code: string): number[] {
  const mask = buildMask(code)
  const opens = new Set<number>()

  for (const match of matchesAll(code, /\bdefineConfig\s*\(/gu)) {
    for (const open of objectsFromValue(code, mask, match.end)) opens.add(open)
  }

  for (const match of matchesAll(code, /export\s+default\s+/gu)) {
    const index = skipTrivia(code, match.end)
    if (mask[index] && code[index] === '{') opens.add(index)
  }

  for (const match of matchesAll(code, /module\.exports\s*=\s*/gu)) {
    for (const open of objectsFromValue(code, mask, match.end)) opens.add(open)
  }

  return [...opens].sort((left, right) => left - right)
}

function* matchesAll(code: string, regex: RegExp): Generator<{ index: number; end: number }> {
  let match: RegExpExecArray | null
  const scanner = new RegExp(regex.source, regex.flags)
  while ((match = scanner.exec(code)) !== null) {
    yield { index: match.index, end: match.index + match[0].length }
    if (match[0].length === 0) scanner.lastIndex += 1
  }
}

/**
 * Given the start of a config *value expression*, returns the root object
 * literals it can resolve to — unwrapping parens, arrays, arrows and functions.
 */
function objectsFromValue(code: string, mask: boolean[], rawIndex: number): number[] {
  const index = skipTrivia(code, rawIndex)
  if (index >= code.length || !mask[index]) return []
  const char = code[index]

  if (char === '{') {
    return [index]
  }

  if (char === '[') {
    const arrayClose = matchBracket(code, mask, index, '[', ']')
    if (arrayClose === -1) return []
    const results: number[] = []
    let cursor = index + 1
    let depth = 1
    while (cursor < arrayClose) {
      if (!mask[cursor]) {
        cursor += 1
        continue
      }
      const element = code[cursor]
      if (element === '{') {
        if (depth === 1) results.push(cursor)
        const close = matchBracket(code, mask, cursor, '{', '}')
        if (close === -1) break
        cursor = close + 1
        continue
      }
      if (element === '[') {
        const close = matchBracket(code, mask, cursor, '[', ']')
        if (close === -1) break
        cursor = close + 1
        continue
      }
      if (element === '(') {
        const close = matchBracket(code, mask, cursor, '(', ')')
        if (close === -1) break
        if (depth === 1) results.push(...objectsFromValue(code, mask, cursor + 1))
        cursor = close + 1
        continue
      }
      cursor += 1
    }
    return results
  }

  if (char === '(') {
    const close = matchBracket(code, mask, index, '(', ')')
    if (close === -1) return []
    const after = skipTrivia(code, close + 1)
    if (code[after] === '=' && code[after + 1] === '>') {
      return objectsFromArrowBody(code, mask, after + 2)
    }
    return objectsFromValue(code, mask, index + 1)
  }

  if (code.startsWith('function', index) && isWordStart(code, index)) {
    return functionBodyObjects(code, mask, index)
  }

  if (IDENT_START.test(char)) {
    let cursor = index
    while (cursor < code.length && IDENT_PART.test(code[cursor])) cursor += 1
    const after = skipTrivia(code, cursor)
    if (code[after] === '=' && code[after + 1] === '>') {
      return objectsFromArrowBody(code, mask, after + 2)
    }
    if (code[after] === '(') {
      const close = matchBracket(code, mask, after, '(', ')')
      if (close !== -1) return objectsFromValue(code, mask, after + 1)
    }
  }

  return []
}

function objectsFromArrowBody(code: string, mask: boolean[], rawIndex: number): number[] {
  const index = skipTrivia(code, rawIndex)
  if (index >= code.length || !mask[index]) return []
  // A bare `{` after `=>` is a block body (object literal bodies require parens).
  if (code[index] === '{') {
    const bodyClose = matchBracket(code, mask, index, '{', '}')
    return returnObjectsInBody(code, mask, index, bodyClose)
  }
  return objectsFromValue(code, mask, index)
}

function functionBodyObjects(code: string, mask: boolean[], functionKeywordIndex: number): number[] {
  let cursor = functionKeywordIndex
  while (cursor < code.length && code[cursor] !== '{') cursor += 1
  if (cursor >= code.length) return []
  const bodyClose = matchBracket(code, mask, cursor, '{', '}')
  if (bodyClose === -1) return []
  return returnObjectsInBody(code, mask, cursor, bodyClose)
}

/** Finds object literals reachable from `return` statements (or a returned local const). */
function returnObjectsInBody(code: string, mask: boolean[], bodyOpen: number, bodyClose: number): number[] {
  if (bodyClose === -1) return []
  const results: number[] = []
  let cursor = bodyOpen + 1
  while (cursor < bodyClose) {
    if (!mask[cursor]) {
      cursor += 1
      continue
    }
    if (code.startsWith('return', cursor) && isWordStart(code, cursor) && !IDENT_PART.test(code[cursor + 6] ?? '')) {
      const valueIndex = skipTrivia(code, cursor + 6)
      if (code[valueIndex] === '{' || code[valueIndex] === '(' || code[valueIndex] === '[') {
        results.push(...objectsFromValue(code, mask, valueIndex))
      } else if (IDENT_START.test(code[valueIndex] ?? '')) {
        let end = valueIndex
        while (end < code.length && IDENT_PART.test(code[end])) end += 1
        const name = code.slice(valueIndex, end)
        const assigned = findAssignedObjectLiteral(code, mask, bodyOpen, valueIndex, name)
        if (assigned !== -1) results.push(assigned)
      }
      cursor = valueIndex
      continue
    }
    cursor += 1
  }
  return results
}

function findAssignedObjectLiteral(code: string, mask: boolean[], bodyOpen: number, before: number, name: string): number {
  const pattern = new RegExp(`(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=`, 'u')
  const match = pattern.exec(code.slice(bodyOpen, before))
  if (!match) return -1
  const valueIndex = skipTrivia(code, bodyOpen + match.index + match[0].length)
  return code[valueIndex] === '{' ? valueIndex : -1
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Locates a *direct* child property of the object at `objectOpen`. Only matches
 * at nesting depth 1, so nested `plugins` (postcss, loaders, rules) are ignored.
 */
function findDirectPropertySpan(code: string, mask: boolean[], objectOpen: number, propertyName: string): DirectPropertySpan | null {
  const objectClose = matchBracket(code, mask, objectOpen, '{', '}')
  if (objectClose === -1) return null

  let sawNonArrayKey = false
  let cursor = objectOpen + 1
  let depth = 1

  while (cursor < objectClose) {
    if (!mask[cursor]) {
      cursor += 1
      continue
    }
    const char = code[cursor]
    if (char === '{' || char === '[' || char === '(') {
      depth += 1
      cursor += 1
      continue
    }
    if (char === '}' || char === ']' || char === ')') {
      depth -= 1
      cursor += 1
      continue
    }
    if (depth === 1 && IDENT_START.test(char)) {
      let end = cursor
      while (end < code.length && IDENT_PART.test(code[end])) end += 1
      const key = code.slice(cursor, end)
      const afterKey = skipTrivia(code, end)
      if (key === propertyName && code[afterKey] === ':') {
        const valueIndex = skipTrivia(code, afterKey + 1)
        if (code[valueIndex] === '[') {
          const arrayClose = matchBracket(code, mask, valueIndex, '[', ']')
          if (arrayClose !== -1) return { kind: 'array', open: valueIndex, close: arrayClose }
          return { kind: 'non-array' }
        }
        sawNonArrayKey = true
      }
      cursor = end
      continue
    }
    cursor += 1
  }

  return sawNonArrayKey ? { kind: 'non-array' } : null
}

function insertIntoArray(code: string, arrayOpen: number, arrayClose: number, expression: string, position: 'start' | 'end'): string {
  const body = code.slice(arrayOpen + 1, arrayClose)
  if (!body.trim()) {
    return `${code.slice(0, arrayOpen + 1)}${expression}${code.slice(arrayClose)}`
  }

  if (position === 'start') {
    const afterOpen = code.slice(arrayOpen + 1)
    if (body.includes('\n')) {
      const indent = `${getLineIndent(code, arrayOpen)}  `
      return `${code.slice(0, arrayOpen + 1)}\n${indent}${expression},${afterOpen}`
    }
    return `${code.slice(0, arrayOpen + 1)}${expression}, ${afterOpen}`
  }

  const beforeClose = code.slice(0, arrayClose)
  if (body.includes('\n')) {
    const indent = getLineIndent(code, arrayClose)
    const trimmedBeforeClose = beforeClose.replace(/\s+$/u, '')
    const hasTrailingComma = trimmedBeforeClose.endsWith(',')
    const comma = hasTrailingComma ? '' : ','
    const closingWhitespace = beforeClose.slice(trimmedBeforeClose.length)
    if (closingWhitespace.includes('\n')) {
      return `${trimmedBeforeClose}${comma}\n${indent}  ${expression}${hasTrailingComma ? ',' : ''}${closingWhitespace}${code.slice(arrayClose)}`
    }
    return `${trimmedBeforeClose}${comma}\n${indent}  ${expression}${code.slice(arrayClose)}`
  }

  const trimmedBeforeClose = beforeClose.replace(/\s+$/u, '')
  const separator = trimmedBeforeClose.endsWith(',') ? ' ' : ', '
  return `${trimmedBeforeClose}${separator}${expression}${code.slice(arrayClose)}`
}

function createArrayInObject(code: string, objectOpen: number, propertyName: string, expression: string): string {
  const indent = getLineIndent(code, objectOpen)
  return `${code.slice(0, objectOpen + 1)}\n${indent}  ${propertyName}: [${expression}],${code.slice(objectOpen + 1)}`
}

/**
 * Last-resort behaviour kept from the original installer so unusual config
 * shapes still get patched instead of silently skipped.
 */
function legacyInsert(code: string, propertyName: string, expression: string, position: 'start' | 'end'): string | null {
  const match = new RegExp(`\\b${propertyName}\\s*:\\s*\\[`, 'u').exec(code)
  if (!match) return null
  const arrayOpen = match.index + match[0].lastIndexOf('[')
  const mask = buildMask(code)
  const arrayClose = matchBracket(code, mask, arrayOpen, '[', ']')
  if (arrayClose === -1) return null
  return insertIntoArray(code, arrayOpen, arrayClose, expression, position)
}

/**
 * Inserts `expression` into the bundler's top-level `propertyName` array,
 * creating it on the config root if absent. Returns the patched source, or
 * `null` when no configuration root could be understood.
 */
export function patchArrayProperty(
  code: string,
  propertyName: string,
  expression: string,
  position: 'start' | 'end' = 'end',
): string | null {
  const mask = buildMask(code)
  const roots = collectRootObjectOpens(code)

  // 1. Prefer the first root that already declares a direct array property.
  for (const open of roots) {
    const span = findDirectPropertySpan(code, mask, open, propertyName)
    if (span?.kind === 'array') {
      return insertIntoArray(code, span.open, span.close, expression, position)
    }
  }

  // 2. Otherwise add the property to the first root that lacks it entirely.
  for (const open of roots) {
    const span = findDirectPropertySpan(code, mask, open, propertyName)
    if (span === null) {
      return createArrayInObject(code, open, propertyName, expression)
    }
  }

  // 3. Fallbacks: legacy first-match insert, then create-on-known-wrapper.
  const legacy = legacyInsert(code, propertyName, expression, position)
  if (legacy) return legacy

  for (const open of roots) {
    return createArrayInObject(code, open, propertyName, expression)
  }

  return null
}

export function patchPlugins(code: string, expression: string, position: 'start' | 'end' = 'end'): string | null {
  return patchArrayProperty(code, 'plugins', expression, position)
}
