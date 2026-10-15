# Poke 架构设计（ARCHITECTURE）

## 1. Monorepo 分包与依赖

pnpm workspace，`packages/*` 为可发布包，`examples/*` 为私有冒烟工程。所有发布包用 changesets 统一锁版本（fixed 组）。

```mermaid
flowchart TD
  subgraph 发布包
    CORE["@poke-dev/core\n运行时 + 中间件 + Provider"]
    VITE["@poke-dev/vite"]
    WP["@poke-dev/webpack"]
    NEXT["@poke-dev/nextjs"]
    ASTRO["@poke-dev/astro"]
    CLI["poke\n(安装器 CLI)"]
  end
  VITE -->|workspace:*| CORE
  WP -->|workspace:*| CORE
  NEXT -->|workspace:*| CORE
  ASTRO -->|workspace:*| VITE
  ASTRO -->|workspace:*| WP
  ASTRO -->|workspace:*| CORE
  CLI -.独立, 无 core 依赖.-> CLI
  subgraph 示例[examples 私有]
    EV5[vite-react]
    EV4[vite4-react]
    EW5[webpack-react]
    EW4[webpack4-react]
    EN[nextjs-react]
    EA[astro]
  end
  EV5 --> VITE
  EV4 --> VITE
  EW5 --> WP
  EW4 --> WP
  EN --> NEXT
  EA --> ASTRO
```

要点：
- **core 是唯一逻辑源**：客户端拼装、HTTP 中间件、Provider 定义都在 core；各打包器插件只是「把 core 的中间件挂到 dev server、把 core 生成的客户端脚本注入页面」的适配器。
- **cli（`poke`）刻意零运行时依赖**：它只用 Node 内置模块改写配置文件，安装时不应把 core 拖进来。

## 2. core 内部分层

```mermaid
flowchart LR
  subgraph 构建期
    CP["client-panel/*\n(React 面板源码)"] -->|esbuild| GEN["client/react-panel.generated.js"]
  end
  subgraph 运行期_服务端
    CS["client-source.ts\n拼接 client 各 js + style.css"]
    IDX["index.ts\ngetPokeClientCode: __POKE_*__ 令牌替换"]
    MW["middleware.ts + agent-runner.ts"]
    PR["providers.ts\n5 个内置 Agent"]
    IDX --> CS
    MW --> PR
  end
  subgraph 运行期_浏览器
    ST["state.js / dom.js / poke-dom.js"]
    API["api.js"]
    RE["react-panel.generated.js"]
  end
  GEN --> RE
  CS --> IDX
  IDX -->|注入 script| ST
  ST <-->|fetch/ SSE| MW
```

## 3. 全链路时序：拾取 → 注入 → Agent 会话 → 热更新

```mermaid
sequenceDiagram
  participant U as 用户
  participant B as 浏览器客户端
  participant DS as Dev Server(中间件)
  participant AG as Agent CLI(子进程)
  participant FS as 项目文件
  U->>B: 按住 Alt 悬停，元素高亮
  U->>B: Alt+点击
  B->>B: getPickTarget + 读 data-poke-source\n解析源码位置/组件层级
  B->>U: 打开面板(源码、DOM 栈、Provider 选择)
  U->>B: 输入诉求，选 Codex，提交
  B->>DS: POST /__poke-agent {file,layers,prompt,provider}
  DS->>DS: resolveAgentTarget(校验在 root 内) + buildAgentPrompt
  DS->>AG: spawn(codex exec ... )，prompt 经 stdin
  DS-->>B: 返回 {runId, sessionId}
  loop 运行中
    AG-->>DS: stdout(JSON 事件流)
    DS-->>B: SSE /__poke-agent/events?id=runId 逐条推送
  end
  AG->>FS: 直接编辑源码
  FS-->>DS: dev server watch
  DS-->>B: 打包器 HMR / full-reload
  B->>U: 面板展示 diff、变更文件、可继续对话(resume)
```

## 4. 中间件协议

core 暴露 `createPokeMiddlewares(root, options)`，各插件把它挂进自己的 dev server。路由一览：

```mermaid
flowchart TD
  R["HTTP 请求"] --> C{"路径"}
  C -->|GET /__poke-config| CFG[返回 providers/root/默认值]
  C -->|GET /__poke-settings| SET[读 ~/.poke/settings.json]
  C -->|GET /__poke-agent/events?id=| SSE[SSE 事件流]
  C -->|GET/POST /__poke-agent/runs| RUNS[列表/详情/stop/pin/删除]
  C -->|GET/POST /__poke-agent/changes| CHG[工作区 diff/暂存]
  C -->|POST /__poke-agent/permission| PERM[权限应答桥接]
  C -->|POST /__poke-agent| EDIT[起一轮 Agent 会话]
  C -->|GET /__poke/open-in-editor| OE[调起编辑器]
  C -->|GET /__poke/reveal-in-folder| RF[在文件管理器显示]
  C -->|GET /__poke/client.js| CLI[返回拼装后的客户端脚本]
```

