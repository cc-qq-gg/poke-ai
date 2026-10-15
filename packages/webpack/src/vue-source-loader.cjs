// Webpack loader (enforce: 'pre') that runs before vue-loader on .vue files and
// injects Poke source-location attributes into the template markup. Delegates to
// the pure helper so the logic is unit-testable and shared with the vite plugin.
const { injectVueSourceAttributes } = require('./vue-source.cjs')

// Per-file memo. vue-loader issues the same full-SFC `source` for the main request
// and every `?vue&type=` block sub-request, but webpack compiles the whole graph
// eagerly on a cold start, so without this we re-parse each file ~3-5x. Keyed on the
// exact source text so an edit recomputes; we still RETURN injected markup for every
// request (vue-loader re-parses per request and refreshes the shared descriptor cache,
// so every request must carry the injected source) - the memo only skips recompute.
const cache = new Map()

function injectMemoized(fileName, source) {
  const hit = cache.get(fileName)

  if (hit && hit.source === source) {
    return hit.result
  }

  const result = injectVueSourceAttributes(source, fileName)

  // Keep long watch sessions from growing the cache across renamed/deleted files.
  if (cache.size > 4096) {
    cache.clear()
  }

  cache.set(fileName, { source, result })

  return result
}

module.exports = function pokeVueSourceLoader(source) {
  const request = this.resourcePath

  if (!request || !/\.vue$/u.test(request)) {
    return source
  }

  const transformed = injectMemoized(request, source)

  return transformed === null ? source : transformed
}
