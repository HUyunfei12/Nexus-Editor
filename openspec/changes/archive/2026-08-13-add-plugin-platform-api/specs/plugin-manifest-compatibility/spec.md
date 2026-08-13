## Purpose

本能力定义插件包身份、manifest 校验、宿主/API/平台兼容协商、权限与私有数据边界，并规定现有声明式 `NexusPlugin` 的渐进迁移方式。它使插件在执行前即可获得确定的兼容结论和稳定诊断，同时明确 Nexus 借鉴 Obsidian 公共架构但不伪装成 Obsidian 运行时。

## ADDED Requirements

### Requirement: 作者 manifest 与运行时 manifest 分离

插件包 MUST 提供作者维护的 manifest，至少包含 `id`、`name`、`version`、`entrypoint` 与最低 Nexus 插件 API 版本。运行时 MUST 对输入执行 schema 校验并生成不可变的规范化 manifest；宿主注入的安装位置、校验摘要和解析后能力 MUST NOT 被插件包伪造。

#### Scenario: 规范化有效 manifest
- **WHEN** 宿主发现一个字段完整且类型有效的插件包
- **THEN** 运行时生成只读的规范化 manifest
- **AND** 插件构造函数只接收规范化结果
- **AND** 宿主字段与作者字段可被诊断系统区分

#### Scenario: 未知字段前向兼容
- **WHEN** manifest 含有当前运行时不认识但 schema 允许保留的扩展字段
- **THEN** 运行时保留该字段用于诊断和后续版本
- **AND** 不因未知可选字段而拒绝插件
- **AND** 未知字段不自动获得任何能力或权限

### Requirement: 稳定且全局唯一的插件身份

插件 ID MUST 使用小写 ASCII 字母、数字与单连字符组成的稳定格式，并 MUST 在一个 `NexusApp` 内全局唯一。插件升级 MUST 保持 ID 不变；显示名称变化不得迁移命令 ID、存储命名空间或用户授权。

#### Scenario: 重复插件 ID
- **WHEN** 宿主尝试安装或启用两个规范化后 ID 相同的插件
- **THEN** 后发现的插件在执行入口代码前被拒绝
- **AND** 诊断包含冲突包及已有插件的来源

#### Scenario: 显示名称变更
- **WHEN** 插件升级只修改 `name` 而保持 `id`
- **THEN** 原有用户快捷键、设置数据和权限决定仍关联该插件
- **AND** UI 使用新的显示名称

### Requirement: 独立的宿主版本与 API 版本协商

运行时 MUST 分别表示宿主产品版本和 Nexus 插件 API 版本，并 MUST 使用语义版本范围判断 manifest 的最低/最高兼容 API。兼容判断 MUST 在导入或执行插件入口代码前完成；插件 MUST 能在运行时查询当前 API 版本和单项能力，而不得依赖宿主产品版本推断 API。

#### Scenario: API 基线过高
- **WHEN** 插件要求的最低 API 版本高于当前运行时版本
- **THEN** 运行时在执行插件入口前拒绝加载
- **AND** 诊断同时包含所需与当前 API 版本
- **AND** 其他兼容插件仍可继续加载

#### Scenario: 宿主版本变化但 API 兼容
- **WHEN** 宿主产品升级而 Nexus 插件 API 版本仍满足 manifest 范围
- **THEN** 运行时不得仅因产品版本变化禁用插件
- **AND** 平台与 capability 检查仍独立执行

### Requirement: 平台与 capability 预检

manifest MUST 能声明支持的平台、必需 capability 与可选 capability。运行时 MUST 在插件执行前校验平台和必需 capability，在上下文中为每个可选 capability 提供明确的可用性结果；能力名称 MUST 带版本并允许宿主提供兼容实现。

#### Scenario: 缺少必需能力
- **WHEN** 插件要求 `workspace.views` 而 headless 宿主未提供该能力
- **THEN** 运行时拒绝加载并列出缺少的能力及版本
- **AND** `onload` 不会被调用

