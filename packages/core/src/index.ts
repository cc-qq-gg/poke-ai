import { getPokeClientSource, getPokeClientWatchFiles } from './client-source'
import {
  pokeChangesMiddleware,
  pokeConfigMiddleware,
  pokeEditMiddleware,
  pokeEventsMiddleware,
  pokeRunsMiddleware,
  openInEditorMiddleware,
  revealInFolderMiddleware,
} from './middleware'
import { pokePermissionMiddleware } from './permissions'
import { getClientAgentProviders, getDefaultAgentProviderId } from './providers'
import { getConfiguredCodexProxy, normalizeProxy } from './proxy'
import { configurePokeRunHistory } from './run-history'
import { pokeSettingsMiddleware } from './user-settings'
import type { PokePluginOptions, PokeRoute } from './types'

export { ensureLaunchEditor } from './editor'
export {
  pokeChangesMiddleware,
  pokeConfigMiddleware,
  pokeEditMiddleware,
  pokeEventsMiddleware,
  pokeRunsMiddleware,
  openInEditorMiddleware,
  revealInFolderMiddleware,
} from './middleware'
export { getClientAgentProviders, getDefaultAgentProviderId } from './providers'
export { getConfiguredCodexProxy, normalizeProxy } from './proxy'
export type {
  PokeAgentPermissionMode,
  PokeAgentPermissionsInput,
  PokeAgentProviderInput,
  PokeAgentSessionInput,
  PokeAgentSessionMode,
  PokeMiddleware,
  PokePluginOptions,
  PokeRoute,
} from './types'

export { getPokeClientWatchFiles } from './client-source'

export function createPokeMiddlewares(root: string, options: PokePluginOptions = {}): PokeRoute[] {
  const codexProxy = normalizeProxy(options.codex?.proxy ?? options.proxy)
  configurePokeRunHistory(root, options.agents?.history)

  return [
    { path: '/__poke/open-in-editor', middleware: openInEditorMiddleware(root) },
    { path: '/__poke/reveal-in-folder', middleware: revealInFolderMiddleware(root) },
    { path: '/__poke-config', middleware: pokeConfigMiddleware(root, options, codexProxy) },
    { path: '/__poke-settings', middleware: pokeSettingsMiddleware() },
    { path: '/__poke-agent/events', middleware: pokeEventsMiddleware(root) },
    { path: '/__poke-agent/runs', middleware: pokeRunsMiddleware(root) },
    { path: '/__poke-agent/changes', middleware: pokeChangesMiddleware(root) },
    // Registered before `/__poke-agent`, which would otherwise match it as a prefix.
    { path: '/__poke-agent/permission', middleware: pokePermissionMiddleware(root) },
    { path: '/__poke-agent', middleware: pokeEditMiddleware(root, options, codexProxy) },
  ]
}

export function getPokeClientCode(input: {
  base?: string
  defaultProvider?: string
  options?: PokePluginOptions
  pluginProxy?: string
  root: string
}) {
  const options = input.options ?? {}
  const pluginProxy = normalizeProxy(input.pluginProxy ?? options.codex?.proxy ?? options.proxy)
  const agentProviders = getClientAgentProviders(input.root, options, pluginProxy)

  return getPokeClientSource()
    .replace('__POKE_ROOT__', JSON.stringify(input.root))
    .replace('__POKE_BASE__', JSON.stringify(input.base ?? '/'))
    .replace('__POKE_AGENT_PROXY__', JSON.stringify(getConfiguredCodexProxy(pluginProxy)))
    .replace('__POKE_AGENT_PROVIDERS__', JSON.stringify(agentProviders))
    .replace('__POKE_UI_THEME__', JSON.stringify(options.theme ?? 'default'))
    .replace(
      '__POKE_DEFAULT_AGENT_PROVIDER__',
      JSON.stringify(getDefaultAgentProviderId(agentProviders, input.defaultProvider ?? options.agents?.defaultProvider)),
    )
}