| 路由 | 方法 | 职责 |
| --- | --- | --- |
| `/__poke-config` | GET | 客户端启动时拉取可用 Provider、root、默认代理 |
| `/__poke-settings` | GET | 读取用户全局设置（`~/.poke/settings.json`） |
| `/__poke-agent` | POST | 新建会话或在既有会话上追加一轮（resume） |
| `/__poke-agent/events` | GET | SSE：把 Agent 子进程输出实时推给面板，支持 `since` 游标重放 |
| `/__poke-agent/runs` | GET/POST/DELETE | 会话列表/摘要/停止/置顶/删除，按 root 隔离 |
| `/__poke-agent/changes` | GET/POST | 工作区未提交变更清单与单文件 diff，支持暂存 |
| `/__poke-agent/permission` | POST | 权限模式（ask）下 Agent 审批的桥接回环 |
| `/__poke/open-in-editor` `/__poke/reveal-in-folder` | GET | 源码位置跳转编辑器 / 定位文件（挂在 `/__poke/` 命名空间下，避免与宿主 dev-server 的 `/__open-in-editor` 路由冲突） |

> Vite 侧客户端脚本走 `/@id/__x00__poke/client` 虚拟模块；Webpack 侧额外挂 `/__poke/client.js`。插件路径前缀均可由 `clientPath` 覆盖。

## 5. 客户端注入机制

```mermaid
flowchart LR
  subgraph Vite
    VR[resolveId poke/client -> \u0000poke/client] --> VL[load: getPokeClientCode]
    VTH[transformIndexHtml: 注入 script src] --> VL
  end
  subgraph Webpack
    WE[prependEntry client-entry.js] --> WB[打进 main bundle]
    WS[devServer 中间件挂 /__poke/client.js]
  end
```

- Vite：`enforce:'pre'`、`apply:'serve'`，虚拟模块 `\0poke/client` 由 `load` 返回客户端源码，`transformIndexHtml` 注入 `<script type=module src=/@id/__x00__poke/client>`。
- Webpack：非 production 下把 `client-entry.js` 前置进 entry，并把 `/__poke/*` 中间件挂到 dev server（v5 用 `setupMiddlewares`，v4 用 `before`）。注意 vue-cli-service 会在插件 `apply()` 前就快照 `devServer`，插件自己设的 `before` 不被调用；这类宿主需在 `vue.config.js` 的 `devServer.before` 里调 `pokeDevServerBefore()(app, server)` 手动挂路由（否则 client-entry 的 `<script src=/__poke/client.js>` 404，图标/快捷键不生效）。
- **源码属性注入按框架/打包器分流**：注入属性统一为 `data-poke-source`（`文件:行:列`）与 `data-poke-source-range`。Vite 用 `transform` 钩子（JSX via babel、Vue via `compiler-sfc`、Svelte via compiler，天然懒编译、每模块一次）。Webpack 分两类：React JSX 用 `source-loader.cjs`（babel），但**按宿主能否解析 `react` 门控**——非 React 项目（Vue JSX / Solid 的 `.jsx`）完全不碰，避免把 JSX 改写成 `import … from 'react/jsx-runtime'` 而编译失败（可用 `annotateJsx` 强制开关）；Vue2/webpack4 的 `.vue` 用 `vue-source-loader.cjs`（`enforce:'pre'`，先于 vue-loader）解析 SFC 给模板节点补坐标，并按 `resourcePath + source` 记忆化，消除 vue-loader 每文件多子请求触发的全量重解析（实测 1201 个 `.vue` 冷启动 ~16s→~4s，坐标与产物不变）。

## 6. 状态与持久化边界

```mermaid
flowchart TD
  subgraph 每个项目
    CFG[bundler 配置 theme/root/agents] -->|构建期注入| CLIENT[客户端常量 __POKE_*__]
  end
  subgraph 浏览器本地
    LS[localStorage\npoke-panel-ui-theme 等] -->|即时生效| UI[面板/dock]
  end
  subgraph 用户主目录
    SS[~/.poke/settings.json\nuiTheme/locale/proxy...] 
  end
  UI <--> LS
  LS -->|同步| SS
  CLIENT -.默认值.-> UI
```

三层各司其职：bundler 配置给**默认值**；`localStorage` 让**即时切换**不依赖服务端；`~/.poke/settings.json` 是跨项目的**用户级偏好**（由面板写回，`api.js` 的 `userSettingFields` 做字段映射）。
