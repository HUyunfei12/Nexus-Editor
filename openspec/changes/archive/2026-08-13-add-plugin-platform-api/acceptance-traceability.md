# 插件平台 API 验收追踪

## 1. 文档用途与判定规则

本文是 OpenSpec change `add-plugin-platform-api` 的验收追踪 artifact，对六份 capability spec 的每个 Requirement 和 Scenario 建立实现、自动化测试或验证命令映射。它不替代各 capability spec，也不以任务勾选状态代替运行证据。

状态含义：

- **已验证**：存在直接覆盖该场景的自动化测试，并且本文第 10 节记录的定向命令已通过。
- **组合验证**：场景由相邻的契约测试共同覆盖，没有以完全相同场景名存在的单一测试；本文只在证据能闭合全部断言时使用该状态。
- **条件支持**：接口和宿主缺失时的行为已验证，但能力本身是 optional，当前宿主未声明提供对应后端。

路径均相对于仓库根目录。测试引用格式为 `证据别名 :: "测试名称"`。

## 2. 证据索引

| 别名 | 具体文件 |
|---|---|
| `API` | `packages/plugin-api/test/public-api.test.ts` |
| `CAP` | `packages/plugin-runtime/test/capability.test.ts` |
| `LIFE` | `packages/plugin-runtime/test/lifecycle.test.ts` |
| `PM` | `packages/plugin-runtime/test/plugin-manager.test.ts` |
| `LOADER` | `packages/plugin-runtime/test/loader.test.ts` |
| `MANIFEST` | `packages/plugin-runtime/test/manifest.test.ts` |
| `UPGRADE` | `packages/plugin-runtime/test/manifest-upgrade.test.ts` |
| `COMMAND` | `packages/plugin-runtime/test/command-registry.test.ts` |
| `HOTKEY` | `packages/plugin-runtime/test/hotkey-scope.test.ts` |
| `EVENT` | `packages/plugin-runtime/test/typed-event-registry.test.ts` |
| `EDITOR-HOST` | `packages/plugin-runtime/test/editor-host-registry.test.ts` |
| `CLIPBOARD` | `packages/plugin-runtime/test/clipboard-pipeline.test.ts` |
| `MARKDOWN` | `packages/plugin-runtime/test/markdown-registries.test.ts` |
| `CONTENT` | `packages/plugin-runtime/test/content-services.test.ts` |
| `STORAGE` | `packages/plugin-runtime/test/storage.test.ts` |
| `LEGACY` | `packages/plugin-runtime/test/legacy-adapter.test.ts` |
| `WORKSPACE-UI` | `packages/plugin-runtime/test/workspace-ui.test.ts` |
| `CORE-DOM` | `packages/core/test/dynamic-contributions.test.ts` |
| `CORE-TX` | `packages/core/test/transaction-pipeline.test.ts` |
| `REFERENCE` | `packages/reference-plugins/test/obsidian-sample-port.test.ts` |
| `REFERENCE-LIFE` | `packages/reference-plugins/test/lifecycle-reference-plugins.test.ts` |
| `ELECTRON-IPC` | `apps/electron-demo/test/plugin-ipc.test.ts` |
| `ELECTRON-BROKER` | `apps/electron-demo/test/plugin-host-broker.test.ts` |
| `ELECTRON-HOST` | `apps/electron-demo/test/plugin-runtime-host.test.ts` |
| `ELECTRON-PRODUCT` | `apps/electron-demo/test/runtime-product-ui-adapter.test.ts` |
| `ELECTRON-APP` | `apps/electron-demo/test/app-runtime-integration.test.ts` |
| `ELECTRON-WINDOW` | `apps/electron-demo/test/window-registry.test.ts` |
| `ELECTRON-MAIN` | `apps/electron-demo/test/electron-main-window-host.test.ts` |
| `ELECTRON-SMOKE` | `apps/electron-demo/scripts/electron-multi-window-smoke-main.cjs`、`apps/electron-demo/scripts/electron-multi-window-smoke-renderer.ts` |

## 3. 当前支持矩阵

| Capability spec | 宿主无关合同/runtime | Electron Demo | 验收结论 |
|---|---|---|---|
| `plugin-runtime` | 生命周期、owner tree、回滚、诊断均有直接测试 | 单一 runtime owner、关机顺序已有集成证据 | **已验证** |
| `plugin-commands-events` | 命令、hotkey、Scope、typed/cancelable event 均有直接测试 | renderer 已把真实 DOM 输入接入 runtime | **已验证** |
| `plugin-editor-extensions` | CM6、DOM/clipboard、transaction、Markdown registry 均有直接测试 | editor attach/detach 与安全点已有集成证据 | **已验证** |
| `plugin-manifest-compatibility` | manifest、预检、权限、storage、legacy、迁移 fixture 均有测试；安全 Secret 后端为 optional | 普通 storage 已接入；未声明 `secrets` 时明确 unsupported | **已验证/条件支持** |
| `plugin-content-services` | 内存/宿主无关 Vault、FileManager、Metadata、resource URL 合同有直接测试 | CRUD/watch/trash、Metadata/LinkIndex、资源 URL 与产品 CRUD 已贯通 runtime owner；普通 CRUD 有授权后路径替换竞态测试 | **已验证** |
| `plugin-workspace-ui` | Workspace、Menu、Modal、Notice、Setting、slots、安全与可访问性合同有直接测试 | 五类 slot、settings、outline/backlinks、菜单均由 runtime owner 管理；外链授权已闭合，真实 Electron 三窗口 smoke 已验证 | **已验证** |

当前 Electron 验收边界：

- **12.4（已闭合）**：`ELECTRON-HOST :: "publishes watcher CRUD through Vault, metadata, then the renderer using relative paths"`、`ELECTRON-HOST :: "waits for a durable write before exposing metadata and renderer backlinks"`、`ELECTRON-HOST :: "migrates an unresolved link after its target is durably created"`、`ELECTRON-HOST :: "moves a file and rewrites links before a queued Vault switch can start"` 与 `ELECTRON-HOST :: "routes host-owned product CRUD through relative durable operations"` 分别闭合 watcher 顺序、durable backlinks、链接解析迁移、移动重写及产品 CRUD；`ELECTRON-BROKER` 的 read/write/rename/trash 授权后 symlink/parent replacement 测试验证普通 CRUD 的 fail-closed 路径租约。
- **12.6（已闭合）**：`ELECTRON-PRODUCT :: "owns product views through sidebar leaves without replacing the primary Markdown leaf"` 与 `ELECTRON-PRODUCT :: "routes settings and file menus through owner-bound RuntimeUiHost registries"` 验证 outline/backlinks view、settings 与文件菜单都由 owner-bound Workspace/UI registration 管理；`ELECTRON-APP :: "keeps the legacy path as the default and shuts it down once"`、`ELECTRON-APP :: "boots one runtime owner, synchronizes relative file context, and preserves slot DOM"` 验证 legacy/runtime 二选一、runtime 单一 owner 以及关闭后零重复 UI。
- **12.7（已闭合）**：资源 URL 的 sender/session 绑定与句柄读取、HTTPS 与 `mailto:` 的独立声明和授权、generic system shell 的 optional `unsupported` 结果均已有 `ELECTRON-BROKER`/`ELECTRON-HOST`/`ELECTRON-IPC` 证据。`ELECTRON-WINDOW` 与 `ELECTRON-MAIN` 验证 registry/main 路由；`ELECTRON-SMOKE` 在真实 Electron 进程中同时创建 primary、secondary 和 renderer popup 三个 `BrowserWindow`，验证 View 从 secondary 迁移到 popup、旧/新窗口监听切换、popup 内 menu/modal/status/focus、窗口独立关闭与 owner 清理。该 smoke 是复用正式 runtime Workspace/UI 实现的独立 harness，不直接启动产品 `electron/main.ts`，因此证明的是跨窗口 runtime/BrowserWindow 边界，而不是完整产品启动路径。

