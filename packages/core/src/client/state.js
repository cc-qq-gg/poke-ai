const root = __POKE_ROOT__
const base = __POKE_BASE__
const defaultProxy = __POKE_AGENT_PROXY__
const agentProviders = __POKE_AGENT_PROVIDERS__
const defaultAgentProviderId = __POKE_DEFAULT_AGENT_PROVIDER__
// Starting panel skin from the bundler config (`theme` option); the user's own pick wins.
const defaultUiTheme = __POKE_UI_THEME__
const targetAttribute = 'data-poke-target'
const sourceAttribute = 'data-poke-source'
const sourceRangeAttribute = 'data-poke-source-range'
// v2: anchored to the nearest edges. The old key held a top-left point that
// window resizes overwrote; it is ignored, so docks moved by that return to the corner.
const dockPositionStorageKey = 'poke-dock-anchor'
const proxyStorageKey = 'poke-proxy'
const proxyModeStorageKey = 'poke-proxy-mode'
const providerStorageKey = 'poke-provider'

let currentTarget
let dockButton
let dockPointerState
let draftTarget
let pokePanel
let panelRefs
let selectedRunId
let suppressDockClick = false
let submitting = false
// 右侧打开的会话就是 selectedRunId：有它时下一次提交一定接在这条会话里，没有时就是新会话。
// 续跑时把焦点切到新点选的 DOM：undefined 表示沿用该会话原来的焦点。
let continueTarget
// Option 点选会开新会话；之前打开的那条会话记在这里，面板据此提供「改在这条会话里继续」的入口。
let repointRunId

// 首次从服务端拉历史之前为 false，面板据此显示「加载中」而不是「还没有任务」。
let runsHydrated = false

const runs = []
const runSubscriptions = new Map()
// SSE 断开后（多半是 dev 服务重启）按退避重新拉摘要对账的定时器。
const runResyncTimers = new Map()
// 服务端任务列表的版本号；其他标签页新建 / 删除 / 续跑会话后它会变，轮询据此判断要不要重新拉列表。
let runsVersion = 0
let runListSyncTimer
const providers = Array.isArray(agentProviders) && agentProviders.length ? agentProviders : [{ enabled: true, id: 'codex', label: 'Codex' }]