#### Scenario: 可选能力降级
- **WHEN** 插件把 `ui.statusBar` 声明为可选且宿主未提供它
- **THEN** 插件可以正常加载
- **AND** capability 查询返回带原因的不可用结果
- **AND** 调用不存在能力不会被静默当作成功

### Requirement: 权限与能力实现分离

capability 可用性 MUST NOT 自动等同于插件已获授权。manifest MUST 声明需要用户或管理员批准的权限，宿主 MUST 在相应服务句柄交给插件前作出授权决定，并 MUST 支持撤销。第一阶段采用受信任的同进程插件模型时，文档和诊断仍 MUST 明确这不是安全沙箱。

#### Scenario: 文件能力存在但写权限被拒绝
- **GIVEN** 宿主实现了 Vault 内容能力
- **WHEN** 插件未获文件写权限
- **THEN** 插件可以按授权使用只读接口
- **AND** 写入请求以 `permission-denied` 拒绝
- **AND** 拒绝不会被报告为 capability 缺失

#### Scenario: 运行中撤销授权
- **WHEN** 宿主撤销插件持有的资源或网络权限
- **THEN** 已签发的相关能力句柄停止授予新访问
- **AND** 运行时清理可撤销资源并通知插件
- **AND** 不受影响的能力仍可继续使用

### Requirement: 宿主控制插件包加载

运行时 MUST 通过宿主提供的插件加载器取得已验证入口，并 MUST 要求入口导出可构造的 Nexus 插件类型。公共 API MUST NOT 给予插件任意 Electron、Node、动态 `require` 或原始 IPC 访问；远程下载、市场分发、代码签名和不可信代码沙箱不属于本变更。

#### Scenario: 加载本地受信插件包
- **WHEN** 宿主加载一个通过 manifest 与权限预检的本地插件包
- **THEN** 宿主加载器解析入口并把构造函数交给运行时
- **AND** 插件只从注入的 `NexusApp` 获取宿主能力

#### Scenario: 插件尝试请求未公开的宿主内部对象
- **WHEN** 插件查询 Electron `ipcRenderer`、Node `fs` 或宿主内部 manager
- **THEN** 公共插件上下文不提供这些对象
- **AND** 运行时或宿主返回明确的 unsupported/permission 诊断而不是伪造空实现

### Requirement: 隔离的插件私有数据

运行时 MUST 提供按插件 ID 隔离的版本化私有数据存储，至少支持 `loadData` 与原子 `saveData`。读取结果 MUST 与存储内部状态解耦；同一插件的并发保存 MUST 串行化，插件不得枚举或读取其他插件的数据。

#### Scenario: 首次加载没有数据
- **WHEN** 插件首次调用 `loadData`
- **THEN** 运行时返回文档化的空值
- **AND** 不会自动创建共享全局设置对象

#### Scenario: 保存后修改原对象
- **WHEN** 插件成功保存一个可序列化对象后继续修改该 JavaScript 对象
- **THEN** 已提交的持久化数据保持保存时的快照
- **AND** 下一次读取返回独立值

#### Scenario: 存储内容损坏
- **WHEN** 宿主无法解析插件的已有数据
- **THEN** 运行时保留可恢复的原数据并返回结构化错误
- **AND** 不以空对象静默覆盖损坏内容

### Requirement: 设置迁移与外部变更

插件数据 MUST 携带由插件管理的 schema 版本，运行时 MUST 支持插件在 `onload` 完成前执行幂等迁移。宿主检测到插件数据被外部修改时 MUST 使缓存失效，并在插件实现了相应回调时提供变更通知。

#### Scenario: 数据 schema 升级
- **WHEN** 新插件版本读取到旧 schema 的设置
- **THEN** 插件在暴露依赖新设置的贡献前完成迁移
- **AND** 迁移保存失败会使本次加载失败并触发生命周期回滚

