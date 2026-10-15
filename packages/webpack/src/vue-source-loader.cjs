// Webpack loader (enforce: 'pre') that runs before vue-loader on .vue files and
// injects Poke source-location attributes into the template markup. Delegates to
// the pure helper so the logic is unit-testable and shared with the vite plugin.
const { injectVueSourceAttributes } = require('./vue-source.cjs')

module.exports = function pokeVueSourceLoader(source) {
  const request = this.resourcePath

  if (!request || !/\.vue$/u.test(request)) {
    return source
  }

  // vue-loader runs this `pre` loader for the main request AND each `?vue&type=` block
  // sub-request, but in every case `source` is still the full raw SFC (block extraction
  // happens later, inside vue-loader). vue-loader re-parses this source per request and
  // refreshes a shared descriptor cache, so we must inject consistently on every request
  // (skipping the sub-requests let an un-injected re-parse overwrite the cache and drop the
  // attributes). Re-injection on already-annotated markup is prevented inside the injector.
  const transformed = injectVueSourceAttributes(source, request)

  return transformed === null ? source : transformed
}