## 4. `plugin-runtime` 追踪

规范：`specs/plugin-runtime/spec.md`。共 7 个 Requirement、20 个 Scenario。

### 4.1 宿主应用门面与能力发现

实现：`packages/plugin-api/src/app.ts`、`packages/plugin-api/src/capability.ts`、`packages/plugin-api/src/tokens.ts`、`packages/plugin-runtime/src/capability.ts`、`packages/plugin-runtime/src/compatibility.ts`、`packages/plugin-runtime/src/loader.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 所需能力全部满足 | 已验证 | `CAP :: "creates owner-bound facades and stages their resources in the plugin lifecycle"`；`API :: "exposes the injected app, manifest, and immutable identity reference"` |
| 必需能力缺失 | 已验证 | `LOADER :: "rejects a missing required capability before entry execution but records optional degradation"` |
| 可选能力缺失 | 已验证 | `LOADER :: "rejects a missing required capability before entry execution but records optional degradation"`；`CAP :: "distinguishes permission denial from an unsupported capability"` |

### 4.2 插件生命周期状态机

实现：`packages/plugin-runtime/src/lifecycle/component-controller.ts`、`packages/plugin-runtime/src/plugin-manager.ts`、`packages/plugin-runtime/src/lifecycle/errors.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 正常加载与卸载 | 已验证 | `LIFE :: "stages resources until the entire component tree has loaded"`；`PM :: "does not expose a plugin until staged resources activate"` |
| 加载期间收到卸载请求 | 已验证 | `PM :: "serializes disable requested during loading"` |
| 尝试重新加载终态实例 | 已验证 | `PM :: "shares repeated disable results and creates a new instance on re-enable"`；`LIFE :: "shares concurrent unload, continues after cleanup errors, and ends unloaded"` |

### 4.3 Component 单一所有者树

实现：`packages/plugin-api/src/component.ts`、`packages/plugin-runtime/src/lifecycle/component-controller.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 在父组件加载前添加子组件 | 已验证 | `LIFE :: "loads children in insertion order and unloads child hooks in reverse order"` |
| 向已加载父组件添加和移除子组件 | 已验证 | `LIFE :: "loads and unloads children added to an already loaded parent"` |
| 父组件级联卸载 | 已验证 | `LIFE :: "loads children in insertion order and unloads child hooks in reverse order"`；`LIFE :: "cleans resources and child subtrees in reverse acquisition order"` |
| 非法所有权关系 | 已验证 | `LIFE :: "rejects second owners, self ownership and ownership cycles atomically"` |

### 4.4 统一资源注册与自动清理

实现：`packages/plugin-api/src/component.ts`、`packages/plugin-runtime/src/lifecycle/component-controller.ts`、`packages/plugin-runtime/src/lifecycle/registration.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 按依赖逆序清理资源 | 已验证 | `LIFE :: "cleans resources and child subtrees in reverse acquisition order"`；`LIFE :: "quiesces DOM callbacks before onunload and clears timers"` |
| 登记后主动释放资源 | 已验证 | `LIFE :: "supports active disposal and waits for async disposal exactly once"` |
| 在清理阶段登记新资源 | 已验证 | `LIFE :: "immediately disposes late registrations and waits for ones created by onunload"` |

### 4.5 加载失败的原子回滚

实现：`packages/plugin-runtime/src/lifecycle/component-controller.ts`、`packages/plugin-runtime/src/plugin-manager.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 插件加载钩子失败 | 已验证 | `LIFE :: "atomically rolls back failures without calling onunload"`；`PM :: "releases loader-owned handles after load failure without calling onunload"` |
| 子组件加载失败 | 已验证 | `LIFE :: "atomically rolls back failures without calling onunload"` |
| 回滚操作自身失败 | 已验证 | `LIFE :: "atomically rolls back failures without calling onunload"` |

### 4.6 幂等且完备的卸载

实现：`packages/plugin-runtime/src/lifecycle/component-controller.ts`、`packages/plugin-runtime/src/plugin-manager.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 重复并发卸载 | 已验证 | `LIFE :: "shares concurrent unload, continues after cleanup errors, and ends unloaded"`；`LIFE :: "shares the active unload promise with synchronous reentrant calls"` |
| 卸载钩子抛错 | 已验证 | `LIFE :: "shares concurrent unload, continues after cleanup errors, and ends unloaded"` |

### 4.7 插件隔离与结构化诊断

实现：`packages/plugin-api/src/diagnostics.ts`、`packages/plugin-runtime/src/diagnostics.ts`、`packages/plugin-runtime/src/plugin-manager.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 一个插件加载失败但其他插件正常 | 已验证 | `PM :: "isolates enableAll failures and reports sanitized diagnostics"`；`PM :: "rejects incompatible plugins before entry execution and isolates other plugins"` |
| 插件运行期回调越界失败 | 已验证 | `PM :: "isolates enableAll failures and reports sanitized diagnostics"`；`EDITOR-HOST :: "uses owner-bound staged subscriptions and isolates callback failures"` |

## 5. `plugin-commands-events` 追踪

规范：`specs/plugin-commands-events/spec.md`。共 11 个 Requirement、32 个 Scenario。

### 5.1 命令命名空间与动态所有权

实现：`packages/plugin-runtime/src/commands/command-registry.ts`、`packages/plugin-runtime/src/commands/hotkey-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 注册插件命令 | 已验证 | `COMMAND :: "publishes one atomic namespaced snapshot and preserves other plugins"` |
| 同一插件注册重复命令 | 已验证 | `COMMAND :: "publishes one atomic namespaced snapshot and preserves other plugins"` |
| 命令所有者卸载 | 已验证 | `COMMAND :: "publishes one atomic namespaced snapshot and preserves other plugins"`；`HOTKEY :: "persists custom, cleared and restored preferences across command reload"` |

### 5.2 命令执行模式必须唯一

实现：`packages/plugin-api/src/commands.ts`、`packages/plugin-runtime/src/commands/command-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 同时声明多个回调 | 已验证 | `COMMAND :: "rejects definitions with zero or multiple execution modes before publication"` |
| 声明恰好一个执行模式 | 已验证 | `COMMAND :: "rejects definitions with zero or multiple execution modes before publication"` |

### 5.3 无副作用的命令可用性探测

实现：`packages/plugin-runtime/src/commands/command-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 命令面板探测条件命令 | 已验证 | `COMMAND :: "probes without action and revalidates changed state at execution"` |
| 状态在探测后发生变化 | 已验证 | `COMMAND :: "probes without action and revalidates changed state at execution"` |
| 可用性探测抛错 | 已验证 | `COMMAND :: "isolates probe and command callback failures"` |

