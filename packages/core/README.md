# @poke-dev/core

Poke 的共享运行时，包含 dev server 中间件、Agent 调度（Codex、Claude Code、Copilot、Gemini、Cursor）、会话历史和页面里的对话面板。

**一般不需要直接安装**，请按构建工具使用对应的包，或者直接运行 `npx poke`：

| 构建工具 | 包 |
| --- | --- |
| Vite | [`@poke-dev/vite`](https://www.npmjs.com/package/@poke-dev/vite) |
| Webpack | [`@poke-dev/webpack`](https://www.npmjs.com/package/@poke-dev/webpack) |
| Next.js | [`@poke-dev/nextjs`](https://www.npmjs.com/package/@poke-dev/nextjs) |
| Astro | [`@poke-dev/astro`](https://www.npmjs.com/package/@poke-dev/astro) |

**在页面上点一下元素，说一句话，让本地的 AI 编码 Agent 直接改代码。**

开发时按住 `Option`（Windows / Linux 是 `Alt`）点选页面元素，Poke 会把元素对应的源码位置和你的需求一起交给本机的 Agent CLI（Codex、Claude Code、Copilot、Gemini、Cursor），改完由热更新直接显示结果。只在开发态生效，生产构建里没有任何 Poke 代码。

![Poke 对话面板](https://raw.githubusercontent.com/wangrongding/poke/fab60d043e6f4e0a7f4257a6c3596ec32fafb81c/docs/images/conversation.webp)

完整文档：[https://github.com/wangrongding/poke](https://github.com/wangrongding/poke#readme)
