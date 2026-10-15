# @poke-dev/astro

## 1.0.4

### Patch Changes

- Updated dependencies
  - @poke-dev/core@1.0.4
  - @poke-dev/vite@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies
  - @poke-dev/core@1.0.3
  - @poke-dev/vite@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies
  - @poke-dev/core@1.0.2
  - @poke-dev/vite@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies
  - @poke-dev/core@1.0.1
  - @poke-dev/vite@1.0.1

## 1.0.0

### Major Changes

- 与 `@poke-dev/core` 1.0.0 同步发布：面板升级为对话式多轮会话，历史持久化，支持停止、重试、排队发送和改动文件列表。破坏性变更（class 前缀改为 `poke-`、会话默认落盘、历史写入 `.poke/runs/`）见 `@poke-dev/core` 的 CHANGELOG。

### Patch Changes

- Updated dependencies
  - @poke-dev/core@1.0.0
  - @poke-dev/vite@1.0.0

## 0.1.0

### Minor Changes

- 5df7279: 新增 Astro 一等支持

  - 新增 `@poke-dev/astro` integration：仅在 `astro dev` 下挂载 Poke middleware 并通过页面脚本注入客户端，`astro build` 产物不受影响；`.astro` 模板在 Astro 编译前注入精确的 source 标记，React / Vue / Svelte 岛屿沿用 `@poke-dev/vite` 的注入；支持 Astro 4 ~ 7，不依赖 dev toolbar。
  - `poke` CLI 识别 Astro 项目（优先于 vite），安装 `@poke-dev/astro` 并改写 `astro.config.*` 的 `integrations`；新增 `--bundler astro`。多行数组追加插件时保留 `]` 的原有换行，import 插入后不再多出空行。
  - core 客户端兼容 Astro 原生的 `data-astro-source-file` / `data-astro-source-loc` 作为定位回退，并加入幂等保护，避免同一页面被多个入口重复初始化。

### Patch Changes

- Updated dependencies [5df7279]
  - @poke-dev/core@0.4.10
  - @poke-dev/vite@0.4.11