### 5.4 编辑器命令使用执行时上下文

实现：`packages/plugin-runtime/src/commands/command-registry.ts`、`packages/plugin-runtime/src/editor-host-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 活动编辑器存在 | 已验证 | `COMMAND :: "resolves editor context for every probe and trigger and handles no editor"` |
| 没有活动编辑器 | 已验证 | `COMMAND :: "resolves editor context for every probe and trigger and handles no editor"` |

### 5.5 用户快捷键覆盖与 Mod 规范化

实现：`packages/plugin-runtime/src/commands/hotkey-normalization.ts`、`packages/plugin-runtime/src/commands/hotkey-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 用户覆盖默认快捷键 | 已验证 | `HOTKEY :: "persists custom, cleared and restored preferences across command reload"` |
| 跨平台解析 Mod | 已验证 | `HOTKEY :: "normalizes Mod and key aliases consistently across platforms"`；`HOTKEY :: "synchronously consumes a unique command hotkey without fabricating clipboard events"` |
| 用户清除快捷键 | 已验证 | `HOTKEY :: "persists custom, cleared and restored preferences across command reload"` |

### 5.6 Scope 栈与快捷键冲突仲裁

实现：`packages/plugin-runtime/src/commands/scope-registry.ts`、`packages/plugin-runtime/src/commands/hotkey-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 临时作用域遮蔽全局绑定 | 已验证 | `HOTKEY :: "walks top scope through parents and application, then auto-pops on quiesce"` |
| 顶层作用域拒绝处理 | 已验证 | `HOTKEY :: "walks top scope through parents and application, then auto-pops on quiesce"` |
| 同一优先级存在冲突 | 已验证 | `HOTKEY :: "reports same-priority conflicts without invoking either handler"`；`HOTKEY :: "diagnoses equally ranked conflicts instead of using registration order"` |
| 作用域所有者被卸载 | 已验证 | `HOTKEY :: "walks top scope through parents and application, then auto-pops on quiesce"` |

### 5.7 类型化事件与可释放订阅

实现：`packages/plugin-api/src/events.ts`、`packages/plugin-runtime/src/events/typed-event-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 订阅类型化事件 | 已验证 | `EVENT :: "keeps staged handlers hidden and dispatches by priority then stable order"` |
| 重复释放订阅 | 已验证 | `EVENT :: "uses a dispatch snapshot while honoring disposal before a handler turn"` |
| 订阅未知事件 | 已验证 | `EVENT :: "rejects unknown channels and invalid payloads with contract diagnostics"` |

### 5.8 通知事件与可取消 DOM 事件语义分离

实现：`packages/plugin-runtime/src/events/typed-event-registry.ts`、`packages/core/src/dynamic-contributions.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 普通通知事件处理器返回值 | 已验证 | `EVENT :: "ignores notification return values and isolates sync and async failures"` |
| 插件接管真实粘贴事件 | 已验证 | `EVENT :: "broadcasts synchronously after preventDefault and only returns the final sync state"`；`CORE-DOM :: "orders DOM hooks by priority and keeps post-consume observers read-only"` |
| 异步代码尝试取消默认行为 | 已验证 | `EVENT :: "does not treat return values, promises or exceptions as cancellation"` |
| 通过菜单触发剪贴板操作 | 已验证 | `CORE-DOM :: "installs one root dispatcher for each supported real DOM event"`；`CORE-DOM :: "does not infer a paste event from Ctrl/Cmd+V"` |

### 5.9 确定性事件优先级与分发快照

实现：`packages/plugin-runtime/src/events/typed-event-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 按优先级分发事件 | 已验证 | `EVENT :: "keeps staged handlers hidden and dispatches by priority then stable order"` |
| 分发期间修改订阅集合 | 已验证 | `EVENT :: "uses a dispatch snapshot while honoring disposal before a handler turn"` |

### 5.10 事件重入与异常隔离

实现：`packages/plugin-runtime/src/events/typed-event-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 处理器重入发射同一事件 | 已验证 | `EVENT :: "queues same-channel reentry in FIFO order without recursive handler entry"` |
| 重入超过分发预算 | 已验证 | `EVENT :: "bounds reentry, attributes it to the source owner and leaves other channels usable"` |
| 通知处理器抛错 | 已验证 | `EVENT :: "ignores notification return values and isolates sync and async failures"` |
| 可取消事件处理器抛错 | 已验证 | `EVENT :: "does not treat return values, promises or exceptions as cancellation"` |

### 5.11 命令与快捷键执行错误隔离

实现：`packages/plugin-runtime/src/commands/command-registry.ts`、`packages/plugin-runtime/src/commands/scope-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 命令回调失败 | 已验证 | `COMMAND :: "isolates probe and command callback failures"` |
| Scope 处理器执行中抛错 | 已验证 | `HOTKEY :: "treats a throwing selected handler as consumed and keeps the stack usable"` |

## 6. `plugin-editor-extensions` 追踪

规范：`specs/plugin-editor-extensions/spec.md`。共 11 个 Requirement、20 个 Scenario。

### 6.1 每个回调必须携带其真实编辑器上下文

实现：`packages/plugin-api/src/editor.ts`、`packages/plugin-runtime/src/editor-host-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 两个编辑器同时打开同一文件 | 已验证 | `EDITOR-HOST :: "atomically re-evaluates matches and refreshes callback context on context changes"`；`EDITOR-HOST :: "uses owner-bound staged subscriptions and isolates callback failures"` |
| 事件来自无文件的嵌入式编辑器 | 已验证 | `EDITOR-HOST :: "assigns stable instance ids and preserves nullable per-editor context"` |

### 6.2 CodeMirror 6 扩展必须支持动态注册与撤销

实现：`packages/core/src/dynamic-contributions.ts`、`packages/plugin-runtime/src/editor-host-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 已打开编辑器上启用扩展 | 已验证 | `EDITOR-HOST :: "keeps staged contributions invisible, then installs them on current and future editors"`；`CORE-DOM :: "installs and removes owner-scoped CM6 extensions without replacing the view"` |
| 撤销按上下文创建的扩展 | 已验证 | `EDITOR-HOST :: "atomically re-evaluates matches and refreshes callback context on context changes"`；`CORE-DOM :: "installs and removes owner-scoped CM6 extensions without replacing the view"` |

### 6.3 编辑器 DOM 输入钩子必须覆盖真实浏览器事件

实现：`packages/core/src/dynamic-contributions.ts`、`packages/plugin-api/src/editor.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 菜单触发粘贴而没有快捷键 | 已验证 | `CORE-DOM :: "installs one root dispatcher for each supported real DOM event"`；`CORE-DOM :: "does not infer a paste event from Ctrl/Cmd+V"`；`ELECTRON-HOST :: "wires editor-scoped clipboard filters to real DOM events and leaves secrets unsupported"` 直接派发 `paste` 与 `beforeinput`。 |
| 复制与剪切分别派发 | 已验证 | `CORE-DOM :: "installs one root dispatcher for each supported real DOM event"`；`CLIPBOARD :: "does not delete a cut source when browser writing is denied"`；`ELECTRON-HOST :: "wires editor-scoped clipboard filters to real DOM events and leaves secrets unsupported"` 验证 Electron host 的 `copy`/`cut` 写回及失败保留来源。 |

### 6.4 DOM 钩子顺序与消费语义必须确定

实现：`packages/core/src/dynamic-contributions.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 高优先级插件消费粘贴 | 已验证 | `CORE-DOM :: "orders DOM hooks by priority and keeps post-consume observers read-only"` |
| 处理器不消费事件 | 已验证 | `CORE-DOM :: "orders DOM hooks by priority and keeps post-consume observers read-only"` |

