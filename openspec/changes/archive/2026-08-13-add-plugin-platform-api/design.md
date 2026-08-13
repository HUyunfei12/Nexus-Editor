## Context

本设计解释 `proposal.md` 所述插件平台如何落地，不重复其动机与能力清单。

Nexus 当前有两个彼此分离的扩展边界：

- `packages/core` 中的 `NexusPlugin` 是随 `createEditor()` 一次性展开的编辑器贡献对象。快捷键、命令、DOM 处理器、remark 插件、Widget 和 CodeMirror 6 扩展都会在编辑器构造时拍平成静态数组；它没有 manifest、宿主上下文、加载/卸载状态或统一资源托管。
- Electron Demo 拥有实际的 Vault、活动文件、链接索引、设置、面板和 IPC，但这些能力是应用私有模块，不是插件可发现的稳定服务。React/Vue 包装器也只拥有单个编辑器的挂载与销毁，不拥有应用级插件运行时。

已有架构约束必须保留：

1. `@floatboat/nexus-core` 继续是路径无关、框架无关的单文档编辑引擎，不依赖 Electron、Vault、Workspace 或具体 UI。
2. 现有 `createEditor({ plugins: NexusPlugin[] })` 和官方插件 factory 继续工作；平台建设不能要求一次性重写所有插件。
3. 插件启停不能通过销毁并重建活动编辑器实现，否则会丢失 undo 历史、选区、滚动、IME 合成状态和交互中的 Widget DOM。
4. 表格 Widget 在单元格编辑、范围选择和 grip 拖动时有独立的跨帧状态机。任何动态扩展或事件统一都不得破坏这些交互锁。
5. Electron 当前开启 `contextIsolation` 且关闭 `nodeIntegration`。新的插件 API 不得把 Node、Electron 或原始 `ipcRenderer` 重新暴露给插件。

本设计只以 Obsidian 的公开 API 和官方 sample 为参考，固定到以下版本，以避免设计依据随上游主分支漂移：

