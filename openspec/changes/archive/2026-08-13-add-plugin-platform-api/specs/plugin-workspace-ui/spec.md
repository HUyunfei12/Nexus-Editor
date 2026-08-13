## Purpose

本规范定义 Nexus 插件平台可选的工作区与用户界面能力：以 leaf 承载 view、以宿主插槽承载菜单和全局 UI 贡献，并为导航、活动上下文、多窗口 DOM、模态交互、设置持久化、无头宿主降级及安全可访问性建立统一契约，使插件无需绑定 Electron Demo 的具体 DOM 结构也能在不同宿主中可靠运行。

## ADDED Requirements

### Requirement: 工作区必须以 leaf 承载可注册的 view

具备 workspace capability 的宿主 MUST 提供稳定的 `Workspace`、`WorkspaceLeaf` 与 `View` 抽象。插件 MUST 能以插件命名空间内唯一的 `viewType` 和无副作用工厂注册 view；工厂每次接收目标 leaf 并 MAY 被调用多次。每个 leaf 在任一时刻 MUST 至多承载一个活动 view，view MUST 具有 `open/onOpen`、`close/onClose`、持久 `state` 与非持久 `ephemeralState` 契约。插件 MUST 通过 workspace 查询现有 leaf，而不是假设 view 是单例或永久持有某个实例。

#### Scenario: 同一 view type 打开两次

- **WHEN** 用户在两个 leaf 中打开同一插件 view type
- **THEN** 宿主 MUST 调用 view factory 创建两个独立 view 实例
- **AND** 每个实例 MUST 绑定自己的 leaf、容器和生命周期
- **AND** 一个实例关闭不得清除另一个实例的 state 或 DOM

#### Scenario: 恢复持久布局

- **WHEN** 宿主从已保存布局恢复一个插件 view
- **THEN** 宿主 MUST 先验证对应 view type 仍已注册，再创建 view 并应用其持久 state
- **AND** ephemeralState MUST NOT 被当作跨会话持久数据恢复
- **AND** 未注册 view type MUST 产生可恢复的占位或诊断，而不是执行未知代码

### Requirement: 活动上下文必须区分焦点、活动文件与最近编辑器

Workspace MUST 提供类型化查询和事件，用于获取当前聚焦 leaf、活动 view、活动文件以及最近可用的 `EditorContext`；这些值 MUST 明确可空，并且相互之间不得被假定为同一对象。命令或菜单已获得具体 leaf/view/editor 上下文时 MUST 使用该上下文，不得在回调执行时再次用全局 active 值替换。宿主 SHOULD 提供按 view 类型查询和遍历所有 leaf 的能力。

#### Scenario: 侧栏获得焦点但主编辑器仍打开

- **WHEN** 用户从主 Markdown 编辑器切换焦点到插件侧栏 view
- **THEN** focused leaf MUST 指向侧栏
- **AND** active view MUST 是侧栏 view
- **AND** 最近编辑器 MAY 仍指向主编辑器，但 MUST 以单独字段暴露
- **AND** 仅适用于活动编辑器的命令 MUST 根据自身契约决定是否可用

#### Scenario: 上下文菜单来自非活动 leaf

- **WHEN** 用户在未聚焦 leaf 的编辑器中打开上下文菜单
- **THEN** 菜单贡献 MUST 收到产生事件的 leaf、view 和 editor 上下文
- **AND** 插件操作 MUST NOT 被重定向到全局 focused leaf

### Requirement: 布局模型必须可查询、可保存且保持宿主中立

Workspace MUST 提供 leaf 集合、tab/split/sidebar/window 等受支持容器的类型化布局描述，并允许宿主声明不支持的容器类型。插件 MUST 能查询 leaf、按 type 查找 view、监听活动项与布局变化，并请求保存布局；插件不得直接修改宿主内部布局对象。布局 state MUST 版本化且可序列化，未知字段 SHOULD 被保留或安全忽略。

#### Scenario: 宿主不支持分屏

- **WHEN** 插件请求在 split 中打开 view，而当前宿主只支持单一 tab 容器
- **THEN** workspace capability MUST 返回明确的不支持结果或应用已声明的 fallback
- **AND** 不得静默破坏当前 view 或伪造一个不可持久化的 split
- **AND** 插件可改为复用当前 leaf 或停止操作

#### Scenario: 布局发生变化

- **WHEN** 用户移动、固定、分组或关闭 leaf
- **THEN** Workspace MUST 在状态提交后派发布局变化事件
- **AND** 查询 API MUST 反映提交后的结构
- **AND** 同一原子布局操作 SHOULD 合并为一次通知

### Requirement: 打开、聚焦与导航必须显式表达目标

