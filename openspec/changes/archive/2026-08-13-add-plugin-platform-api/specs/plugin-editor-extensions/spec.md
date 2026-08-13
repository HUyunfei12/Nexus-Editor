## Purpose

本规范定义 Nexus 插件平台面向编辑器与 Markdown 渲染的稳定扩展契约：既允许插件使用宿主无关的编辑器、输入事件、剪贴板和事务 API，也保留显式的 CodeMirror 6 扩展入口；同时约束多编辑器上下文、交互式 Widget 边界、渲染子组件生命周期以及动态装卸行为，确保插件启停不会破坏文档、选区、历史记录或输入法状态。

## ADDED Requirements

### Requirement: 每个回调必须携带其真实编辑器上下文

运行时 MUST 为每个可编辑实例分配在该实例生命周期内稳定且唯一的 `editorId`，并向命令、事件、事务监听器和扩展工厂传入同一个 `EditorContext`。上下文 MUST 包含当前 `EditorAPI`、编辑器能力和宿主标识，并按实际情况提供可空的 `file`、`view`、`leaf` 与渲染表面信息；插件 MUST NOT 被要求从“当前活动编辑器”反查事件来源。嵌入式编辑器、临时编辑器和无文件编辑器 MUST 是合法上下文。

#### Scenario: 两个编辑器同时打开同一文件

- **WHEN** 同一文件在两个 leaf 中各有一个编辑器，并且用户只在第二个编辑器粘贴内容
- **THEN** 粘贴回调收到第二个编辑器的 `editorId` 和 `EditorAPI`
- **AND** 回调中的文件可以相同，但 view、leaf 和选区 MUST 对应第二个实例
- **AND** 第一个编辑器的选区与交互状态 MUST NOT 被当作事件上下文

#### Scenario: 事件来自无文件的嵌入式编辑器

- **WHEN** 编辑器存在于嵌入、画布或临时输入表面且没有对应文件或标准 Markdown View
- **THEN** 运行时仍 MUST 派发带有效 `EditorAPI` 的事件
- **AND** `file`、`view` 或 `leaf` MAY 为 `null`
- **AND** 插件仅在其声明需要这些上下文时才可拒绝处理

### Requirement: CodeMirror 6 扩展必须支持动态注册与撤销

运行时 MUST 提供动态 `registerEditorExtension`，接受 CM6 `Extension` 或按 `EditorContext` 创建扩展的工厂，并返回幂等的 registration/disposer。注册 MUST 作用于所有当前兼容编辑器以及之后创建的兼容编辑器；撤销 MUST 从所有实例移除该插件贡献。运行时 MUST 使用 CM6 支持的 reconfigure、compartment 或等价状态 effect 更新扩展集合，而不是销毁并重新创建 `EditorView`。插件可按上下文声明适用范围，且 MUST NOT 依赖未公开的 CM6 私有属性。

#### Scenario: 已打开编辑器上启用扩展

- **WHEN** 插件在两个已打开编辑器存在时动态注册一个 CM6 extension
- **THEN** 运行时 MUST 将扩展安装到两个匹配的编辑器
- **AND** 后续创建的匹配编辑器 MUST 在初始化时包含该扩展
- **AND** 任一编辑器实例身份、文档内容和历史记录 MUST 保持不变

#### Scenario: 撤销按上下文创建的扩展

- **WHEN** 插件卸载或显式 dispose 一个由工厂生成的 extension registration
- **THEN** 运行时 MUST 从每个编辑器移除对应工厂产物
- **AND** disposer 重复调用 MUST 不报错且不影响其他插件扩展
- **AND** 插件不得再收到该扩展产生的更新回调

### Requirement: 编辑器 DOM 输入钩子必须覆盖真实浏览器事件

运行时 MUST 为 `copy`、`cut`、`paste`、`beforeinput`、`drop`、`contextmenu` 和 `keydown` 提供类型化的编辑器根 DOM 钩子。回调 MUST 收到未经按键推断的原始浏览器事件与 `EditorEventContext`；例如粘贴只能由实际 `ClipboardEvent` 表示，`Ctrl/Cmd+V` 的 `keydown` MUST NOT 被伪装成粘贴事件。每个 registration MUST 可声明 capture/bubble 阶段、数值 priority 和适用表面，并可独立 dispose。

#### Scenario: 菜单触发粘贴而没有快捷键

- **WHEN** 用户通过系统菜单执行粘贴并产生 `ClipboardEvent`
- **THEN** `paste` 钩子 MUST 收到事件及其 `clipboardData`
- **AND** 即使没有发生 `keydown`，钩子也 MUST 正常运行
- **AND** 运行时 MUST NOT 合成一个虚假的快捷键事件

#### Scenario: 复制与剪切分别派发

- **WHEN** 浏览器先后产生 `copy` 与 `cut` 事件
- **THEN** 运行时 MUST 向对应类型的钩子分别派发原始事件
- **AND** 插件可读取当前表面选区并分别决定是否覆盖默认行为
- **AND** 单纯观察事件不得改变剪贴板或删除内容

### Requirement: DOM 钩子顺序与消费语义必须确定

