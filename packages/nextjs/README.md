# @poke-dev/nextjs

Poke 的 Next.js 插件，支持 Webpack 和 Turbopack 两种 dev server。

**在页面上点一下元素，说一句话，让本地的 AI 编码 Agent 直接改代码。**

开发时按住 `Option`（Windows / Linux 是 `Alt`）点选页面元素，Poke 会把元素对应的源码位置和你的需求一起交给本机的 Agent CLI（Codex、Claude Code、Copilot、Gemini、Cursor），改完由热更新直接显示结果。只在开发态生效，生产构建里没有任何 Poke 代码。

![Poke 对话面板](https://raw.githubusercontent.com/wangrongding/poke-ai/main/docs/images/conversation.webp)

## 安装

```bash
npx poke          # 自动安装并改好 next.config 和 instrumentation-client
# 或手动：
npm i -D @poke-dev/nextjs
```

```ts
// next.config.ts
import { withPoke } from '@poke-dev/nextjs'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default withPoke(nextConfig)
```

同时在项目根目录的 `instrumentation-client.ts`（或 `.js`）里加一行：

```ts
import '@poke-dev/nextjs/client'
```

## 使用

1. 启动 dev server，打开页面。
2. 按住 `Option` / `Alt` 点选元素，打开面板。
3. 写下需求，按 `⌘ + Enter`（Windows / Linux 为 `Ctrl + Enter`）发送。

前提是本机已经装好并登录至少一个 Agent CLI，比如能在终端里直接运行 `codex` 或 `claude`。建议把 `.poke` 加进 `.gitignore`。

完整文档（多轮会话、改动与 diff、权限、配置项、环境变量）：[https://github.com/wangrongding/poke-ai](https://github.com/wangrongding/poke-ai#readme)