### 6.5 交互式 Widget 必须具有明确的输入边界

实现：`packages/core/src/dynamic-contributions.ts`、`packages/core/src/live-preview-table.ts`、`packages/plugin-api/src/editor.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 表格 contentEditable 单元格执行粘贴 | 已验证 | `CORE-DOM :: "recognizes widget surfaces even when CM6 ignores their events"`；`CORE-DOM :: "routes table range replacement through the table target instead of the CM6 selection"` |
| Widget 声明语义转发适配器 | 已验证 | `CORE-DOM :: "recognizes widget surfaces even when CM6 ignores their events"`；`CORE-DOM :: "routes table range replacement through the table target instead of the CM6 selection"` |

### 6.6 剪贴板过滤必须是结构化且同步的管线

实现：`packages/plugin-runtime/src/clipboard-pipeline.ts`、`packages/plugin-api/src/editor.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 只转换纯文本粘贴 | 已验证 | `CLIPBOARD :: "reads plain text, HTML, files, and custom MIME data without flattening"`；`CLIPBOARD :: "keeps untouched HTML, custom MIME, and files when only text changes"`；`ELECTRON-HOST :: "wires editor-scoped clipboard filters to real DOM events and leaves secrets unsupported"` 验证 editor-scoped provider 将转换结果写回真实 input target。 |
| 剪切写入失败 | 已验证 | `CLIPBOARD :: "does not delete a cut source when browser writing is denied"`；`CLIPBOARD :: "deletes a cut source exactly once only after a successful write"`；`ELECTRON-HOST :: "wires editor-scoped clipboard filters to real DOM events and leaves secrets unsupported"` 验证 Electron adapter 仅在写入成功后删除来源。 |

### 6.7 事务过滤与更新监听必须分离

实现：`packages/core/src/transaction-pipeline.ts`、`packages/plugin-api/src/editor.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 插件变换输入事务 | 已验证 | `CORE-TX :: "filters before commit and only notifies listeners with the final update"`；`CORE-TX :: "merges a sequential batch into one atomic CM6 transaction and one undo entry"` |
| 更新监听器发起后续事务 | 已验证 | `CORE-TX :: "allows listeners to identify their own follow-up origin"`；`CORE-TX :: "stops unbounded synchronous listener recursion with a diagnostic result"` |

### 6.8 Markdown 后处理器必须按渲染上下文运行

实现：`packages/plugin-runtime/src/markdown/post-processor-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 阅读模式片段被后处理 | 已验证 | `MARKDOWN :: "orders postprocessors and exposes source, frontmatter and section context"` |
| 异步结果已经过期 | 已验证 | `MARKDOWN :: "prevents stale async results from committing to a replacement generation"` |

### 6.9 围栏代码块处理器必须获得源码与通用渲染生命周期

实现：`packages/plugin-runtime/src/markdown/post-processor-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 注册 CSV 代码块处理器 | 已验证 | `MARKDOWN :: "falls back to default fenced code rendering after processor disposal"`；`MARKDOWN :: "reports a code block processor failure and commits only the default rendering"` |

### 6.10 Markdown 渲染子组件必须随其容器销毁

实现：`packages/plugin-runtime/src/markdown/post-processor-registry.ts`、`packages/plugin-api/src/component.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 文档编辑导致片段替换 | 已验证 | `MARKDOWN :: "cleans each render child timer and listener exactly once on rerender and detach"`；`MARKDOWN :: "waits for the previous render child to unload before starting a replacement generation"` |

### 6.11 插件卸载不得重建编辑器或丢失交互状态

实现：`packages/core/src/dynamic-contributions.ts`、`packages/plugin-runtime/src/editor-host-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 聚焦编辑器中禁用插件 | 已验证 | `CORE-DOM :: "preserves document, selection, and undo history across reconfiguration"`；`CORE-DOM :: "preserves multi-selection, fold, scroll, focus, history, and composed content"` |
| 输入法组合期间卸载 | 已验证 | `CORE-DOM :: "delays physical extension installation until IME composition ends"`；`CORE-DOM :: "preserves multi-selection, fold, scroll, focus, history, and composed content"` |

> 注：spec 实际包含 11 个 Requirement（标题 6.1 至 6.11），共 20 个 Scenario；本节数量以文件内容为准。

## 7. `plugin-content-services` 追踪

规范：`specs/plugin-content-services/spec.md`。共 11 个 Requirement、20 个 Scenario。宿主无关合同以及 Electron 的 Vault/FileManager/Metadata/resource 接入均有直接或组合自动化证据。

### 7.1 统一的文件与目录对象模型

实现：`packages/plugin-api/src/content.ts`、`packages/plugin-runtime/src/content/path-policy.ts`、`packages/plugin-runtime/src/content/vault-runtime.ts`、`apps/electron-demo/electron/plugin-host-broker.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 查询已有文件 | 已验证 | `CONTENT :: "preserves stable identity across rename and invalidates deleted references"`；`ELECTRON-BROKER :: "binds sessions to the authorized sender and exposes only relative paths"` |
| 拒绝越界路径 | 已验证 | `CONTENT :: "normalizes benign relative paths and lets host adapters reject symlink escapes"`；`ELECTRON-BROKER :: "rejects traversal and symlink escape for existing and new leaves"`；`ELECTRON-BROKER :: "rejects a read when the authorized leaf is swapped to an outside symlink before open"`、`"rejects a write when its authorized parent is swapped to an outside symlink"`、`"rejects a write when the authorized leaf is swapped to an outside symlink"`、`"rejects rename when its authorized source leaf is swapped to an outside symlink"`、`"rejects trash when its authorized leaf is swapped and never invokes the provider"` 与 `"rejects trash when its parent is swapped after authorization"` 覆盖授权后的 leaf/parent replacement。 |

### 7.2 稳定的文件身份与查找

实现：`packages/plugin-runtime/src/content/vault-runtime.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 重命名后已有引用继续指向同一文件 | 已验证 | `CONTENT :: "preserves stable identity across rename and invalidates deleted references"` |
| 删除后路径被重新创建 | 已验证 | `CONTENT :: "preserves stable identity across rename and invalidates deleted references"` |

### 7.3 文本与二进制内容读写

实现：`packages/plugin-runtime/src/content/vault-runtime.ts`、`apps/electron-demo/electron/plugin-host-broker.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 原子修改文本文件 | 已验证 | `CONTENT :: "supports text, binary, append, version checks, and snapshots input buffers"`；`ELECTRON-BROKER :: "performs atomic writes and rejects stale expected versions"`；write 使用 `O_CREAT|O_EXCL|O_NOFOLLOW` staging，并由 parent/leaf replacement 测试验证提交前后的身份复验。 |
| 检测并发写入冲突 | 已验证 | `CONTENT :: "supports text, binary, append, version checks, and snapshots input buffers"`；`ELECTRON-BROKER :: "performs atomic writes and rejects stale expected versions"` |
| 读取二进制附件 | 已验证 | `CONTENT :: "supports text, binary, append, version checks, and snapshots input buffers"` |