同一事件阶段内，运行时 MUST 按 priority 从高到低、再按注册先后顺序执行钩子；capture 阶段 MUST 先于 bubble 阶段。钩子返回显式 `consume` 结果或调用 `preventDefault()` 后，运行时 MUST 将事件视为已处理、停止后续可消费处理器并跳过 Nexus 内置默认动作。只读 observer MUST 可选择在已消费后接收事件，但 MUST NOT 改变消费结果。异步 Promise MUST NOT 被允许决定需要同步完成的浏览器默认行为。

#### Scenario: 高优先级插件消费粘贴

- **WHEN** 高优先级 paste handler 返回 `consume`，低优先级 handler 与内置资源上传处理器也已注册
- **THEN** 运行时 MUST 阻止浏览器默认粘贴
- **AND** MUST NOT 调用低优先级可消费 handler 或内置资源上传处理器
- **AND** 声明为 post-consume observer 的监听器 MAY 收到只读通知

#### Scenario: 处理器不消费事件

- **WHEN** 所有匹配 handler 均返回 pass 且没有调用 `preventDefault()`
- **THEN** 运行时 MUST 继续执行后续插件和内置默认动作
- **AND** 若仍无人处理，浏览器或 CM6 的默认行为 MUST 保持可用

### Requirement: 交互式 Widget 必须具有明确的输入边界

`WidgetDefinition.ignoreEvents` MUST 仅表示 CM6 不解释 Widget 后代 DOM 事件，不得隐式关闭 Nexus 编辑器根的 capture 钩子。源自 Widget 的事件上下文 MUST 标记 `surface = "widget"`、Widget 标识和实际 editable target；宿主 MUST NOT 假设 `EditorAPI` 的 Markdown 选区等同于 Widget 内部的原生 DOM 选区。Widget MUST 负责内部编辑状态的提交、撤销语义和可选的语义事件转发，运行时 MUST NOT 通过向 CM6 重放按键来模拟这些行为。

#### Scenario: 表格 contentEditable 单元格执行粘贴

- **WHEN** 表格 Widget 使用 `ignoreEvents` 且焦点位于其 `contentEditable` 单元格内
- **THEN** 编辑器根 capture paste hook MUST 仍可观察或消费真实 `ClipboardEvent`
- **AND** 上下文 MUST 指明事件目标是 Widget 单元格而非 CM6 内容 DOM
- **AND** 若事件未消费，单元格的原生或 Widget 自定义粘贴流程 MUST 继续执行
- **AND** 运行时 MUST NOT 自动把内容插入 Markdown 主选区

#### Scenario: Widget 声明语义转发适配器

- **WHEN** Widget 注册自己的 editable-surface adapter 并将内部变更提交为一个宿主事务
- **THEN** 插件可通过该 adapter 获取 Widget 选区与替换能力
- **AND** 提交后的编辑器更新 MUST 标注 Widget 来源
- **AND** adapter 销毁后运行时 MUST 停止向它派发事件

### Requirement: 剪贴板过滤必须是结构化且同步的管线

运行时 MUST 提供针对 incoming paste/drop 与 outgoing copy/cut 的同步 clipboard filter 管线。过滤输入 MUST 区分 `text/plain`、`text/html`、文件及其他 MIME 项，并携带目标表面和来源上下文；过滤器 MUST 能 pass、拒绝或返回替换后的结构化 payload，且不得因只处理文本而静默丢弃未声明处理的文件或 MIME 数据。若浏览器安全模型不允许写入请求格式，运行时 MUST 报告可诊断的降级结果。剪切只有在剪贴板写入成功后才可删除源内容。

#### Scenario: 只转换纯文本粘贴

- **WHEN** 一个 paste payload 同时包含纯文本、HTML 和图片文件，而过滤器只替换 `text/plain`
- **THEN** 后续管线 MUST 收到替换后的纯文本
- **AND** HTML 与图片文件 MUST 原样保留，除非另一个过滤器显式处理它们
- **AND** 最终写入必须遵循目标 surface adapter 的插入规则

#### Scenario: 剪切写入失败

- **WHEN** 插件接管 cut 但浏览器拒绝其剪贴板写入
- **THEN** 运行时 MUST 保留原选区内容
- **AND** MUST 向处理器返回失败原因或触发可诊断事件
- **AND** 不得报告剪切成功

### Requirement: 事务过滤与更新监听必须分离

运行时 MUST 区分应用前的事务过滤器和提交后的只读更新监听器。标准事务上下文 MUST 包含变更集、前后选区、origin/user-event、目标 `editorId` 以及可选文件/view 信息；过滤器 MUST 能放行、拒绝或同步变换事务，更新监听器 MUST 看到最终已提交状态且不得修改已发生的更新。批量事务 MUST 作为一个原子提交通知，插件自身产生的事务 MUST 可通过稳定 origin 避免递归。低层 CM6 插件仍可接收原生 `Transaction`/`ViewUpdate`，但这是显式的 CM6 能力而不是稳定跨编辑器抽象。

#### Scenario: 插件变换输入事务

