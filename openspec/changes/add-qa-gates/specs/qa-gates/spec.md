# Change: Add QA gates (browser E2E, a11y, performance budget)

## ADDED Requirements

### Requirement: Browser E2E harness
项目 MUST 提供一个浏览器级端到端测试环境，通过真实渲染的编辑器（`createEditor` + GFM/history/search/toolbar/wordcount，`livePreview:true`）验证核心交互路径，并暴露 `window.__nexus` 桥以便测试驱动文档读写、主题切换与渲染结果断言。

#### Scenario: 桥接线可用
- **WHEN** 测试加载 harness 页面
- **THEN** `window.__nexus` MUST 提供 `getDocument`、`setDocument`、`exportHTML`、`setTheme`、`fontColor`、`tableCount`
- **AND** harness 初始文档 MUST 渲染出至少一个可见的表格容器

### Requirement: 端到端交互覆盖
E2E 套件 MUST 覆盖以下真实用户路径并断言结果：表格渲染、`setDocument` 整体置换文档、键入触发 Markdown 结构化预览、经真实击键触发撤销、Ctrl+F 打开搜索面板、明暗主题切换改变实际渲染颜色。

#### Scenario: 键入触发引用/标记
- **WHEN** 用户在可见编辑内容区键入 Markdown 语法
- **THEN** 文档内容 MUST 反映键入字符
- **AND** 编辑器 MUST 保持可继续输入，不发生崩溃或 DOM 复用中断

#### Scenario: 搜索面板打开
- **WHEN** 用户按下 Ctrl+F
- **THEN** 搜索面板 MUST 可见并可接受查找文本

### Requirement: 无障碍无关键违规
E2E 套件 MUST 使用 axe-core 对渲染后的编辑器执行无障碍扫描，并断言不存在严重（critical）违规。

#### Scenario: 可访问性扫描
- **WHEN** 对已渲染编辑器运行 axe 扫描
- **THEN** `violations` MUST 为空数组

#### Scenario: CI 可跳过
- **WHEN** 环境变量 `CI_PW_SKIP_A11Y` 被设置
- **THEN** 无障碍断言 MUST 被跳过而非失败

### Requirement: 性能预算门禁
仓库 MUST 提供真实的浏览器性能基准脚本 `scripts/bench.mjs`，测量 `setDocument:1k`、`edit:100`、`exportHTML:1k`，并在给定 `--budget` 时令任一指标超出预算即失败退出（非零 exit code）。

#### Scenario: 触摸预算边界
- **WHEN** 运行 `node scripts/bench.mjs --budget scripts/bench-budgets.json`
- **THEN** 若任一指标超过对应预算 MUST 返回非零退出码并打印超预算诊断

#### Scenario: 冒烟输出
- **WHEN** 不带 `--budget` 运行基准
- **THEN** 各指标 MUST 以毫秒打印，不因基准工具自身失败而中断

### Requirement: CI 质量门禁
CI MUST 在独立 `browser-e2e` job 中安装 Playwright Chromium、构建产物、运行 E2E 套件，并在产物构建后强制执行性能预算门禁。

#### Scenario: 回归被拦截
- **WHEN** PR 引入的改动使 E2E 用例失败、无障碍关键违规出现，或任一性能指标超预算
- **THEN** CI `browser-e2e` job MUST 失败并阻断合并