Workspace MUST 提供打开资源或 view state 的导航 API，并让调用方显式选择复用当前 leaf、新 tab、新 split、新 window 或宿主默认策略。导航请求 MUST 可声明是否激活、是否聚焦、来源路径、临时状态和历史记录策略；API MUST 返回实际使用的 leaf 或结构化失败结果。`reveal` MUST 能展开折叠侧栏或唤醒延迟 view，但不得在未请求时抢占输入焦点。

#### Scenario: 在后台 tab 打开文件

- **WHEN** 插件请求在新 tab 打开文件并设置 `active = false`、`focus = false`
- **THEN** 宿主 MUST 返回承载该文件的 leaf
- **AND** 当前活动 leaf 与键盘焦点 MUST 保持不变
- **AND** 新 leaf 的导航 state MUST 可由布局持久化

#### Scenario: 聚焦延迟加载的 view

- **WHEN** 插件请求 reveal 并聚焦一个后台 deferred leaf
- **THEN** 宿主 MUST 先加载并完成该 view 的 `onOpen`
- **AND** 再将 leaf 设为活动并按请求移动焦点
- **AND** Promise 完成时插件 MUST 能安全访问已加载 view

### Requirement: 所有 UI 必须使用目标 leaf 或元素所属的窗口

每个 view、leaf 和 UI surface context MUST 暴露其实际 `Window` 与 `Document`，所有菜单、模态框、DOM 注册、元素创建和坐标解释 MUST 以目标 surface 的 owner document 为准。插件不得依赖全局 `window`、`document` 或主窗口构造器来处理弹出窗口元素；宿主 MUST 提供跨 window 安全的元素判断或鼓励使用 `ownerDocument.defaultView`。元素迁移到另一个窗口时，宿主 MUST 通知需要重建渲染上下文的组件。

#### Scenario: 在弹出窗口编辑器中打开菜单

- **WHEN** 编辑器位于第二个浏览器窗口且用户触发 contextmenu
- **THEN** Menu MUST 挂载到该编辑器 owner document
- **AND** 事件坐标 MUST 相对于该窗口解释
- **AND** 菜单不得出现在主窗口或使用主窗口的 `MouseEvent` 构造器做不可靠判断

#### Scenario: View DOM 被迁移到新窗口

- **WHEN** 宿主把现有 leaf 移入弹出窗口
- **THEN** view MUST 获得新的 Window/Document 上下文通知
- **AND** 依赖 canvas、observer 或 window 监听器的托管资源 MUST 可重新绑定
- **AND** 旧窗口上的监听器 MUST 被释放

### Requirement: Menu 必须是可组合、上下文明确的短生命周期 UI

UI capability MUST 提供 `Menu` 和 `MenuItem` 抽象，支持标题、图标、选中、禁用、危险状态、分组、分隔符和 mouse/keyboard 激活。插件 MUST 能通过类型化的 editor/file/view/tab context-menu 贡献点向现有菜单追加项目，也能为自身事件创建菜单。菜单 MUST 在 show 之前收集贡献并确定顺序；hide/close 后 MUST 销毁其 scope、DOM 和监听器。菜单回调 MUST 收到创建菜单时冻结的来源上下文。

#### Scenario: 编辑器上下文菜单组合多个插件项目

- **WHEN** 两个插件向同一个 editor-menu slot 添加项目
- **THEN** 宿主 MUST 按 section、priority 和稳定注册顺序组合菜单
- **AND** 每个回调 MUST 收到产生菜单的 EditorContext
- **AND** 禁用项目 MUST 可聚焦说明状态但不得执行操作

#### Scenario: 菜单被键盘关闭

- **WHEN** 用户按 Escape 关闭菜单
- **THEN** Menu MUST 释放 DOM、焦点 scope 和所有临时回调
- **AND** 焦点 MUST 按宿主策略恢复到来源 surface
- **AND** 重复 close MUST 是幂等操作

### Requirement: Modal 必须提供受约束的焦点与清理生命周期

UI capability MUST 提供 Modal 抽象，包含目标 window、`containerEl`、`titleEl`、`contentEl`、`open/onOpen` 与 `close/onClose`。打开时 MUST 建立焦点陷阱、可选选择恢复点和独立快捷键 scope；关闭时 MUST 恰好一次运行清理、移除 DOM 和恢复合理焦点。异步 `onOpen` 失败 MUST 关闭半初始化 modal 并返回诊断。Modal 的生命周期 MUST 可被插件父组件托管。

#### Scenario: 插件卸载时模态框仍打开

- **WHEN** 拥有 Modal 的插件被禁用
- **THEN** 运行时 MUST 关闭该 Modal 并调用其 `onClose`
- **AND** MUST 移除焦点陷阱、快捷键 scope 和 DOM
- **AND** 焦点不得落在已分离元素上