### 7.4 事务式内容处理

实现：`packages/plugin-runtime/src/content/vault-runtime.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 串行更新同一文件 | 已验证 | `CONTENT :: "serializes process calls and leaves content/version unchanged on failure"` |
| 转换失败回滚 | 已验证 | `CONTENT :: "serializes process calls and leaves content/version unchanged on failure"` |

### 7.5 可观察的文件生命周期事件

实现：`packages/plugin-runtime/src/content/vault-runtime.ts`、`apps/electron-demo/electron/plugin-host-broker.ts`、`apps/electron-demo/src/renderer/plugin-runtime-host.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 插件写入触发一次修改事件 | 已验证 | `CONTENT :: "emits typed origins once and deduplicates watcher echoes by operation ID"`；`ELECTRON-HOST :: "commits plugin writes only after durable IPC succeeds and coalesces its echo"` |
| 外部重命名被宿主确认 | 已验证 | `ELECTRON-BROKER :: "preserves external rename identity instead of degrading it to a rescan"`；`ELECTRON-HOST :: "publishes watcher CRUD through Vault, metadata, then the renderer using relative paths"` 直接验证外部 rename 按 Vault -> Metadata -> renderer 顺序发布。 |

### 7.6 语义化文件管理

实现：`packages/plugin-runtime/src/content/file-manager-runtime.ts`、`apps/electron-demo/electron/plugin-host-broker.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 移动文件并更新内部链接 | 已验证 | `CONTENT :: "moves files, updates resolvable wiki links, and defaults to recoverable trash"`；`ELECTRON-HOST :: "moves a file and rewrites links before a queued Vault switch can start"` 验证 durable rewrite、稳定文件身份及 renderer backlinks。 |
| 默认删除可恢复 | 已验证 | `CONTENT :: "moves files, updates resolvable wiki links, and defaults to recoverable trash"`；`ELECTRON-BROKER :: "does not emit delete success when trash fails and closes all sender resources"`；`ELECTRON-BROKER :: "isolates the authorized inode before invoking recoverable trash"` 及两条 trash replacement 测试验证安全 staging、provider 调用边界与身份匹配恢复。 |

Electron 普通 Vault CRUD 使用 `AuthorizedPathLease` 保存 canonical parent 的 `O_NOFOLLOW` 目录句柄以及 root/parent/leaf 的 `dev`/`ino`，并在敏感 syscall 前后复验。Node 当前没有基于 dirfd 的 `openat`/`renameat`/`unlinkat` API，所以路径型 rename/trash 在最后一次复验与 syscall 之间仍存在极窄的 OS 级竞态窗口；当前实现以 fail-closed 多重 barrier 和 inode postcondition 收敛风险。若威胁模型扩展到恶意本地并发进程且要求形式化 race-free，需要 native binding 或 Rust helper。

### 7.7 安全的 frontmatter 更新

实现：`packages/plugin-runtime/src/content/frontmatter.ts`、`packages/plugin-runtime/src/content/file-manager-runtime.ts`、`apps/electron-demo/src/renderer/plugin-runtime-host.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 修改 frontmatter 属性 | 已验证 | `CONTENT :: "serializes safe YAML frontmatter without changing the body"`；`CONTENT :: "publishes processFrontmatter as Vault modify then matching metadata changed"` 直接验证同一内容版本的事件顺序；`ELECTRON-HOST :: "hydrates empty folders and durably applies safe frontmatter without overwriting files"` 验证宿主持久化。 |
| 文件没有 frontmatter | 已验证 | `CONTENT :: "serializes safe YAML frontmatter without changing the body"`；`ELECTRON-HOST :: "hydrates empty folders and durably applies safe frontmatter without overwriting files"` |

### 7.8 元数据缓存与链接解析

实现：`packages/plugin-runtime/src/content/metadata-runtime.ts`、`apps/electron-demo/src/renderer/link-index.ts`、`apps/electron-demo/src/renderer/plugin-runtime-host.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 等待写入后的元数据 | 已验证 | `CONTENT :: "indexes versioned metadata and preserves modify -> changed -> resolved ordering"`；`ELECTRON-HOST :: "waits for a durable write before exposing metadata and renderer backlinks"` 验证 `waitForVersion` 与 renderer LinkIndex 在持久化完成后同步可见。 |
| 链接无法解析 | 已验证 | `CONTENT :: "migrates unresolved links after the target is created"`；`ELECTRON-HOST :: "migrates an unresolved link after its target is durably created"` 验证 Metadata 与 renderer 的 unresolved -> resolved/backlinks 迁移。 |

### 7.9 元数据事件的一致性顺序

实现：`packages/plugin-runtime/src/content/metadata-runtime.ts`、`packages/plugin-runtime/src/content/vault-runtime.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 观察文件修改与缓存更新 | 已验证 | `CONTENT :: "indexes versioned metadata and preserves modify -> changed -> resolved ordering"`；`CONTENT :: "publishes processFrontmatter as Vault modify then matching metadata changed"`；`ELECTRON-HOST :: "publishes watcher CRUD through Vault, metadata, then the renderer using relative paths"`；`ELECTRON-HOST :: "waits for a durable write before exposing metadata and renderer backlinks"`。 |

### 7.10 宿主管理的资源 URL

实现：`packages/plugin-runtime/src/content/resource-runtime.ts`、`apps/electron-demo/electron/plugin-host-broker.ts`、`apps/electron-demo/src/renderer/plugin-runtime-host.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 在插件 UI 中显示附件 | 已验证 | `CONTENT :: "creates opaque owner/window-bound URLs and revokes access on dispose"`；`ELECTRON-BROKER :: "reads an opaque resource URL through a verified handle and revokes it within its owning session"`、`"opens resource files nonblocking and compares bigint file identities"`、`"revalidates a resource path after a symlink swap"`、`"treats revocation during resource resolution as a barrier"`、`"treats revocation during handle reads as a return barrier"`、`"treats sender close during handle reads as a return barrier"`、`"rejects a resource whose path is replaced after the file handle opens"` 与 `"binds resource URLs to their sender and revokes them with the Vault session"` 验证 handle/inode、授权复验和撤销竞态；`ELECTRON-HOST :: "revokes IPC resource URLs on plugin disable"` 验证 runtime owner 清理。 |

### 7.11 内容能力可选且可替换

实现：`packages/plugin-runtime/src/capability.ts`、`packages/reference-plugins/src/obsidian-sample-port.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 浏览器宿主没有元数据索引 | 已验证 | `LOADER :: "rejects a missing required capability before entry execution but records optional degradation"`；`REFERENCE :: "loads headlessly when UI, workspace, Vault and storage are absent"` |

> 注：spec 实际包含 11 个 Requirement（标题 7.1 至 7.11），共 20 个 Scenario；本节数量以文件内容为准。

## 8. `plugin-manifest-compatibility` 追踪