- [obsidian-api @ cc1744324150c632416857c98964f87b1574a5fc](https://github.com/obsidianmd/obsidian-api/tree/cc1744324150c632416857c98964f87b1574a5fc)
- [obsidian-sample-plugin @ 07ceb81d1fb3384af611ebf665a1ec42a7e5926d](https://github.com/obsidianmd/obsidian-sample-plugin/tree/07ceb81d1fb3384af611ebf665a1ec42a7e5926d)

不以 `window.app`、未导出的类、私有字段、DOM 内部结构或社区插件对 Obsidian 内部实现的探测行为作为兼容依据。

## Goals / Non-Goals

**Goals:**

- 建立清晰的应用、插件、组件、窗口、视图和编辑器所有权，所有注册资源都可追溯到唯一 owner 并自动释放。
- 让宿主通过稳定、可版本化的 capability 提供命令、编辑器、Workspace、Vault、UI、存储等服务；插件可以在加载前判断能力是否存在。
- 支持命令、事件、CM6 扩展和 UI 贡献的运行时注册与撤销，且不重建活动编辑器。
- 对插件加载失败、卸载失败、回调异常和多编辑器局部失败定义确定的回滚及诊断语义。
- 将现有 Electron 能力适配成宿主服务，同时保持主进程文件系统权限边界。
- 为旧 `NexusPlugin` 提供显式 legacy adapter，并为官方插件提供渐进迁移路径。
- 用公开的支持级别描述与 Obsidian API 的关系，不用相似命名暗示尚未实现的兼容性。

**Non-Goals:**

- 不提供名为 `obsidian` 的 namespace shim，不以不改源码运行 Obsidian 社区插件为目标。
- 不实现插件市场、远程下载、签名、自动更新或依赖解析器。
- 不把同一 renderer realm 内运行的第三方代码描述为安全沙箱；真正的不可信代码隔离留待独立方案。
- 不让 `packages/core` 直接实现 Vault、Workspace、设置页、模态框或 Electron IPC。
- 不保证第一阶段覆盖 Obsidian 的 Bases、CLI、移动端、桌面端私有接口或所有辅助工具。
- 不在本变更中规定应用产品层必须提供多窗口、多 Vault 或完整布局管理；接口必须允许这些能力以后加入。

## Decisions

### 1. 将“编辑器贡献”与“宿主插件实例”建模为不同概念

保留现有 `NexusPlugin` 作为编辑器贡献描述，并在文档中给出更准确的概念名 `EditorPluginContribution`。新增 `NexusPluginBase` 作为有 manifest、`NexusApp`、生命周期和资源树的宿主插件实例。两者不互相继承。

```text
NexusPlugin / EditorPluginContribution
  -> 静态或动态贡献给一个或多个编辑器

NexusPluginBase
  -> 由 PluginRuntime 实例化
  -> 持有 NexusApp 与 manifest
  -> 在 onload() 中向 capability 注册贡献
  -> 在 onunload() 后由 runtime 自动释放全部贡献
```

这样可避免把可复用的 CM6 数据对象和有状态的应用级插件实例混为一谈，也避免当前 wordcount 式“对象既是 contribution 又是 attach-once handle”的实例域歧义。

备选方案是直接给 `NexusPlugin` 增加 `onload/onunload`。该方案会改变现有 factory 的实例语义，难以判断同一个对象能否跨编辑器复用，并会让 core 反向依赖宿主服务，因此拒绝。

### 2. 包边界和依赖方向

采用单向依赖，公共契约和宿主实现分离：

```text
@floatboat/nexus-core
  单文档 EditorAPI、EditorPluginContribution、动态 editor contribution 原语
        ^ type-only/public editor contract
        |
@floatboat/nexus-plugin-api
  NexusApp、NexusPluginBase、NexusComponent、manifest、capability token、
  command/event/workspace/vault/ui/storage 等宿主无关接口
        ^
        |
@floatboat/nexus-plugin-runtime
  PluginManager、CapabilityRegistry、各贡献注册表、所有权/回滚、legacy adapter
        ^
        |
host adapters
  Electron Demo、以后可能的 Web/React/Vue 应用宿主
```

- `nexus-core` 不依赖 `plugin-api` 或 `plugin-runtime`。
- `plugin-api` 只可类型依赖 core 的公开编辑器类型，不导入 Electron、Node 或某个框架运行时。
- `plugin-runtime` 依赖 API 与 core，负责把平台注册转换成 core 的动态 contribution。
- Electron 的文件、窗口和协议实现留在宿主适配层；其共享 IPC schema 可放在 Electron app 内的 `platform` 模块，不进入 browser-safe API 包。
- 第一阶段不单独发布 `nexus-workspace` 包。Workspace/Vault 是 `plugin-api` 中的接口，由宿主实现；出现第二种完整宿主并产生共享实现后再抽包。
- 增加 runtime testkit，提供内存 capability、虚拟 Workspace/Vault 和资源泄漏断言，避免插件测试依赖 Electron。

备选方案是把全部 API 放进 core。它会让最小编辑器包承担文件系统和应用 UI 概念，并形成 React/Vue/Electron 条件依赖，因此拒绝。

### 3. Plugin 与 Component 使用事务化生命周期状态机

PluginManager 的外部状态如下：

```text
discovered -> validating -> disabled
                         \-> incompatible

disabled -> loading -> enabled -> unloading -> disabled
                \-> failed
```

插件实例内部状态如下：

```text
constructed -> loading -> loaded -> unloading -> unloaded
                    \-> rolling-back -> failed
```

生命周期规则：

1. manifest 与 required capability 校验在实例化和执行插件代码前完成。
2. `load()` 与 `unload()` 由 runtime 控制且不可被插件覆盖；插件只实现异步 `onload()` 与 `onunload()`。
3. `onload()` 期间所有 registry entry 进入 staging transaction。句柄和 DOM 节点可供插件初始化，但命令/事件/扩展在全局分发中暂不可见。
4. `onload()` 成功后一次性提交 staging entries，再把状态设为 `enabled`。提交对单个 registry 原子；跨编辑器应用失败时按第 7 节的 journal 回滚。
5. `onload()` 抛错时，runtime 先禁止所有 staged callback，再按注册逆序释放子组件与资源；尚未完成成功加载的实例不调用 `onunload()`。这一规则避免插件钩子观察到从未提交的“已加载”状态，并与实例级 `onload`/`onunload` 各至多一次的契约保持一致。
6. 正常卸载先将 owner 标为 `quiescing`，使其命令、事件和新注册立即失效；再调用 `onunload()`；最后逆序释放子组件、DOM、timer 和 registry entry。
7. `onunload()` 或 disposer 抛错会被收集为诊断，但不会中断后续清理。实例仍进入不可分发的 `unloaded` 终态；PluginManager 将结果记录为“disabled with cleanup errors”，而不是创造第二套实例状态。
8. `unload()`、registration `dispose()` 和 Component `unload()` 均幂等；并发调用共享同一个进行中的 Promise。
9. runtime 不允许处于 `quiescing/unloading/unloaded` 的 owner 新增注册。

`NexusComponent` 使用相同的内部状态和 disposer store。`addChild(child)` 将子组件加载与父组件 transaction 绑定；父组件卸载时，子组件作为 disposer 栈中的一项按逆序卸载。`registerEvent`、`registerDomEvent`、`registerInterval`、`register(disposer)` 和所有 capability registration 最终都进入同一 store。

不依赖垃圾回收或 UI 框架卸载来完成插件清理，因为这无法覆盖全局 DOM listener、timer、Workspace 事件和主进程订阅。

### 4. Capability discovery 同时表达“宿主有能力”和“插件被授权”

`NexusApp` 是只读服务入口，不是所有方法的巨型对象。它暴露类型化 `CapabilityRegistry`：

```ts
app.capabilities.has(token, versionRange)
app.capabilities.get(token, versionRange)      // 缺失返回 undefined
app.capabilities.require(token, versionRange)  // 缺失抛兼容错误
```

每个 token 有稳定字符串 id、独立语义版本和 TypeScript 服务类型，例如：

- `nexus.commands`
- `nexus.editor-host`
- `nexus.workspace`
- `nexus.vault`
- `nexus.metadata-cache`
- `nexus.ui`
- `nexus.plugin-storage`
- `nexus.secrets`
- `nexus.network`

manifest 中分别声明 `requiredCapabilities`、`optionalCapabilities`、版本范围和权限用途。required capability 在加载前校验；optional capability 必须通过 `get()` 分支降级。capability 不存在与权限未授予使用不同诊断码。

capability 有明确作用域：application、window、workspace、view/editor。应用级 registry 返回上下文 handle，而不是让插件缓存一个永远代表“当前编辑器”的可变全局。需要 DOM 的服务必须从目标 view/window 上下文取得 `ownerDocument` 和 `ownerWindow`。

能力发现不是安全沙箱。第一阶段插件与宿主同处 renderer realm，manifest 权限用于兼容检查、审计和宿主策略，不足以防御恶意代码。真正的强隔离需要 Worker、isolated world 或独立进程，属于后续安全架构。

备选方案是固定 `app.vault/app.workspace/...` 全部存在并以空实现降级。它会产生“调用成功但无效果”的静默错误，也无法表达 Web 与 Electron 宿主差异，因此拒绝。

### 5. 所有注册表共享 owner、优先级、确定性顺序和 disposer 契约

命令、事件、快捷键、编辑器扩展、Markdown、View 和 UI 分别拥有专用 registry，但共享以下 entry 元数据：

```text
registration id
owner plugin id / component id
local id 与解析后的全局 id
priority band + registration sequence
scope 与 capability version
active / staged / quiescing / disposed 状态
idempotent disposer
```

规则如下：

- 插件本地命令 id 解析为 `${pluginId}:${localId}`。全局 id 冲突在注册时拒绝并产生诊断，不沿用当前“执行 first wins、列表却保留重复项”的模糊行为。
- 公共 registration 使用有界整数优先级，同值按注册序稳定排序；宿主保留一个插件不可申请的 system 区间执行安全检查。开发者 API SHOULD 提供 `high / normal / low / fallback` 常量映射到推荐数值，避免常见插件依赖任意极值。
- 观察型事件对订阅快照广播；单个 handler 抛错只记录该插件诊断，不阻止其他 handler。
- 可取消事件按优先级串行、同步分发；`preventDefault()` 或返回 consumed 后停止后续可取消 handler。需要在 DOM 原事件上阻止默认行为的 handler 不允许异步返回。
- disposer 被调用后 entry 立即对新分发不可见；已经取得快照且正在执行的同步 callback 可以完成。
- 插件开始卸载时，owner 的所有 entry 先统一变为 quiescing，再执行用户清理代码，避免卸载中的重入。
- 每个 registry 提供 owner 维度的泄漏检查；插件卸载完成后仍有 entry 是 runtime bug，并在测试和开发模式中报错。

快捷键解析额外遵循：用户覆盖高于插件默认值；更具体的 Scope 高于应用 Scope；之后才比较 registry priority 和注册序。命令可用性通过无副作用的 `check()` 与执行 `run()` 分离，命令面板和菜单不靠试执行判断状态。

### 6. 多编辑器模型以 EditorHostRegistry 为中心

runtime 不假设只有一个编辑器。每个宿主创建的编辑器都通过 `EditorHostRegistry.attach()` 取得稳定 `EditorInstanceId`、所属 Workspace leaf/view、文件上下文、window/document 和动态 contribution sink。

```text
NexusApp
  +-- WindowContext A
  |     +-- Leaf 1 -> MarkdownView -> Editor A
  |     `-- Leaf 2 -> CustomView
  `-- WindowContext B
        `-- Leaf 3 -> MarkdownView -> Editor B
```

活动编辑器只是 Workspace 派生状态。命令执行时解析当前 Scope 的 editor context；插件若要操作特定编辑器，必须持有该 view 给出的 handle，不能依赖进程级 singleton。

新编辑器 attach 时读取所有已提交 contribution snapshot。编辑器 detach 只销毁该编辑器中的 extension/view 资源，不卸载应用级插件。插件卸载则撤销其在所有已 attach 编辑器上的贡献。

### 7. CM6 动态扩展按 plugin owner 使用 Compartment，禁止重建 EditorView

core 增加最小的动态 contribution sink。每个编辑器为每个插件 owner 维护一个 CM6 `Compartment`；该 owner 的多个 extension 注册合成为一个 extension tree。注册变化时只对相应 compartment dispatch `reconfigure`。

选择 owner 级 compartment，而不是每个 extension 一个 compartment，可减少大量插件带来的 compartment 数量，并让一个插件的启用/禁用在单个编辑器中原子生效。单个 registration dispose 会重新计算该 owner 的 extension tree。

跨编辑器提交使用 journal：

1. 记录每个编辑器原 snapshot/version。
2. 依次 reconfigure 到新 snapshot。
3. 任一编辑器失败时，将已更新编辑器逆序恢复旧 snapshot，并让插件 load transaction 失败。
4. 某个已 detach/destroy 的编辑器视为跳过，不构成失败。
5. 回滚本身失败时隔离该编辑器、记录 fatal diagnostic，但不留下插件 registry entry 为 active。

reconfigure 必须保留同一个 `EditorView`/`EditorState`、文档、选区、历史和滚动位置。CM6 ViewPlugin 的销毁由 compartment 移除触发。

编辑器维护 interaction barrier。IME composition、表格单元格编辑、范围选择、鼠标按下和行列 grip 拖动期间，物理 reconfigure 排队到安全点；owner 的 callback 在逻辑上已 quiesce，因此等待期间不会收到新事件。正常 `unload()` 等待安全点完成；应用强制退出可以直接销毁整个 editor。这样既不在跨帧交互中替换 Widget DOM，也不延长插件行为可见期。

### 8. remark、Widget 与 Markdown 后处理使用版本化注册表

CM6 动态化不足以覆盖当前构造期冻结的 remark processor 和 Widget definitions，因此 Markdown contribution 单独建模：

- `RemarkTransformRegistry` 维护同步 transform snapshot。版本变化时按插件优先级重建 processor；各编辑器在安全点刷新 AST 和依赖该 AST 的 decorations，不修改文档或历史。
- `WidgetRegistry` 以全局 contribution id 注册 definition。版本变化通过 StateEffect 更新 definition snapshot，并重建相关 decorations；被移除 Widget 必须执行 destroy。
- `MarkdownPostProcessorRegistry` 面向宿主拥有的阅读视图/渲染根节点，支持异步处理，并给每次 render 一个子 `NexusComponent`。重新渲染、view detach 或插件卸载都会先销毁该子组件。
- legacy `remarkPlugins` 和 `widgets` 由 adapter 映射到前两类 registry；现有 `createEditor({ plugins })` 的静态路径不变。

插件 transform 异常不污染上一个成功 snapshot：processor rebuild 先在 staging tree 验证，再提交。异步 postprocessor 必须检查 render generation；过期 Promise 的结果不得挂到新一代 DOM。

### 9. Widget、表格和 `ignoreEvents` 之上增加统一的编辑器根捕获层

CM6 `domEventHandlers` 只能可靠覆盖 contentDOM 自己处理的事件。交互式 Widget、`ignoreEvents: true` 的 Widget 和表格 `contentEditable` 单元格可能拥有自己的默认行为，不能把它们等同于普通文档选区。

每个 EditorHost 在编辑器根节点安装唯一 capture dispatcher，标准化以下真实 DOM 事件：`keydown`、`beforeinput`、`copy`、`cut`、`paste`、`drop`、`contextmenu`。事件流程是：

```text
宿主安全/根捕获(system)
  -> 插件可取消 editor DOM hook
  -> Widget 或表格本地处理
  -> CM6 contentDOM/default behavior
  -> 观察型语义事件
```

若插件未消费事件，capture dispatcher 不调用 `preventDefault`、不改变传播，让表格/Widget/浏览器保持原行为。若插件同步消费，dispatcher 在原 DOM 事件上阻止默认行为并终止后续插件可取消分发。

事件上下文包含 `origin: document | widget | table | external` 和 `EditorInputTarget`：

- 普通编辑区 target 将替换操作映射到 `EditorAPI` 选区。
- 表格或交互式 Widget 可注册自己的 target adapter，提供该交互面的 selection/replace/copy 语义。
- 没有 target adapter 的 Widget 事件仍可观察和取消，但调用文本替换会得到明确的 unsupported result，不能错误修改 CM6 主选区。

`ignoreEvents` 只表示 CM6 不应尝试在 Widget 内解析光标，不表示事件对插件平台不可见，也不意味着插件可跳过 Widget 自身所有权清理。legacy Widget 保持原语义；新 Widget render context 可创建受托管子 Component。

表格 target adapter 与动态 reconfigure 必须遵守现有表格交互不变量：不清空刚设置的范围状态，不在活动 range/edit/drag 期间重建 DOM，不用 HTML5 Drag API，不以 cell border 作为临时指示，并在所有退出路径配平 editing lock。平台测试须覆盖编辑、范围选择、列/行选择、重排、外部取消和删除键路径。

备选方案是只增加更多 `EditorView.domEventHandlers`。它无法覆盖表格与 Widget 的真实焦点/selection 语义，因此拒绝。

### 10. Workspace、Vault、内容服务和 UI 由宿主适配

`plugin-api` 定义接口，runtime 只管理注册与所有权，宿主负责实现：

**Workspace/View**

- `NexusWorkspace` 管理 window、leaf、view、活动 leaf 和布局就绪事件。
- `WorkspaceLeaf` 有稳定 id、view type 和可序列化 state；`NexusView` 拥有 container、window context 和 Component 生命周期。
- `MarkdownView` 绑定 `EditorAPI`、`NexusFile` 与 leaf。首个 Electron adapter 可把当前单编辑器映射为一个 leaf，未来扩展多 leaf 时不改变插件 API。
- `registerView(type, factory)` 返回 registration；卸载插件前先关闭或替换该插件拥有的 view，再移除 factory。

**Vault/FileManager/MetadataCache**

- 公共路径统一为 Vault-relative、`/` 分隔的规范路径；绝对路径只存在于 Electron main-process adapter。
- `NexusAbstractFile`、`NexusFile`、`NexusFolder` 由 Vault adapter 创建并维护稳定身份。rename 更新对象路径并发出包含 oldPath 的事件，Workspace 和 cache 据此更新引用。
- Vault 负责读取、创建、写入、原子 modify、rename、trash/delete、binary 和资源 URL；`FileManager` 负责更高层的链接生成、重命名策略与 frontmatter 修改；`MetadataCache` 负责解析结果、resolved/unresolved links 和索引事件。
- 首阶段可由 Electron 现有文件 IPC 和 LinkIndex 提供 adapter；没有对应底层能力的方法不得用空结果伪装成功。

**UI**

- `UIService` 提供 toolbar/ribbon、status bar、menu、modal、setting tab、suggest、notice、command palette 和 view slot；所有创建方法返回 owner-bound handle。
- UI handle 只挂到宿主给出的 slot/container，并从目标 WindowContext 取得 DOM。插件不应默认 append 到全局 `document.body`。
- 宿主可选择没有视觉 UI 的 headless 实现；此时 `nexus.ui` capability 不存在，而不是提供无效果的元素。
- 现有 toolbar、slash menu、wordcount status、outline/backlinks 和 settings panel 可以逐步改造成 adapter/reference plugin，同时保留旧工厂入口。

### 11. React、Vue 与 Electron 使用显式 owned/borrowed runtime 所有权

React/Vue 包装器仍可在无 runtime 时仅创建 standalone editor。集成插件平台时支持两种模式：

- **borrowed runtime**：应用 Provider/上层宿主拥有 `NexusApp` 和 PluginRuntime；编辑器组件 mount 时 attach editor，unmount 时 detach editor，不卸载应用插件。
- **owned runtime**：明确由包装器创建的临时 runtime 随包装器卸载；主要用于测试或单编辑器嵌入。

默认不得根据每次 render 的 `plugins` 数组重复 load 应用级插件。React Strict Mode 的 mount/unmount 探测和 Vue watcher 更新必须只影响 editor attachment，不产生重复 manifest 实例。受控文档同步继续使用现有 silent `setDocument` 路径。

Electron 的所有权分为：

```text
main process
  文件系统授权、Vault session、watch、trash、协议、Secret 后端
       ^ schema-validated capability IPC
preload
  最小、类型化、不可扩展的 broker
       ^ host adapter only
renderer
  NexusApp + PluginRuntime + Workspace/UI + 受信插件代码
```

每个 BrowserWindow 有独立 WindowContext。主进程 handler 校验 sender/window、Vault session、操作 schema 和规范化相对路径；插件永远拿不到 `ipcRenderer`、绝对 Vault root 或 raw fs。应用关闭顺序为停止新分发、卸载插件、detach/destroy views/editors、关闭 IPC subscription；强制退出仍由主进程关闭 watcher。

### 12. 安全模型是“受信插件 + 最小宿主能力”，不是同 realm 沙箱

第一阶段插件代码与应用 renderer 同权运行，因此只能承诺以下边界：

- Electron main process 对每个文件和协议请求做路径规范化、Vault 内约束、sender/session 校验和参数 schema 校验。
- preload 只公开 capability broker 所需操作，不公开通用 IPC。
- 外部网络、协议注册、Secret、剪贴板和系统 shell 是独立 optional capability；默认缺失，由宿主策略授予。
- plugin storage 按规范化 plugin id 分区，防止普通 API 意外跨插件读写。Secret 不写入 `loadData/saveData` 的普通 JSON。
- Markdown 后处理和插件提供的 HTML 经过宿主 sanitizer/policy；资源 URL 通过宿主 capability 生成并受 scheme/CSP 策略约束。
- runtime 捕获插件回调异常并按 owner 诊断，避免一个插件阻止其他插件卸载或事件广播。

manifest 权限和 capability proxy 对误用、审计与未来隔离有价值，但不能阻止同 realm 恶意插件直接操作 DOM 或探测全局对象。文档和 UI 必须明确插件是受信代码。若未来接收不可信市场插件，应使用独立 realm/进程并重新评估 DOM 和同步事件 API。

### 13. Obsidian 公开 API 覆盖分类与首阶段支持级别

支持级别定义：

- **native**：由 Nexus 公共契约和 runtime 原生提供，名称或数据模型不承诺与 Obsidian 相同。
- **adapter**：Nexus 契约已定义，由现有 core/Electron/宿主能力适配；实际可用性取决于宿主。
- **deferred**：设计保留扩展点，但首阶段不实现完整行为。
- **unsupported**：明确不支持，也不提供静默 no-op。

以下分类以本设计 Context 中固定 commit 的 `obsidian.d.ts` 公开导出和官方 sample 用法为准：

| 公开 API 分类 | 首阶段级别 | Nexus 处理方式 |
|---|---|---|
| 生命周期、`Component`、`Plugin`、`App` | **native** | 提供 `NexusComponent`、`NexusPluginBase`、`NexusApp`、事务化 load/unload 和 capability discovery；不追求类名或字段一一对应。 |
| `Events`、`EventRef`、DOM/interval 注册 | **native** | 类型化 registry、owner-bound disposer、观察/可取消事件和自动清理。具体 Vault/Workspace 事件由对应 adapter 提供。 |
| 命令、editor command、hotkey、`Scope` | **native** | namespaced command registry、check/run、用户覆盖、作用域和确定性冲突规则。Obsidian hotkey 文本格式只在迁移 adapter 中解析。 |
| `Editor` 与 CM6 editor extension | **native + adapter** | Nexus offset EditorAPI 为 native；提供 line/ch adapter；CM6 使用 owner compartment 动态 reconfigure。Obsidian 未公开内部编辑器字段不支持。 |
| Markdown renderer、postprocessor、code block processor | **native + adapter** | 新的 render generation/child Component 为 native；现有 remark/Widget/live preview 经 adapter 接入。阅读视图完整度按宿主能力。 |
| Workspace、leaf、view、MarkdownView | **adapter** | 公共模型由 API 定义；Electron 首期以单 leaf/单 MarkdownView 适配，完整布局、多窗口恢复与复杂 view 导航延后。 |
| Vault、TFile/TFolder、FileManager、MetadataCache | **adapter + deferred** | Vault CRUD/watch、基础文件模型和现有 LinkIndex 先适配；binary、frontmatter、rename link policy、完整 metadata cache 分阶段补齐。 |
| Ribbon/status bar/menu/modal/notice/suggest/setting tab | **adapter + deferred** | 先提供宿主 UI slots、menu/modal/setting/status/toolbar 基础适配；高级 Suggest、Popover、拖拽与移动端 UI 延后。 |
| manifest、插件 data storage、secret storage | **native + deferred** | manifest/API version、分区 `loadData/saveData` 原生提供；Secret 是 optional host capability，Electron 安全后端可后续接入。 |
| network、protocol、icon、通用 utilities | **deferred** | network/protocol 必须是显式受策略 capability；基础 icon/路径/文本工具按实际插件需求逐项加入，不复制庞大 utility surface。 |
| Bases | **deferred** | 不在首阶段定义数据视图/公式/查询兼容层；未来作为独立 capability。 |
| CLI | **unsupported** | renderer 插件 API 不模拟 Obsidian CLI；以后如有 Nexus CLI，使用独立进程和独立插件入口。 |
| 平台特有、移动端、Electron/Node 私有行为 | **unsupported** | 不暴露 Electron/Node，不模拟 Obsidian mobile/desktop 私有对象；插件只能依据 manifest platform 与 capability 分支。 |

该矩阵描述能力类别，不构成 `obsidian` module 的兼容承诺。平台不会提供 `obsidian` namespace shim，也不会为社区插件注入 `window.app`；迁移工具只能针对公开 API 提供显式 import 和数据模型适配。

### 14. API、manifest 与 capability 分别版本化

manifest 至少包含：插件 id、name、version、入口、`apiVersion` 范围、required/optional capability 及其版本范围、platform 限制和权限用途。加载前执行：schema 校验、id 规范化、runtime API 版本匹配、宿主平台匹配、required capability/permission 校验。

版本策略：

- runtime 公共 API 使用 semver；同一 major 内保持已发布行为兼容。
- capability 独立版本化，插件不得用 runtime 版本推断某个 capability 的方法集合。
- 新增 optional 字段是 minor；改变事件顺序、资源所有权、默认安全策略或路径语义视为 breaking。
- 弃用 API 至少保留两个 minor 发布周期，并提供 runtime diagnostic 与迁移文档；安全漏洞修复可以缩短周期但必须在 release note 明示。
- manifest 与 plugin data 都带 schema version；迁移先写临时数据并原子替换，失败保留旧数据。
- compatibility report 必须区分 incompatible、missing-capability、permission-denied、deprecated 和 runtime-error。

不提供 Obsidian API 名称空间 shim。若以后需要帮助迁移源码，应提供独立 codemod/adapter package，显式把公开 Obsidian 模式改写为 Nexus API，而不是在运行时伪装完整兼容。

### 15. Legacy adapter 保持现有 API，官方插件按复杂度渐进迁移

`createEditor({ plugins })` 继续走现有静态路径。PluginRuntime 另外提供 legacy adapter，把 `NexusPlugin` 的 commands、shortcuts、handlers、cmExtensions、remarkPlugins 和 widgets 注册到对应 registry。

- legacy contribution 获得宿主生成的稳定 owner id；名字冲突在 adapter 层诊断。
- 静态 standalone editor 不因引入 runtime 包而增加运行时依赖。
- runtime-managed editor 可动态撤销 legacy contribution，但只有已接入动态 Markdown registry 的贡献才承诺完全热卸载；过渡期间不支持的字段应在 load 前明确报兼容错误，不能要求重启后假装成功。
- history、search、vim、gfm、math 和 wikilinks 可先作为 legacy fixtures。
- wordcount 优先迁移，以验证 `attachEditor()` 被多编辑器 context 和 Component 生命周期取代。
- toolbar/slash/status bar 随后迁移，以验证 UI slot、全局 DOM 事件和 disposer。
- 旧 factory 导出至少保留一个 major 兼容周期；新 class/plugin entry 使用不同导出名，避免调用方误把实例当 contribution。

### 16. 分阶段落地并保持每阶段可发布

**阶段 0：契约与测试骨架**

- 建立 API 覆盖矩阵、manifest schema、capability id/version registry 和 runtime testkit。
- 为生命周期、回滚、disposer、命令冲突和资源泄漏写契约测试。

**阶段 1：runtime 基础与编辑器动态能力**

- 发布 `plugin-api` 与 `plugin-runtime` 的 Component/Plugin/Capability/Command/Event 基础。
- 在 core 增加 owner compartment、EditorHostRegistry sink 和 interaction barrier。
- 接入 DOM 根捕获事件与 legacy adapter；用 history/search/toolbar contribution 验证兼容。

**阶段 2：Markdown、Widget、多编辑器与框架绑定**

- 完成 remark/Widget/postprocessor 动态 registry、render child Component 和 input target adapter。
- 增加 React/Vue borrowed/owned runtime attach API，验证多编辑器和 Strict Mode。
- 迁移 wordcount 与 slash/toolbar 作为 reference plugins。

**阶段 3：Electron 完整宿主**

- 抽出 typed IPC schema、Vault session、Workspace 单 leaf adapter、UI slots 和 plugin storage。
- 将现有 Vault、LinkIndex、面板和设置功能接到 capability；补齐 Electron E2E、安全与关闭顺序测试。

**阶段 4：内容服务与可选能力**

- 按插件需求补齐 FileManager、frontmatter、MetadataCache、Secret、Network、Protocol 和高级 UI。
- 每增加一类公开参考 API，更新支持矩阵和 pinned fixture，不以空壳扩大表面覆盖率。

阶段之间不以全量功能为发布门槛，但任何标记为 native/adapter 的行为必须有契约测试和明确宿主支持报告。

## Risks / Trade-offs

- **动态 CM6 卸载可能破坏编辑器状态或 Widget DOM** -> 使用 owner compartment、interaction barrier 和不重建 EditorView 的强约束；加入 undo/selection/scroll/IME/表格全路径回归测试。
- **多编辑器提交无法获得真正的跨实例原子性** -> 使用 snapshot journal 和逆序回滚；失败插件不进入 enabled，异常编辑器进入可诊断隔离状态。
- **remark processor 与 Widget registry 重建可能造成输入卡顿** -> 注册变化是低频操作；processor staging、按版本缓存、仅刷新受影响编辑器，并把重配置延迟到交互安全点。
- **统一根事件与 Widget/表格本地行为发生双处理** -> 明确 capture、local、CM6、semantic 四阶段，只在同步 consumed 时阻止原事件；使用 `EditorInputTarget` 区分实际焦点语义。
- **优先级被插件滥用导致内建安全处理失效** -> priority 使用有界整数并保留宿主 system 区间；安全校验不进入可被第三方取消的事件阶段。
- **生命周期回滚仍无法清理插件绕开 Component 创建的全局资源** -> 文档将其定义为插件 bug；testkit 做 listener/timer/registration 泄漏检查。强隔离不在本阶段承诺。
- **公共 API 面过大，形成大量无行为空壳** -> capability 分包、支持级别矩阵和按 reference plugin 驱动的阶段发布；缺失功能明确 deferred/unsupported。
- **旧 `NexusPlugin` 与新 `NexusPluginBase` 命名接近，调用方容易混用** -> 文档持续使用 contribution/plugin instance 两个术语；类型不继承、导出名不同，并提供编译期迁移示例。
- **Vault 从绝对路径迁移到 relative path 可能引入身份与链接错误** -> 公共 API 只允许规范 relative path，绝对路径封装在 Electron adapter；rename 事件携带 oldPath 并保持文件对象身份。
- **文件 watch、插件写入、自动保存和 metadata rebuild 形成事件风暴** -> Vault event 带 origin/operation id，宿主去重并批处理；cache 根据文件版本丢弃过期结果。
- **现有 UI 与新 UI slot 同时装载造成重复元素和 listener** -> reference plugin 迁移使用 feature flag/单一 owner；adapter 激活时禁止同功能的旧手工 factory 重复挂载。
- **React/Vue 重挂载导致插件重复 load** -> 应用 runtime 默认由 Provider/宿主拥有，组件只 attach editor；owned 模式必须显式选择并有 Strict Mode 测试。
- **manifest 权限给用户错误的安全感** -> UI 明确标记第一阶段为 trusted plugin 模型；权限是能力治理，不宣称同 realm 隔离。
- **typed IPC 仍可能被受损 renderer 滥用** -> 主进程独立验证 sender、session、schema 与 Vault 边界；危险能力不通过通用 invoke 暴露。
- **与 Obsidian 相似的结构被误解为二进制/源码兼容** -> 不提供 namespace shim，文档同时展示支持级别、差异和固定参考 commit，unsupported 调用明确失败。

## Migration Plan

1. 先以新增包和 core 内部动态 sink 形式发布，不改变 `createEditor()` 和现有包装器默认路径。runtime 受 feature flag/显式构造控制。
2. 用 runtime testkit 验证内建 reference plugin，再让 Electron Demo 建立 `NexusApp` 及 host adapters；保留旧 boot 路径作为短期回退。
3. 将 Electron 现有 Vault/LinkIndex/UI 包装为 capability，先保持单 leaf 产品行为。公共插件只看到 relative path 和宿主服务。
4. 依次迁移 wordcount、toolbar/slash 等有手工 attach/destroy 的官方插件；每次迁移保留旧 factory 并增加新旧行为对照测试。
5. React/Vue 增加 runtime attach 入口，但不更改无 runtime 用户的 mount/unmount 契约。
6. 在至少一个发布周期内收集 compatibility diagnostic；只有动态 registry 和 adapter 覆盖稳定后才标记旧模式 deprecated。
7. 数据迁移按 plugin id 分区并保留旧 key；成功写入新 schema 后再更新版本指针，不删除无法识别的数据。

回滚策略：关闭 runtime feature flag，恢复 Electron 旧 boot/EditorShell 路径，并继续通过现有 `createEditor({ plugins })` 启动。动态 API 的新增 core 原语是惰性的，不启用 runtime 时不影响编辑器。插件数据采用向前新增目录/schema，不需要破坏性回滚；失败版本可禁用对应 plugin manifest 而不修改用户文档。

## Open Questions

- 当 Web 或第二个桌面宿主出现后，是否把 Workspace 的共享实现从 runtime 抽成独立 `@floatboat/nexus-workspace` 包？当前接口边界允许以后移动而不改变插件 API。
- Electron 的完整 MetadataCache 最终在 renderer Worker 还是独立 utility process 中运行？两种实现都应隐藏在同一 capability 后。
- 未来若支持不可信市场插件，优先采用 Worker + 受限 UI bridge、Electron isolated world 还是独立进程？该选择会决定同步 DOM 事件 hook 可保留到什么程度。
- API 进入 `1.0` 后，两个 minor 的默认弃用窗口是否需要扩大到固定时间窗口？这属于发布政策，不改变当前类型和运行时设计。