#### Scenario: 外部修改设置文件
- **WHEN** 宿主确认插件私有数据在外部发生变化
- **THEN** 后续 `loadData` 不返回过期缓存
- **AND** 已加载插件收到带新版本的外部变更通知

### Requirement: 秘密数据与普通设置分离

宿主提供秘密存储 capability 时，令牌、密码和密钥 MUST 通过独立的 `SecretStorage` 接口保存，不得混入普通插件数据。秘密值 MUST 对日志、诊断和导出默认脱敏；没有安全秘密存储的宿主 MUST 明确报告能力缺失。

#### Scenario: 保存访问令牌
- **WHEN** 获得授权的插件把访问令牌写入秘密存储
- **THEN** 宿主使用平台安全存储或其声明的安全后端持久化该值
- **AND** 插件普通数据导出和运行时日志不包含令牌明文

### Requirement: 旧版声明式插件兼容适配

现有 `NexusPlugin` 对象及 `createEditor({ plugins })` 调用 MUST 保持源兼容和既有构造期语义。运行时 MUST 通过明确命名的 legacy adapter 把其 shortcuts、commands、handlers、remark 插件、CM6 extensions 与 widgets 归属到受托管注册项；旧对象不得被冒充为具有 `onload/onunload` 的新插件实例。

#### Scenario: 旧插件继续随编辑器创建
- **WHEN** 现有应用把未修改的 `NexusPlugin` 数组传给 `createEditor`
- **THEN** 原有贡献继续按既有顺序生效
- **AND** 应用不需要创建 `NexusApp` 或 manifest

#### Scenario: 运行时托管旧插件贡献
- **WHEN** 宿主选择通过 legacy adapter 加载一个声明式插件
- **THEN** 适配器为其分配稳定的内部 owner 和诊断名称
- **AND** 可动态撤销的贡献在 owner 卸载时被移除
- **AND** 无法安全动态移除的静态贡献被明确标记为需要重开视图而非伪装成功

### Requirement: Nexus 原生 API 与 Obsidian 兼容边界

平台 MUST 以 Nexus 原生模块和类型发布 API，MUST NOT 在本变更中提供名为 `obsidian` 的 namespace shim，也 MUST NOT 承诺未经修改的 Obsidian 社区插件可运行。兼容文档 MUST 按符号族标记 `native`、`adapter`、`deferred` 或 `unsupported`，未实现入口 MUST 在类型检查或运行时给出明确错误，禁止静默 no-op。

#### Scenario: 移植官方 sample plugin
- **WHEN** 开发者根据迁移文档移植 Obsidian sample plugin
- **THEN** 文档指出生命周期、命令、事件和设置概念的 Nexus 对应项
- **AND** 开发者显式修改导入、manifest 与宿主专属调用
- **AND** 测试 fixture 验证的是迁移后的 Nexus 插件而不是声称原包直接兼容

#### Scenario: 使用延后支持的 API
- **WHEN** 插件请求兼容矩阵中标为 `deferred` 的符号族
- **THEN** manifest 预检或 capability 查询明确报告当前不支持
- **AND** 插件可据此降级或拒绝加载

### Requirement: 弃用与兼容诊断策略

公共 API 的弃用项 MUST 标注引入版本、弃用版本、替代项和最早移除的主版本。运行时 MUST 为 manifest、版本、平台、能力、权限、存储和 legacy 限制产生稳定错误码及可读上下文；插件异常 MUST NOT 中断其他插件的兼容检查。

#### Scenario: 使用已弃用入口
- **WHEN** 插件使用仍在兼容窗口内的弃用 API
- **THEN** 行为继续可用
- **AND** 开发构建或运行时诊断指出替代项和计划移除版本

#### Scenario: 多个插件中仅一个不兼容
- **WHEN** 启动时一个插件不满足 API 版本而其他插件兼容
- **THEN** 不兼容插件被单独禁用并记录稳定诊断码
- **AND** 其他插件照常进入加载流程
