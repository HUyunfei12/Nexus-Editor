## Why

Nexus 当前的 `NexusPlugin` 只是随 `createEditor()` 一次性展开的声明对象，已经能贡献快捷键、命令、事件处理器、remark 插件、Widget 和 CodeMirror 6 扩展，但缺少插件生命周期、自动资源清理、动态注册、宿主服务发现、工作区/UI 扩展以及文件与元数据服务。结果是复杂插件必须各自发明 `attachEditor()`、`destroy()` 和宿主桥接方式，难以形成类似 Obsidian 的稳定插件生态。

本变更借鉴 Obsidian 公开插件 API 的分层设计，为 Nexus 定义一套宿主无关、能力可探测、可渐进迁移的插件平台 API；目标是复用其成熟的设计原则，而不是复制 Obsidian 实现或承诺现有 Obsidian 插件可直接运行。

## What Changes

- 新增插件运行时与 `NexusPluginBase` 生命周期：`load/onload/unload/onunload`、父子组件、统一 disposer、事件/DOM/定时器自动清理，以及失败回滚和幂等卸载。
- 新增 `NexusApp` 宿主上下文和 capability discovery；编辑器、命令、工作区、文件、元数据、UI、存储等服务由宿主显式提供，插件必须能在能力缺失时降级或拒绝加载。
- 新增动态命令注册、命令可用性检查、编辑器命令、用户快捷键覆盖、作用域快捷键和冲突处理；保留现有 `shortcuts`、`commands` 声明作为兼容入口。
- 新增类型化事件注册与可取消编辑器事件，覆盖编辑器变更、选区、粘贴、拖放、上下文菜单、工作区活动项和文件生命周期；剪贴板语义以实际 DOM 事件为准，而不是仅抽象成 `Ctrl/Cmd` 按键。
- 新增稳定的编辑器扩展入口，包括 CodeMirror 6 extension、DOM 事件、剪贴板文本过滤、事务/更新监听、Markdown 后处理和可销毁渲染子组件。
- 新增可选的工作区与 UI 服务：视图注册、活动视图/编辑器查询、打开与聚焦、菜单、模态框、设置页、命令面板贡献、状态栏与工具栏挂载点；所有 DOM 均从目标视图/窗口上下文获取。
- 新增可选的内容服务：虚拟文件/文件夹模型、Vault 风格读写、原子修改、安全移动/删除、资源 URL、链接生成、frontmatter 修改、元数据缓存与索引事件；底层文件系统继续由宿主适配器负责。
- 新增插件 manifest、API 版本约束、平台/能力声明、插件私有数据与安全存储接口，并定义加载前校验、兼容诊断和弃用策略。
- 现有 `NexusPlugin` 对象插件继续可用；运行时通过 legacy adapter 加载其声明贡献。本变更不要求一次性重写现有官方插件。
- 明确非目标：不提供 Obsidian API 名称空间 shim，不直接执行 Obsidian 社区插件，不暴露 Electron/Node 内部对象，不在第一阶段实现插件市场、远程代码下载或不可信插件沙箱。

## Capabilities

### New Capabilities

- `plugin-runtime`: 插件/组件生命周期、资源托管、宿主上下文、能力发现、加载失败与卸载语义。
- `plugin-commands-events`: 动态命令、快捷键作用域、类型化事件、可取消编辑器事件及分发优先级。
- `plugin-editor-extensions`: 编辑器实例上下文、CM6 扩展、DOM/剪贴板钩子、Markdown 后处理和渲染子组件。
- `plugin-workspace-ui`: 工作区视图模型、视图注册与导航、菜单/模态框/设置页/状态栏/工具栏等宿主 UI 贡献。
- `plugin-content-services`: 文件与文件夹抽象、内容读写、文件管理、资源链接、frontmatter 和元数据缓存服务。
- `plugin-manifest-compatibility`: manifest、API/平台/能力兼容校验、插件数据存储、旧版 `NexusPlugin` 适配和弃用策略。

### Modified Capabilities

无。仓库当前没有已归档到 `openspec/specs/` 的插件平台主规范；现有进行中 change 的行为保持不变，由新的兼容层承接。

## Impact

- 核心 API：`packages/core` 的插件类型、编辑器创建/销毁、事件与扩展装配流程。
- 新的宿主层：预计新增独立的插件运行时包，避免让 `@floatboat/nexus-core` 依赖工作区、文件系统或 UI 实现。
- 框架绑定：`packages/react`、`packages/vue` 需要对运行时所有权、装载和卸载建立一致契约。
- Electron Demo：作为首个完整宿主，为工作区、Vault、元数据、UI 和持久化 capability 提供适配器。
- 官方插件：逐步迁移到运行时注册模式，同时继续通过 legacy adapter 接受现有对象插件。
- 公共 API 与文档：需要中文/英文 API 指南、插件模板、兼容矩阵和迁移说明。
- 安全：文件路径限制、HTML 消毒、外部网络与秘密数据必须由宿主策略控制；本变更不把第三方插件视为安全沙箱代码。
