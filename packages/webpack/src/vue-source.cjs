// Vue SFC source-location injection for the Webpack pipeline (R7: legacy Vue2 /
// any webpack + vue-loader project). Mirrors packages/vite exactly so the React,
// Vue3 and Vue2 paths emit identical `data-poke-source` / `data-poke-source-range`
// coordinates and the shared picking runtime needs no framework-specific logic.
//
// Why a bespoke pass instead of reusing the app's vue-loader: vue-template-compiler
// (Vue2) does not expose per-element source offsets, so we locate the <template>
// block and its elements with the Vue3 parsers (@vue/compiler-sfc / -dom, bundled as
// our own deps) purely to read byte offsets, then string-insert the attributes into
// the raw SFC text before vue-loader compiles it.
const { ElementTypes, NodeTypes, parse: parseVueTemplate } = require('@vue/compiler-dom')
const { parse: parseVueSfc } = require('@vue/compiler-sfc')

const sourceAttribute = 'data-poke-source'
const sourceRangeAttribute = 'data-poke-source-range'

function escapeHtmlAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

function getLineStartOffsets(source) {
  const offsets = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      offsets.push(index + 1)
    }
  }

  return offsets
}

function getLocationFromOffset(offsets, offset) {
  let low = 0
  let high = offsets.length - 1

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const lineOffset = offsets[middle]
    const nextLineOffset = offsets[middle + 1] ?? Number.POSITIVE_INFINITY

    if (offset < lineOffset) {
      high = middle - 1
      continue
    }

    if (offset >= nextLineOffset) {
      low = middle + 1
      continue
    }

    return { column: offset - lineOffset + 1, line: middle + 1 }
  }

  const lastLine = offsets[offsets.length - 1] ?? 0
  return { column: offset - lastLine + 1, line: offsets.length }
}

function hasVueSourceAttribute(props) {
  return (props ?? []).some(
    (prop) => prop.type === NodeTypes.ATTRIBUTE && (prop.name === sourceAttribute || prop.name === sourceRangeAttribute),
  )
}

// Offset of the template block's inner content within the whole file (not the
// <template> tag itself), matching the vite helper's behaviour.
function getTemplateContentStartOffset(source, block) {
  const blockSource = source.slice(block.loc.start.offset, block.loc.end.offset)
  const contentOffset = blockSource.indexOf(block.content)

  if (contentOffset >= 0) {
    return block.loc.start.offset + contentOffset
  }

  return source.indexOf(block.content, block.loc.start.offset)
}

function collectVueSourceInsertions(nodes, fileName, templateOffset, lineOffsets, insertions) {
  for (const node of nodes ?? []) {
    if (node.type === NodeTypes.ELEMENT) {
      if (node.tagType === ElementTypes.ELEMENT && node.tag && node.loc && !hasVueSourceAttribute(node.props)) {
        const startOffset = templateOffset + node.loc.start.offset
        const endOffset = templateOffset + node.loc.end.offset
        const start = getLocationFromOffset(lineOffsets, startOffset)
        const end = getLocationFromOffset(lineOffsets, endOffset)
        const insertionOffset = startOffset + node.tag.length + 1
        const sourceValue = escapeHtmlAttribute(`${fileName}:${start.line}:${start.column}`)
        const rangeValue = escapeHtmlAttribute(`${fileName}:${start.line}:${start.column}-${end.line}:${end.column}`)

        insertions.push({
          content: ` ${sourceAttribute}="${sourceValue}" ${sourceRangeAttribute}="${rangeValue}"`,
          offset: insertionOffset,
        })
      }

      collectVueSourceInsertions(node.children, fileName, templateOffset, lineOffsets, insertions)
      continue
    }

    if (node.branches?.length) {
      for (const branch of node.branches) {
        collectVueSourceInsertions(branch.children, fileName, templateOffset, lineOffsets, insertions)
      }
    }

    collectVueSourceInsertions(node.children, fileName, templateOffset, lineOffsets, insertions)
  }
}

// Returns the transformed SFC source, or null when there is nothing to inject
// (no <template>, parse errors, or a non-SFC file) so callers keep the original.
function injectVueSourceAttributes(code, fileName) {
  let descriptor

  try {
    descriptor = parseVueSfc(code, { filename: fileName }).descriptor
  } catch {
    return null
  }

  if (!descriptor || !descriptor.template) {
    return null
  }

  const templateOffset = getTemplateContentStartOffset(code, descriptor.template)

  if (templateOffset < 0) {
    return null
  }

  let templateAst

  try {
    templateAst = parseVueTemplate(descriptor.template.content)
  } catch {
    return null
  }

  const lineOffsets = getLineStartOffsets(code)
  const insertions = []
  collectVueSourceInsertions(templateAst.children, fileName, templateOffset, lineOffsets, insertions)

  if (!insertions.length) {
    return null
  }

  let transformedCode = code
  for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) {
    transformedCode = `${transformedCode.slice(0, insertion.offset)}${insertion.content}${transformedCode.slice(insertion.offset)}`
  }

  return transformedCode
}

module.exports = { injectVueSourceAttributes, sourceAttribute, sourceRangeAttribute }