规范：`specs/plugin-manifest-compatibility/spec.md`。共 12 个 Requirement、24 个 Scenario。

### 8.1 作者 manifest 与运行时 manifest 分离

实现：`packages/plugin-api/src/manifest.ts`、`packages/plugin-runtime/src/manifest.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 规范化有效 manifest | 已验证 | `MANIFEST :: "separates author fields from immutable host metadata"` |
| 未知字段前向兼容 | 已验证 | `MANIFEST :: "separates author fields from immutable host metadata"`；`LOADER :: "emits stable diagnostics for unknown, deprecated, and unsupported API declarations"` |

### 8.2 稳定且全局唯一的插件身份

实现：`packages/plugin-runtime/src/manifest.ts`、`packages/plugin-runtime/src/plugin-manager.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 重复插件 ID | 已验证 | `MANIFEST :: "reports normalized id conflicts with both host-controlled sources"`；`PM :: "discovers without executing an entrypoint and rejects duplicate normalized ids"` |
| 显示名称变更 | 已验证 | `UPGRADE :: "keeps hotkeys, storage and permission decisions by ID while exposing the new display name"` 以同一 ID 的两版 manifest、共享 hotkey preference、storage backend 与按 ID 的 permission 决策，直接验证新展示名生效且旧偏好延续。 |

### 8.3 独立的宿主版本与 API 版本协商

实现：`packages/plugin-runtime/src/compatibility.ts`、`packages/plugin-runtime/src/loader.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| API 基线过高 | 已验证 | `LOADER :: "rejects API-incompatible plugins before invoking the host entrypoint resolver"` |
| 宿主版本变化但 API 兼容 | 已验证 | `LOADER :: "keeps host/API compatibility independent from platform and capability preflight"` 直接证明 host version 与 API range 独立协商，且平台/capability 失败不会互相伪装。 |

### 8.4 平台与 capability 预检

实现：`packages/plugin-runtime/src/compatibility.ts`、`packages/plugin-runtime/src/loader.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 缺少必需能力 | 已验证 | `LOADER :: "rejects a missing required capability before entry execution but records optional degradation"`；`LOADER :: "keeps host/API compatibility independent from platform and capability preflight"` |
| 可选能力降级 | 已验证 | `LOADER :: "rejects a missing required capability before entry execution but records optional degradation"` |

### 8.5 权限与能力实现分离

实现：`packages/plugin-runtime/src/capability.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 文件能力存在但写权限被拒绝 | 已验证 | `CAP :: "distinguishes permission denial from an unsupported capability"` |
| 运行中撤销授权 | 已验证 | `CAP :: "revokes issued proxies, cached methods, and owned resources without affecting other capabilities"`；`CAP :: "revokes all issued handles when the host capability is withdrawn"` |

### 8.6 宿主控制插件包加载

实现：`packages/plugin-runtime/src/loader.ts`、`packages/plugin-api/src/app.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 加载本地受信插件包 | 已验证 | `LOADER :: "accepts only a default Nexus plugin constructor"` |
| 插件尝试请求未公开的宿主内部对象 | 已验证 | `PM :: "exposes only the NexusApp facade and diagnoses internal host capabilities as unsupported"` 直接验证插件上下文不含 `ipcRenderer`、`fs` 或 manager，且未知内部 capability 返回 `capability-unsupported`；`API :: "keeps the runtime export surface intentional"` 与 `pnpm check:api` 固定公共导出面。 |

### 8.7 隔离的插件私有数据

实现：`packages/plugin-runtime/src/storage.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 首次加载没有数据 | 已验证 | `STORAGE :: "returns null for first load and isolates plugin namespaces"` |
| 保存后修改原对象 | 已验证 | `STORAGE :: "snapshots save input and returns independent load values"` |
| 存储内容损坏 | 已验证 | `STORAGE :: "preserves corrupt source, emits a diagnostic, and does not replace it"`；`ELECTRON-BROKER :: "rejects path-like IDs and quarantines corrupt data"` |

### 8.8 设置迁移与外部变更

实现：`packages/plugin-runtime/src/storage.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 数据 schema 升级 | 已验证 | `STORAGE :: "runs migrations once and leaves old data intact when migration fails"` |
| 外部修改设置文件 | 已验证 | `STORAGE :: "invalidates cached data and notifies active subscribers on external change"` |

### 8.9 秘密数据与普通设置分离

实现：`packages/plugin-api/src/storage.ts`、`packages/plugin-runtime/src/storage.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 保存访问令牌 | 条件支持 | `STORAGE :: "returns explicit unsupported results without storing secret values"` 验证无安全后端时不回退普通 JSON；`ELECTRON-HOST :: "wires editor-scoped clipboard filters to real DOM events and leaves secrets unsupported"` 验证 optional 查询返回 `capability-unsupported`；`ELECTRON-HOST :: "rejects a required Secret capability before constructing the plugin"` 验证 required Secret 在入口构造前拒绝。当前 Electron 宿主不注册 `nexus.secrets`，因此没有伪称已验证平台安全持久化；若以后提供安全后端，必须另加成功写入与日志脱敏验收。 |

### 8.10 旧版声明式插件兼容适配

实现：`packages/plugin-runtime/src/legacy-adapter.ts`、`packages/core/src/types.ts`、`packages/core/src/editor.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 旧插件继续随编辑器创建 | 已验证 | `LEGACY :: "keeps the existing createEditor({ plugins }) static path source-compatible"` |
| 运行时托管旧插件贡献 | 已验证 | `LEGACY :: "stages every legacy contribution under one owner and removes them together"`；`LEGACY :: "rejects unavailable dynamic fields before publishing any supported field"` |

### 8.11 Nexus 原生 API 与 Obsidian 兼容边界

实现：`packages/reference-plugins/src/obsidian-sample-port.ts`、`docs/plugins/obsidian-migration.zh.md`、`docs/plugins/native-plugin-api.zh.md`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 移植官方 sample plugin | 已验证 | `REFERENCE :: "ports the sample commands, paste hook, ribbon, status, modal and settings UI"`；`REFERENCE :: "opens and closes the namespaced view and observes Vault create/modify until unload"` |
| 使用延后支持的 API | 已验证 | `LOADER :: "emits stable diagnostics for unknown, deprecated, and unsupported API declarations"`；`docs/plugins/obsidian-migration.zh.md` 的 `native/adapter/deferred/unsupported` 矩阵。 |

### 8.12 弃用与兼容诊断策略