- **WHEN** 事务过滤器把一次用户文本输入变换为另一个 changeset
- **THEN** 编辑器 MUST 原子应用变换后的 changeset
- **AND** 更新监听器 MUST 只收到最终提交结果及原始 origin 链
- **AND** 撤销历史 MUST 将该提交视为一个符合宿主策略的操作

#### Scenario: 更新监听器发起后续事务

- **WHEN** 更新监听器使用自己的稳定 origin 发起格式化事务
- **THEN** 后续事务 MUST 独立进入过滤与更新管线
- **AND** 插件 MUST 能根据 origin 忽略自己的后续通知
- **AND** 运行时 MUST 防止无界同步递归并给出诊断

### Requirement: Markdown 后处理器必须按渲染上下文运行

运行时 MUST 支持带稳定 registration 的 Markdown post processor，仅作用于已经由宿主转换为 DOM 的阅读/预览渲染片段。回调 MUST 获得当前片段元素、`sourcePath`、可空 frontmatter、文档标识以及按需获取的可空 section 信息。处理器 MUST 按显式 sort order 和注册顺序运行，并可同步或异步完成；异步结果过期时 MUST 被丢弃或取消，不得写入已被替换的渲染片段。Live Preview 的视觉变更仍 MUST 使用编辑器 extension，而不是依赖阅读模式 post processor。

#### Scenario: 阅读模式片段被后处理

- **WHEN** 宿主为某个 Markdown 文件渲染阅读模式片段
- **THEN** 匹配的 post processor MUST 按顺序收到片段和该文件的 `sourcePath`
- **AND** `getSectionInfo` 返回 `null` 时处理器 MUST 仍可安全完成
- **AND** 同一处理器不得因此自动修改 Live Preview 的 CM6 DOM

#### Scenario: 异步结果已经过期

- **WHEN** post processor 等待异步结果期间原片段因文档更新被移除
- **THEN** 运行时 MUST 阻止异步结果挂载到新片段或其他文档
- **AND** 与旧片段绑定的资源 MUST 进入销毁流程

### Requirement: 围栏代码块处理器必须获得源码与通用渲染生命周期

运行时 MUST 提供 `registerMarkdownCodeBlockProcessor(language, handler, sortOrder?)`。宿主 MUST 解析围栏代码块语言并把未包裹的源码、目标容器和完整 post processor context 交给 handler；通用 post processor 与代码块 processor MUST 共享排序、取消、安全策略和卸载规则。未知语言或已注销处理器 MUST 回退到宿主默认代码块渲染。

#### Scenario: 注册 CSV 代码块处理器

- **WHEN** 阅读模式遇到语言为 `csv` 的围栏代码块且对应处理器已注册
- **THEN** 处理器 MUST 收到原始 CSV 源码和专用空容器
- **AND** 宿主 MUST 避免把默认 `<pre><code>` 与插件输出重复显示
- **AND** 处理器被注销后重新渲染 MUST 使用宿主默认代码块行为

### Requirement: Markdown 渲染子组件必须随其容器销毁

post processor MUST 能通过上下文添加 `MarkdownRenderChild` 或等价受托管组件。子组件的拥有者 MUST 是具体渲染片段而非全局插件；当容器从文档中移除、片段被替换、父渲染器关闭或插件卸载时，运行时 MUST 恰好一次调用其 unload/disposer，并先销毁子组件再释放父上下文。插件不得通过仅持有 DOM 引用延长已失效子组件的生命。

#### Scenario: 文档编辑导致片段替换

- **WHEN** 一个 post processor 为图表容器注册了定时器和渲染子组件，随后该 Markdown 片段被重新渲染
- **THEN** 旧子组件 MUST 在旧容器失效时卸载
- **AND** 其定时器、DOM 监听器和其他 disposer MUST 被清理
- **AND** 新片段 MUST 获得独立的新子组件实例

### Requirement: 插件卸载不得重建编辑器或丢失交互状态

插件卸载或单项 registration dispose 时，运行时 MUST 仅撤销该插件拥有的 CM6 扩展、事件钩子、过滤器、监听器和渲染子组件。运行时 MUST 保持编辑器实例、Markdown 内容、选区、多光标、滚动位置、焦点、折叠状态以及与剩余扩展兼容的撤销/重做历史。若卸载发生在 IME composition 或 Widget 跨帧交互期间，运行时 MUST 延迟破坏性 reconfigure 到安全提交点，或使用不会中断交互的动态 effect。

#### Scenario: 聚焦编辑器中禁用插件

- **WHEN** 用户在一个有未撤销编辑历史和多选区的聚焦编辑器中禁用插件
- **THEN** 该插件的贡献 MUST 停止生效
- **AND** `EditorView` 与 `EditorAPI` 的实例身份 MUST 保持不变
- **AND** 文档、选区、滚动、焦点和可兼容的 undo/redo 历史 MUST 保留

#### Scenario: 输入法组合期间卸载

- **WHEN** 插件卸载发生在尚未结束的 composition 会话中
- **THEN** 运行时 MUST NOT 丢弃或重复当前组合文本
- **AND** MUST NOT 因重建 DOM 造成焦点脱离编辑器
- **AND** 插件清理 MUST 最迟在安全提交点后完成并可被诊断
