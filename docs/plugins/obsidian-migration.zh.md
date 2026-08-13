# 从 Obsidian 公开插件 API 迁移到 Nexus

本文用于**移植源码**，不是二进制或无修改兼容承诺。设计与矩阵固定参考：

- [`obsidian-api` @ `cc1744324150c632416857c98964f87b1574a5fc`](https://github.com/obsidianmd/obsidian-api/tree/cc1744324150c632416857c98964f87b1574a5fc)
- [`obsidian-sample-plugin` @ `07ceb81d1fb3384af611ebf665a1ec42a7e5926d`](https://github.com/obsidianmd/obsidian-sample-plugin/tree/07ceb81d1fb3384af611ebf665a1ec42a7e5926d)

Nexus 只参考这两个固定提交的**公开导出和官方示例**。`window.app`、未导出的类、私有字段、Obsidian DOM 内部结构和社区插件对内部实现的探测不属于兼容依据。

## 1. 支持级别

| 级别 | 含义 |
|---|---|
| `native` | Nexus 有稳定的原生概念与公共合同；必须改 import 和通常需要改调用形状 |
| `adapter` | 可由显式移植/宿主适配器表达，但不是同名 API，也不保证所有 Obsidian 语义 |
| `deferred` | 架构允许以后提供，当前没有可依赖的稳定公共合同 |
| `unsupported` | 明确不提供，或与 Nexus 的安全/包边界相冲突 |

## 2. 符号族矩阵

| Obsidian 公开符号族 | Nexus 状态 | Nexus 对应与迁移要点 |
|---|---|---|
| `Plugin`, `Component`, `PluginManifest` | `native` | `NexusPluginBase`, `NexusComponent`, `AuthorPluginManifest`；runtime 控制 load/unload，资源 owner-bound，manifest capability 与 permission 分开 |
| `App` | `adapter` | `NexusApp` 是最小只读宿主 facade；通过 capability token 取服务，没有 `app.vault/app.workspace` 巨型对象 |
| `Events`, `EventRef` | `native` | `TypedEvents<T>`, `Subscription`；类型化 event map、稳定优先级/注册序和 owner 自动清理 |
| `Command`, `Hotkey`, `Scope`, `Keymap` | `native` | `CommandService`, `HotkeyService`, `ScopeService`；命令四种互斥 callback 模式，`Mod` 跨平台，用户覆盖和冲突显式化 |
| `Editor`, `EditorPosition`, `EditorSelection`, `MarkdownView` 编辑上下文 | `adapter` | `EditorAPI`, `EditorContext`, transaction service；命令触发时解析 editor，不能假设单一 active editor |
| `EditorSuggest`, `AbstractInputSuggest`, `FuzzySuggestModal`, `SuggestModal` | `deferred` | 当前 UI 服务没有通用 suggest 合同；不要绑定某个宿主 DOM 实现 |
| `Workspace`, `WorkspaceLeaf`, `WorkspaceItem`, `WorkspaceContainer`, `ItemView`, `View` | `native` | `WorkspaceService`, `WorkspaceLeaf`, `NexusView`, view registry；导航显式指定 reuse/new-tab/split/window/default，多实例和占位恢复是合同的一部分 |
| `HoverParent`, `HoverPopover`, `HoverPopoverManager` | `deferred` | 尚无稳定 hover service；不要直接查询宿主浮层 DOM |
| `Vault`, `TAbstractFile`, `TFile`, `TFolder` | `native` | `VaultService`, `NexusAbstractFile/NexusFile/NexusFolder`；只接受规范化 Vault 相对路径，文件身份独立于 path |
| `FileManager` | `native` | `FileManagerService`；move/rename/link/frontmatter/trash 返回结构化结果，默认可恢复删除 |
| `DataAdapter`, `FileSystemAdapter` | `unsupported` | 插件不接触绝对路径、原始 filesystem adapter、Node `fs` 或 Electron IPC；由宿主 capability 代理 |
| `MetadataCache`, `CachedMetadata`, `FileCache`, `FrontMatterCache`, link/block/heading/tag cache | `native` | `MetadataService`, `FileMetadata`；cache 带内容版本，可等待索引到指定版本，resolved/unresolved/backlinks 类型化 |
| `parseFrontMatter*`, `getAllTags`, `resolveSubpath` 等 metadata 辅助函数 | `adapter` | 优先消费 `MetadataService` 结果；不承诺同名 helper 或完全相同解析细节 |
| `MarkdownRenderer`, `MarkdownPostProcessor`, `MarkdownPostProcessorContext`, `MarkdownRenderChild` | `native` | `MarkdownProcessorService`, `MarkdownPostProcessorContext`, `NexusComponent` child；异步 generation/abort 防止过期结果覆盖新渲染 |
| `MarkdownPreviewRenderer`, `MarkdownSourceView`, `MarkdownPreviewView` | `deferred` | 当前只承诺 processor 与 Workspace view 合同，不暴露具体宿主渲染器内部类 |
| `addIcon/getIcon/getIconIds/removeIcon`, `setIcon` | `adapter` | UI 使用 `IconReference` 和宿主 icon policy；动作必须有可访问名称，不提供全局可变 icon registry 的等价保证 |
| `Menu`, `MenuItem`, `Modal`, `Notice`, `Setting`, `PluginSettingTab` | `native` | `UiService` 下的 menu/modal/notice/setting tab；使用目标 `WindowContext`，支持焦点恢复、headless 降级和 owner 清理 |
| ribbon、status bar、editor/view toolbar、command palette | `adapter` | 注册到命名 UI slot；宿主决定是否呈现和位置，不返回可任意操作宿主结构的全局元素 |
| `ButtonComponent`、`DropdownComponent`、`TextComponent` 等 Setting 组件 | `adapter` | Setting tab 使用声明式 `SettingDefinition` 联合；验证和存储绑定由宿主处理 |
| `PopoverSuggest`, `SearchComponent`, `SearchResultContainer` 等搜索 UI | `deferred` | 尚无稳定搜索 UI capability |
| `request`, `requestUrl`, `RequestUrlParam/Response` | `deferred` | 当前没有公共 network capability；不能回退到 Node/Electron。宿主以后可提供独立可授权服务 |
| `Plugin.loadData/saveData` | `native` | `PluginStorageService`；按规范化 plugin ID 分区、快照读取、原子串行保存、schema migration 和外部失效通知 |
| Obsidian secret/credentials 相关服务 | `adapter` | 可选 `SecretStorageService`；宿主无安全后端时明确 unsupported，绝不降级成普通插件 JSON |
| `Platform`, `apiVersion`, `requireApiVersion` | `adapter` | manifest `platforms/apiVersion/hostVersion` 加载前预检；没有依赖全局环境探测的兼容路径 |
| `normalizePath`, `getLinkpath`, `getFileName` 等路径 helper | `adapter` | Vault capability 只接受规范化相对路径；不要自行拼接绝对路径或绕过授权根 |
| `debounce`, `throttle`, `memoize`, `debouncePromise`, `sleep` 等通用 utility | `unsupported` | 使用标准 Web API 或插件自带依赖；Nexus 不复制与平台无关的工具集合 |
| `moment`, `loadMomentLocale`, `loadMathJax`, `loadPdfJs` | `unsupported` | 不提供全局第三方库或 loader；按插件依赖和宿主内容策略分别设计 |
| `Canvas`, `CanvasNode`, `CanvasEdge`, canvas selection/menu events | `deferred` | 当前无 Canvas capability；不要访问宿主私有 canvas 对象 |
| `BasesView`, `BasesEntry`, `BasesProperty*`, `BasesQuery*` | `deferred` | 当前无 Bases capability，亦不暗示兼容 |
| `Publish`, `Sync`, `Cli`, `ObsidianProtocolData`, 移动端/桌面端专属控制 | `unsupported` | Nexus 当前公共插件合同不暴露产品私有服务、系统 shell 或协议处理器 |
| `setTooltip`, `setChildrenInPlace`, `createEl/createDiv` 等 Obsidian DOM augmentation | `unsupported` | 使用标准 DOM 与目标 `ownerDocument`；不修改全局 DOM prototype |
| `loadPrism`, Prism language helpers | `unsupported` | 语法高亮由编辑器/宿主 extension 负责，不暴露 Obsidian 全局 Prism |

`native` 不等于签名相同。比如 `Vault.rename()` 和 `FileManager.moveFile()` 返回结构化结果并执行授权/版本检查；迁移时不能保留只等异常的控制流。

## 3. 官方 sample plugin 的逐项迁移

固定 sample 的主要用法可这样映射：

| Sample 行为 | Obsidian 写法 | Nexus 写法 |
|---|---|---|
| 生命周期 | `extends Plugin`, `onload/onunload` | `extends NexusPluginBase`, `onload/onunload`；卸载后的统一资源清理由 runtime 完成 |
| ribbon | `addRibbonIcon` | `UI_CAPABILITY` 的 ribbon slot contribution；无 UI 时降级 |
| status bar | `addStatusBarItem` | status-bar slot；跨 editor 的状态放插件 owner，不放 DOM 全局单例 |
| 命令 | `addCommand` | `COMMANDS_CAPABILITY.registerCommand()`；本地 ID 自动命名空间化 |
| editor 命令 | `editorCallback` | `editorCallback` 接收触发时解析的 `EditorContext` |
| modal | `new SampleModal(this.app).open()` | 通过窗口作用域 UI capability 打开；owner 卸载自动关闭并恢复焦点 |
| setting tab | `addSettingTab` | 声明式 Setting tab + `PLUGIN_STORAGE_CAPABILITY` |
| DOM event | `registerDomEvent(document, ...)` | `NexusComponent.registerDomEvent()`；应使用目标 view/window 的 document |
| interval | `registerInterval(...)` | 相同资源托管理念，使用 `registerInterval()` |

固定 sample 没有完整展示 editor paste、custom view 和 Vault event；Nexus 的 reference fixture 会把这些公开 API 族作为额外迁移用例，而不是声称它们来自 sample 当前源码。

## 4. 典型重写

Obsidian 风格：

```ts
import { Plugin } from "obsidian";

export default class Example extends Plugin {
  async onload() {
    this.addCommand({ id: "open", name: "Open", callback: () => {} });
    this.app.vault.on("modify", (file) => console.log(file.path));
  }
}
```

Nexus 原生风格：

```ts
import {
  COMMANDS_CAPABILITY,
  NexusPluginBase,
  VAULT_CAPABILITY,
  type WorkspaceId,
} from "@floatboat/nexus-plugin-api";

export default class Example extends NexusPluginBase {
  override onload(): void {
    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    commands.registerCommand({ id: "open", name: "Open", callback: () => {} });
  }

  registerWorkspace(workspaceId: WorkspaceId): void {
    const vault = this.app.capabilities.get(
      VAULT_CAPABILITY,
      "^1.0.0",
      { workspaceId },
    );
    if (vault) {
      this.registerEvent(vault.events.on("modify", ({ file }) => console.info(file.path)));
    }
  }
}
```

实际宿主 adapter 应在 leaf/view attach 时用真实 Workspace 上下文调用 `registerWorkspace()`；插件不要从 manifest、全局变量或 DOM 猜测活动 Workspace。示例同时展示 capability 的显式上下文与 optional 降级。

## 5. 明确不兼容的入口

- 不发布名为 `obsidian` 的 shim；`import { Plugin } from "obsidian"` 不会解析为 Nexus。
- 不注入 `window.app`，也不支持 `(window as any).app`。
- 不执行未经移植的 Obsidian community plugin bundle。
- 不暴露 Obsidian 私有 API、Node、Electron、原始 IPC、绝对 Vault 路径或宿主 DOM 内部结构。
- 不因为名称相似就宣称布局、Markdown 渲染细节或事件时序完全一致。

迁移应以 capability 和行为测试为单位：先迁生命周期与命令，再迁 editor/Markdown contribution，最后迁 Workspace、Vault 和 UI；每一步都验证 enable/disable 循环、多编辑器和 headless 降级。