实现：`packages/plugin-runtime/src/compatibility.ts`、`packages/plugin-runtime/src/loader.ts`、`packages/plugin-api/src/diagnostics.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 使用已弃用入口 | 已验证 | `LOADER :: "emits stable diagnostics for unknown, deprecated, and unsupported API declarations"` |
| 多个插件中仅一个不兼容 | 已验证 | `PM :: "rejects incompatible plugins before entry execution and isolates other plugins"` |

## 9. `plugin-workspace-ui` 追踪

规范：`specs/plugin-workspace-ui/spec.md`。共 15 个 Requirement、26 个 Scenario。宿主无关合同、Electron 产品层 owner 接入以及真实 Electron 跨窗口 smoke 均已验证。

Electron 产品 owner 证据：`ELECTRON-PRODUCT :: "owns product views through sidebar leaves without replacing the primary Markdown leaf"` 覆盖 outline/backlinks Workspace leaf；`ELECTRON-PRODUCT :: "routes settings and file menus through owner-bound RuntimeUiHost registries"` 覆盖 settings/menu registration；`ELECTRON-APP :: "boots one runtime owner, synchronizes relative file context, and preserves slot DOM"` 覆盖 runtime 模式下产品 CRUD、views、settings、menu 与 reference plugins 的单 owner 集成，并与 `ELECTRON-APP :: "keeps the legacy path as the default and shuts it down once"` 共同验证 legacy/runtime 二选一。

Electron 12.7 的非窗口部分：`ELECTRON-BROKER :: "allows HTTPS and mailto only when their independent permissions are granted"`、`ELECTRON-BROKER :: "keeps external navigation grants isolated between BrowserWindow senders"` 与 `ELECTRON-HOST :: "keeps HTTPS and mailto grants independent and revokes them on plugin disable"` 覆盖外部 URL/协议的独立授权及撤销；`ELECTRON-BROKER :: "reports generic system shell as unsupported and never grants it"` 明确验证 optional generic system shell 返回 `unsupported`，当前宿主不提供任意 shell 执行能力；`ELECTRON-IPC :: "keeps a closed, shared channel catalog"` 固定了三类权限标识。窗口部分由 `ELECTRON-SMOKE` 在真实 Electron 进程中验证；该独立 harness 复用正式 runtime 的 Workspace/UI 实现，但不直接启动产品 `electron/main.ts`。

### 9.1 工作区必须以 leaf 承载可注册的 view

实现：`packages/plugin-api/src/workspace.ts`、`packages/plugin-runtime/src/workspace/runtime-workspace.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 同一 view type 打开两次 | 已验证 | `WORKSPACE-UI :: "creates independent view instances and persists only durable view state"` |
| 恢复持久布局 | 已验证 | `WORKSPACE-UI :: "restores placeholders, recovers them after factory activation and applies unload policy"` |

### 9.2 活动上下文必须区分焦点、活动文件与最近编辑器

实现：`packages/plugin-runtime/src/workspace/runtime-workspace.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 侧栏获得焦点但主编辑器仍打开 | 已验证 | `WORKSPACE-UI :: "keeps focused leaf, active file and recent editor independent with typed events"` |
| 上下文菜单来自非活动 leaf | 已验证 | `WORKSPACE-UI :: "composes menu contributions in the source window and provides keyboard/focus semantics"` |

### 9.3 布局模型必须可查询、可保存且保持宿主中立

实现：`packages/plugin-runtime/src/workspace/runtime-workspace.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 宿主不支持分屏 | 已验证 | `WORKSPACE-UI :: "honors explicit placement, fallback, background focus and target window migration"` |
| 布局发生变化 | 已验证 | `WORKSPACE-UI :: "keeps focused leaf, active file and recent editor independent with typed events"`；`WORKSPACE-UI :: "honors explicit placement, fallback, background focus and target window migration"` |

### 9.4 打开、聚焦与导航必须显式表达目标

实现：`packages/plugin-runtime/src/workspace/runtime-workspace.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 在后台 tab 打开文件 | 已验证 | `WORKSPACE-UI :: "honors explicit placement, fallback, background focus and target window migration"` |
| 聚焦延迟加载的 view | 已验证 | `WORKSPACE-UI :: "honors explicit placement, fallback, background focus and target window migration"` |

### 9.5 所有 UI 必须使用目标 leaf 或元素所属的窗口

实现：`packages/plugin-runtime/src/workspace/runtime-workspace.ts`、`packages/plugin-runtime/src/ui/runtime-ui.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 在弹出窗口编辑器中打开菜单 | 已验证 | runtime：`WORKSPACE-UI :: "composes menu contributions in the source window and provides keyboard/focus semantics"`。进程边界：`ELECTRON-WINDOW :: "owns two simultaneous window contexts with independent session and shutdown state"`、`ELECTRON-MAIN :: "creates and routes two live BrowserWindows and shuts them down independently"`；`ELECTRON-SMOKE` 直接验证 popup `ownerDocument`、事件构造器、菜单坐标、DOM 隔离和焦点。 |
| View DOM 被迁移到新窗口 | 已验证 | runtime：`WORKSPACE-UI :: "honors explicit placement, fallback, background focus and target window migration"`。`ELECTRON-SMOKE` 直接验证 View 从 secondary Document 迁移至 popup Document、旧监听释放、新监听生效、源 DOM 移除及 cleanup 恰好一次。 |

### 9.6 Menu 必须是可组合、上下文明确的短生命周期 UI

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 编辑器上下文菜单组合多个插件项目 | 已验证 | `WORKSPACE-UI :: "composes menu contributions in the source window and provides keyboard/focus semantics"`；`ELECTRON-PRODUCT :: "routes settings and file menus through owner-bound RuntimeUiHost registries"` 验证产品项与插件项组合且后打开菜单接管同一窗口；`ELECTRON-APP :: "boots one runtime owner, synchronizes relative file context, and preserves slot DOM"` 验证旧菜单容器不再重复挂载。 |
| 菜单被键盘关闭 | 已验证 | `WORKSPACE-UI :: "composes menu contributions in the source window and provides keyboard/focus semantics"` |

### 9.7 Modal 必须提供受约束的焦点与清理生命周期

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 插件卸载时模态框仍打开 | 已验证 | `WORKSPACE-UI :: "traps modal focus, rolls back failed opens and owner cleanup closes exactly once"` |
| 模态框在第二窗口打开 | 已验证 | runtime：`WORKSPACE-UI :: "traps modal focus, rolls back failed opens and owner cleanup closes exactly once"`；`ELECTRON-SMOKE` 直接验证 popup modal 的 `ownerDocument`、焦点位于 modal 内、primary 关闭后仍存活以及 owner unload 后移除。 |

### 9.8 Notice 必须是非阻塞且可访问的瞬时反馈

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 重复保存通知被去重 | 已验证 | `WORKSPACE-UI :: "deduplicates accessible notices and degrades to structured headless logs"` |

### 9.9 设置页必须区分定义、显示与持久化

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`、`packages/plugin-runtime/src/storage.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 声明式设置验证失败 | 已验证 | `WORKSPACE-UI :: "validates declarative settings, reloads storage and clears each display scope"` |
| 设置页重复显示 | 已验证 | `WORKSPACE-UI :: "validates declarative settings, reloads storage and clears each display scope"`；`ELECTRON-PRODUCT :: "routes settings and file menus through owner-bound RuntimeUiHost registries"` 验证重复 display 原位刷新且 owner 销毁后不可再显示；`ELECTRON-APP :: "boots one runtime owner, synchronizes relative file context, and preserves slot DOM"` 验证产品 settings 单实例与关闭清理。 |

### 9.10 宿主 UI 贡献必须通过命名插槽注册

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`、`apps/electron-demo/src/renderer/app.ts`、`apps/electron-demo/src/renderer/plugin-runtime-host.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 移动宿主没有状态栏 | 已验证 | `WORKSPACE-UI :: "renders named slots, uses the unified command registry and preserves source editor context"`；`REFERENCE :: "loads headlessly when UI, workspace, Vault and storage are absent"` |
| 用户隐藏 ribbon 项 | 已验证 | `WORKSPACE-UI :: "keeps a user-hidden ribbon action hidden while its command remains available"` 直接验证宿主隐藏偏好优先于插件更新，且隐藏期间命令仍可执行。 |