#### Scenario: 模态框在第二窗口打开

- **WHEN** 命令从第二窗口的 view 上下文打开 Modal
- **THEN** Modal MUST 使用该窗口的 Document 与焦点系统
- **AND** 关闭时 SHOULD 恢复到该窗口的来源元素，而非主窗口

### Requirement: Notice 必须是非阻塞且可访问的瞬时反馈

UI capability MUST 提供 Notice 服务，支持消息、级别、持续时间、去重 key 和显式 dismiss。Notice MUST 非阻塞，不得抢占编辑器焦点，并 MUST 通过适当的 ARIA live region 向辅助技术宣布。无 UI 宿主 MUST 将 Notice 转为结构化日志或 no-op 结果，而不是令插件加载失败。

#### Scenario: 重复保存通知被去重

- **WHEN** 插件在短时间内以同一 dedupe key 连续发布多个保存成功 Notice
- **THEN** 宿主 MUST 更新或合并已有 Notice，而不是无限堆叠
- **AND** Notice MUST 保持非模态且不改变当前焦点

### Requirement: 设置页必须区分定义、显示与持久化

UI capability MUST 提供插件命名空间化的 `SettingTab` 注册，支持声明式 setting definitions 以及受控的自定义 render fallback。设置定义 MUST 可表达常见文本、数字、开关、选择、滑块、颜色、文件/文件夹和 action，并支持名称、描述、默认值、验证、禁用与可见状态。`display` 可被多次调用且 MUST 只负责当前显示；`hide`、插件卸载或设置窗口关闭时 MUST 清理注册组件。值读写 MUST 通过插件私有存储或显式 adapter，而不是直接访问宿主内部配置对象。

#### Scenario: 声明式设置验证失败

- **WHEN** 用户提交一个未通过同步或异步 validator 的设置值
- **THEN** SettingTab MUST 显示与控件关联的可访问错误信息
- **AND** MUST NOT 持久化无效值
- **AND** 其他设置项与插件运行状态 MUST 保持可用

#### Scenario: 设置页重复显示

- **WHEN** 用户离开后再次进入同一插件 SettingTab
- **THEN** 宿主 MUST 重新读取当前持久值并渲染
- **AND** 前一次显示创建的临时组件和监听器 MUST 已在 hide 时卸载
- **AND** 不得累积重复 DOM 或回调

### Requirement: 宿主 UI 贡献必须通过命名插槽注册

UI capability MUST 为 status bar、ribbon、editor toolbar、view toolbar 和 command palette 提供命名 registration slot。每项贡献 MUST 包含稳定 id、可访问名称、可选图标、priority、可见/禁用谓词和动作，并返回幂等 disposer；宿主 MAY 根据平台、空间或用户偏好隐藏或重排贡献。Ribbon 和 toolbar 动作 SHOULD 同时对应可发现命令；status bar MUST 被标记为可选能力，移动端或紧凑宿主 MAY 不提供。

#### Scenario: 移动宿主没有状态栏

- **WHEN** 插件尝试注册 status bar item 而宿主未声明该 slot
- **THEN** 注册 MUST 返回结构化 unsupported 结果
- **AND** 插件可继续加载其编辑器或命令贡献
- **AND** 运行时不得创建不可见的孤立 DOM

#### Scenario: 用户隐藏 ribbon 项

- **WHEN** 用户通过宿主偏好隐藏某个插件 ribbon action
- **THEN** 该 ribbon DOM MUST 不再显示
- **AND** 对应命令仍 SHOULD 可从 command palette 或快捷键访问
- **AND** 插件不得自行覆盖用户的隐藏决定

### Requirement: 命令面板必须消费统一命令注册表

Command palette slot MUST 从平台统一命令注册表读取项目，而不是维护第二套不可触发的 UI action。面板 MUST 根据命令的可用性检查、当前上下文、搜索文本和用户策略显示或禁用项目；可用性检查 MUST 无副作用，执行前 MUST 再检查一次。面板执行编辑器命令时 MUST 使用打开面板前捕获的来源 EditorContext，除非该上下文已失效并且命令明确允许 fallback。

#### Scenario: 面板打开后活动 leaf 改变

- **WHEN** 命令面板从编辑器 A 打开，期间活动 leaf 切换到编辑器 B，然后用户执行仅针对来源编辑器的命令
- **THEN** 宿主 MUST 在执行前验证捕获的编辑器 A 上下文仍有效
- **AND** 有效时 MUST 对 A 执行，而不是静默改为 B
- **AND** 无效时 MUST 禁止执行或按命令声明的 fallback 处理

### Requirement: UI registration 必须自动清理并隔离插件所有权

