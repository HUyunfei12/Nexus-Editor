# MDX 支持评估（可行性分析）

> 状态：调研完成 · **建议暂不落地为独立提案**（列为 P3，先做技术选型 design doc）
> 关联：ROADMAP #7 「AST 增强 / Markdown 扩展」（`core` + `preset-gfm`，P2 planned）

## 1. 结论（TL;DR）

Nexus-Editor 目前**不支持**（也不原子支持）MDX，即「Markdown 中内联 JSX + 导入导出组件」范式。原因不是缺一个开关，而是 MDX 触及编辑器的**解析、AST 模型、序列化、HTML 导出、折叠/TOC/表格 widget** 五条既有产线，且它们当前各自假定 Classic CommonMark/GFM mdast。结论：**本轮不做**；建议先产出技术选型 design doc，再评估拆分出的 POC。

## 2. 现状（已核实，2026-09）

| 产线 | 实现 | 对 MDX 的含义 |
|---|---|---|
| 文档解析 | `@lezer/markdown`（CommonMark + GFM），经 `lezerStringToMdast` / `lezerTreeToMdast` 适配为 mdast（`packages/core/src/lezer-mdast-adapter.ts`） | Lezer 把 `<Component>` 当 CommonMark **Raw HTML** 解析，没有 JSX 语义节点；mdast 得到的只是 `html` 字符串节点 |
| 动态解析 | `parser.parse`（自定义 `ParserLike`），`config.parser` 可覆盖 | **唯一现成接缝**：可注入 MDX 处理器实现 targetDocument 级解析 |
| remark 增强 | `createTransformProcessor` 对 non-custom parser 跑 `remarkPlugins`（`editor.ts:294`） | 若走自定义 parser，transform pass 会**双重应用**（代码已有注释明确此约束） |
| HTML 导出 | `exportHTML` 用 `remarkParse`（micromark）→`remarkRehype`→`rehypeStringify`（`editor.ts:142`） | 与文档解析（lezer）**不是同一套 Parse**；JSX 组件无法映射成宿主组件 |
| 折叠 | `markdownFoldService`（`markdown-fold.ts`） | 基于 lezer block nodes；JSX 块不产生可折叠结构 |
| TOC | `extractToc`（`editor.ts:158`） | 只遍历 mdast `heading` |
| 表格 widget | `live-preview-table.ts` 假定 mdast `table` | GFM 表格在 JSX 混排下解析脆弱 |

## 3. MDX 带来的根本差异

1. **AST 模型**：mdast 无 `mdxJsxFlowElement / mdxJsxTextElement / mdxTextExpression` 节点类型，而 `@mdx-js/mdx`（remark-mdx）以它们为第一等公民。要么扩展 mdast 类型（所有下游 adapter 需感知），要么引入非标准节点。
2. **序列化缺失**：编辑器当前**不做** mdast→markdown 反序列化（文档文本始终由 CM6 state 持有），只有 mdast→HTML。MDX 的「组件内嵌 + 重新序列化」没有可挂接的序列化管线，`exportHTML` 也只会把 JSX 当 raw HTML 输出，宿主无法替换为真实组件。
3. **双向不一致**：文档解析用 Lezer、HTML 导出用 micromark，两个 Parse 引擎已经并存。引入 remark-mdx 会再增加第三种（micromark-mdx 或 `@xdm`/`mdast-util-mdx`），三套行为需长期对齐。
4. **与 widget 体系叠加**：MDX 组件本质是一种新「widget」，但现有 `WidgetDefinition` 绑定的是 mdast 节点类型（`nodeType`），MDX 节点的渲染需要新的扩展面。

## 4. 为什么不建议本轮做

- **跨面改动大**：parser、AST 类型、`exportHTML`、折叠、TOC、widget 六处都要动，违反「Simplicity First / 单文件起步」原则。
- **既有插件风险**：`plugin-search`、`plugin-math`、`plugin-toolbar`、`plugin-wordcount` 都遍历 AST 节点类型，MDX 节点会破坏其完整性与 rank 逻辑。
- **收益场景集中**：MDX 主要服务文档站点 / gatsby-like 渲染，与当前定位（headless AST 编辑器 + 插件平台 + Electron demo）验收面不重叠。

## 5. 若未来做：推荐路径

1. **Phase 0 — 技术选型 design doc**（唯一的 P3 提交物）：比较 `@mdx-js/mdx`（micromark 系）与 `@lezer/markdown` + 自定义 token 的 JSX 扩展，评估 `mdast-util-from-markdown` + remark-mdx 作为 parser 注入的序列化一致性。产出到 `docs/superpowers/`。
2. **Phase 1 — POC（不改存量产线）**：利用已存在的 `config.parser` 接缝，注入基于 `unified().use(remarkParse).use(remarkMdx)` 的 `ParserLike`，仅验证「解析出 mdx 类型节点 + `exportHTML` 透传」。**不**改 lezer adapter 与 widget。
3. **Phase 2 — AST 类型扩展**：在 core 增加带前缀的 MDX 节点类型，`lezer-mdast-adapter` 对 `<…>` 打标，`extractToc`、`markdownFoldService` 显式跳过/接纳。
4. **Phase 3 — 可选**：`exportHTML` 支持「宿主组件映射」，把 MDX 节点渲染为宿主元素 —— 这一步才真正兑现「组件化文档」。

## 6. 开放性疑问（进入 design doc 前需确认）

- 目标宿主是纯浏览器文档站，还是 Electron demo 内嵌？决定是否需要组件映射 vs 仅透传。
- 是否需要「组件导入 / 定义」能力（`import X from …`），还是仅内联 JSX？
- 是否接受 `exportHTML` 与编辑器内预览在 MDX 块上短暂不一致（Phase 1 内）。

---

*本文为调研交付物，不涉及任何代码改动。若决定立项，请先在 `docs/superpowers/` 建立 Phase 0 技术选型 design doc，再按 OpenSpec 流程开 proposal。*