### 9.11 命令面板必须消费统一命令注册表

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`、`packages/plugin-runtime/src/commands/command-registry.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 面板打开后活动 leaf 改变 | 已验证 | `WORKSPACE-UI :: "renders named slots, uses the unified command registry and preserves source editor context"` |

### 9.12 UI registration 必须自动清理并隔离插件所有权

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`、`packages/plugin-runtime/src/workspace/runtime-workspace.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 插件带打开 view 被禁用 | 已验证 | `WORKSPACE-UI :: "removes temporary UI and slot contributions through the component owner ledger"`；`WORKSPACE-UI :: "restores placeholders, recovers them after factory activation and applies unload policy"` |

### 9.13 无头宿主必须提供可探测的降级行为

实现：`packages/plugin-runtime/src/capability.ts`、`packages/plugin-runtime/src/ui/runtime-ui.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 插件在无头测试宿主加载 | 已验证 | `REFERENCE :: "loads headlessly when UI, workspace, Vault and storage are absent"`；`WORKSPACE-UI :: "deduplicates accessible notices and degrades to structured headless logs"` |
| 必需的 view 能力缺失 | 已验证 | `LOADER :: "rejects a missing required capability before entry execution but records optional degradation"` |

### 9.14 插件 UI 必须遵守安全边界

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`、`packages/plugin-api/src/ui.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| Notice 包含不可信 HTML | 已验证 | `WORKSPACE-UI :: "sanitizes HTML, denies unsafe URLs and rejects unnamed icon actions"` |

### 9.15 插件 UI 必须满足键盘与辅助技术可访问性

实现：`packages/plugin-runtime/src/ui/runtime-ui.ts`。

| Scenario | 状态 | 自动化证据 |
|---|---|---|
| 仅用键盘操作菜单和模态框 | 已验证 | `WORKSPACE-UI :: "composes menu contributions in the source window and provides keyboard/focus semantics"`；`WORKSPACE-UI :: "traps modal focus, rolls back failed opens and owner cleanup closes exactly once"` |
| 插件注册无名称图标动作 | 已验证 | `WORKSPACE-UI :: "sanitizes HTML, denies unsafe URLs and rejects unnamed icon actions"` |

> 注：spec 实际包含 15 个 Requirement（标题 9.1 至 9.15），共 26 个 Scenario；本节数量以文件内容为准。

## 10. 验证记录

### 10.1 定向 capability 验证

执行命令：

```sh
pnpm exec vitest run \
  packages/plugin-api/test/public-api.test.ts \
  packages/plugin-runtime/test/capability.test.ts \
  packages/plugin-runtime/test/lifecycle.test.ts \
  packages/plugin-runtime/test/plugin-manager.test.ts \
  packages/plugin-runtime/test/loader.test.ts \
  packages/plugin-runtime/test/manifest.test.ts \
  packages/plugin-runtime/test/manifest-upgrade.test.ts \
  packages/plugin-runtime/test/command-registry.test.ts \
  packages/plugin-runtime/test/hotkey-scope.test.ts \
  packages/plugin-runtime/test/typed-event-registry.test.ts \
  packages/plugin-runtime/test/editor-host-registry.test.ts \
  packages/plugin-runtime/test/clipboard-pipeline.test.ts \
  packages/plugin-runtime/test/markdown-registries.test.ts \
  packages/plugin-runtime/test/content-services.test.ts \
  packages/plugin-runtime/test/storage.test.ts \
  packages/plugin-runtime/test/legacy-adapter.test.ts \
  packages/plugin-runtime/test/workspace-ui.test.ts \
  packages/core/test/dynamic-contributions.test.ts \
  packages/core/test/transaction-pipeline.test.ts \
  packages/reference-plugins/test/obsidian-sample-port.test.ts \
  packages/reference-plugins/test/lifecycle-reference-plugins.test.ts \
  apps/electron-demo/test/plugin-ipc.test.ts \
  apps/electron-demo/test/plugin-host-broker.test.ts \
  apps/electron-demo/test/plugin-runtime-host.test.ts \
  apps/electron-demo/test/runtime-product-ui-adapter.test.ts \
  apps/electron-demo/test/app-runtime-integration.test.ts \
  apps/electron-demo/test/window-registry.test.ts \
  apps/electron-demo/test/electron-main-window-host.test.ts
```

结果（2026-08-13）：**通过**。最终全仓 `pnpm test` 为 68 个测试文件、898 个测试全部通过；上述定向测试都包含在全仓结果中。`pnpm check:api`、`pnpm typecheck`、`pnpm build` 和 `pnpm --filter @floatboat/nexus-electron-demo dist:dir` 均以状态 0 完成；Electron 目录包成功生成于 macOS arm64，使用 Electron 35.7.5。

真实 Electron 跨窗口命令：

```sh
pnpm --filter @floatboat/nexus-electron-demo smoke:multi-window
```

结果（2026-08-13）：**通过**，机器可读结果为 `ok: true`。smoke 同时创建三个真实 `BrowserWindow`，验证 View 从 secondary 迁移到 popup、旧监听释放与新监听生效、popup menu/modal/status/focus、owner unload 清理，以及窗口数量按 `3 -> 2 -> 1 -> 0` 收敛。运行环境为 Electron 35.7.5、macOS arm64。该命令运行独立 Electron harness，复用正式 runtime Workspace/UI 实现，但不直接启动产品 `electron/main.ts`。

### 10.2 OpenSpec 严格校验

执行命令：

```sh
openspec validate add-plugin-platform-api --strict
```

结果（2026-08-13）：**通过**，最终门禁输出为 `Change 'add-plugin-platform-api' is valid`。

### 10.3 Markdown 与路径检查

检查项：六份 spec 的 Requirement/Scenario 计数、本文对应 section/表格行计数、本文反引号内仓库路径是否存在、`git diff --check`。

结果（2026-08-13）：**通过**。六份 spec 合计 67 个 Requirement、142 个 Scenario；142 个 Scenario 在本文中各出现一次。反引号引用的仓库文件路径全部存在，引用的测试名称均能在对应测试文件中找到；最终 `git diff --check` 检查无输出并以状态 0 结束。

## 11. 最终验收结论

六份 capability spec 的 67 个 Requirement、142 个 Scenario 已完成逐项追踪。12.4 的 Vault/FileManager/Metadata/LinkIndex 事件链、12.6 的产品 settings、outline/backlinks、menu owner 迁移，以及 12.7 的 WindowContext、资源 URL、HTTPS/`mailto:` 独立授权和真实 Electron 跨窗口行为均已闭合；generic system shell 与 SecretStorage 是 optional 能力，当前 Electron 宿主以结构化 `unsupported` 明确降级，不属于缺失的强制后端。

第 10 节记录的公共 API、TypeScript、68 文件/898 测试、全仓 build、Electron `dist:dir`、真实三窗口 smoke、OpenSpec strict 和 diff-check 全部通过，因此 task 14.5 与 14.7 可以标记完成。