每个 view type、菜单贡献、Modal、Notice、SettingTab 和 slot item MUST 记录插件所有权，并绑定插件或显式子组件生命周期。插件卸载时运行时 MUST 停止新工厂调用、关闭其临时 UI、撤销所有 registration、清理监听器与 DOM，并按宿主策略处理仍打开的插件 view。disposer MUST 幂等；一个插件清理失败 MUST 被诊断且不得阻止其他插件或宿主 UI 清理。

#### Scenario: 插件带打开 view 被禁用

- **WHEN** 插件卸载时仍有两个该插件 view leaf、一个开放菜单和一个 toolbar item
- **THEN** 运行时 MUST 关闭菜单并移除 toolbar item
- **AND** MUST 停止 view factory 并按声明的 `close` 或 `placeholder` 策略处理两个 leaf
- **AND** 每个 view 的 `onClose` 和注册 disposer MUST 至多执行一次
- **AND** 其他插件贡献 MUST 保持不变

### Requirement: 无头宿主必须提供可探测的降级行为

Workspace 与 UI MUST 是可独立探测的 capability，插件 manifest 或加载逻辑 MUST 能声明 required 与 optional 能力。无头宿主 MUST 对缺失 UI 返回结构化 `unsupported`，并允许只依赖编辑器、内容或命令服务的插件继续工作；仅在插件声明 required UI capability 缺失时才可拒绝加载，且 MUST 给出缺失项诊断。插件 MUST NOT 通过探测全局 DOM 推断能力。

#### Scenario: 插件在无头测试宿主加载

- **WHEN** 插件把 workspace UI 声明为 optional，并在无头宿主注册命令与一个可选 toolbar item
- **THEN** 命令 MUST 成功注册
- **AND** toolbar 注册 MUST 返回 unsupported 而不抛出不可恢复异常
- **AND** 插件 MUST 可完成加载与卸载

#### Scenario: 必需的 view 能力缺失

- **WHEN** 插件 manifest 声明 workspace view 为 required，而宿主不提供 workspace capability
- **THEN** 运行时 MUST 在执行插件 `onload` 的 UI 注册前拒绝加载
- **AND** 诊断 MUST 指明缺少的 capability 和宿主标识
- **AND** 已完成的预加载资源 MUST 被回滚

### Requirement: 插件 UI 必须遵守安全边界

宿主 MUST 将插件 UI 视为受策略约束的受信代码扩展而非安全沙箱。任何 Markdown 或外部字符串到 HTML 的转换 MUST 使用宿主 sanitizer；默认 API MUST 通过 `textContent`/结构化元素创建文本，只有显式 unsafe capability 才可注入原始 HTML。外部 URL、资源 URL、文件打开和危险动作 MUST 经过宿主策略；插件不得获得未声明的 Electron、Node 或主进程对象。菜单、Modal 与设置中的危险动作 MUST 可被明确标识并在需要时确认。

#### Scenario: Notice 包含不可信 HTML

- **WHEN** 插件把含 `<script>` 或内联事件属性的外部字符串作为 Notice 或 Setting 描述
- **THEN** 默认 UI API MUST 将其作为文本或消毒后的结构渲染
- **AND** 脚本和内联事件 MUST NOT 执行
- **AND** 安全策略拒绝结果 MUST 可被诊断

### Requirement: 插件 UI 必须满足键盘与辅助技术可访问性

宿主提供的 Menu、Modal、Notice、Setting、ribbon、toolbar 和 command palette MUST 采用适当语义角色、可访问名称、键盘导航、可见焦点和禁用状态；图标按钮 MUST 要求名称或 tooltip，不能只靠图形传达动作。焦点顺序 MUST 与视觉顺序一致，Escape/Enter/方向键行为 MUST 符合对应控件惯例，并尊重 reduced-motion、高对比度和文本缩放。插件自定义 view 容器 MUST 获得可访问性上下文与开发期诊断。

#### Scenario: 仅用键盘操作菜单和模态框

- **WHEN** 用户仅使用键盘打开编辑器菜单、选择一个打开 Modal 的项目并关闭 Modal
- **THEN** 菜单项 MUST 可通过方向键遍历并以 Enter 激活
- **AND** Modal 打开后焦点 MUST 位于其内部且 Tab 不得逃出焦点陷阱
- **AND** Escape 关闭后焦点 MUST 回到合理的来源元素

#### Scenario: 插件注册无名称图标动作

- **WHEN** 插件尝试注册只有 icon 而没有 label、aria-label 或 tooltip 的 toolbar action
- **THEN** 宿主 MUST 拒绝注册或产生阻止发布级别的诊断
- **AND** 不得向用户呈现无法由辅助技术识别的按钮
