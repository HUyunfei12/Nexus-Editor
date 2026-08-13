## Purpose

本能力定义插件可依赖的宿主无关内容服务，包括 Vault 文件模型、安全读写、语义化文件管理、资源定位、frontmatter 修改与元数据索引。它把 Electron 文件系统实现约束在宿主适配器之后，使浏览器、桌面端和测试宿主能够提供一致、可观察且不会越过授权根目录的契约。

## ADDED Requirements

### Requirement: 统一的文件与目录对象模型

内容服务 MUST 暴露只读类型判别明确的 `NexusAbstractFile`、`NexusFile` 与 `NexusFolder` 对象，并 MUST 使用经规范化的、以 `/` 分隔的 Vault 相对路径作为公共标识。公共 API MUST NOT 暴露绝对路径、Node `fs` 句柄或 Electron IPC 对象。

#### Scenario: 查询已有文件
- **WHEN** 插件以 `Projects/alpha.md` 查询一个位于授权 Vault 内的 Markdown 文件
- **THEN** 内容服务返回类型为 `NexusFile` 的对象
- **AND** 对象的 `path` 为规范化后的 `Projects/alpha.md`
- **AND** 对象不包含宿主绝对路径

#### Scenario: 拒绝越界路径
- **WHEN** 插件提交包含 `..`、绝对路径、编码后路径穿越或经符号链接解析后离开授权根目录的目标
- **THEN** 内容服务以结构化的 `path-outside-authorized-root` 错误拒绝操作
- **AND** 宿主不执行读取、写入或元数据变更

### Requirement: 稳定的文件身份与查找

内容服务 MUST 支持按路径查找文件或目录，并 MUST 在宿主内的重命名操作完成后保留同一文件对象的逻辑身份并更新其路径。文件被删除后，旧引用 MUST 被标记为失效，后续 I/O MUST 明确失败而不得命中同路径的新对象。

#### Scenario: 重命名后已有引用继续指向同一文件
- **GIVEN** 插件持有 `Notes/old.md` 的文件引用
- **WHEN** 文件管理服务将该文件重命名为 `Notes/new.md`
- **THEN** 已有引用的路径更新为 `Notes/new.md`
- **AND** 通过新路径查询得到相同逻辑身份的文件对象

#### Scenario: 删除后路径被重新创建
- **GIVEN** 插件持有一个随后被删除的文件引用
- **WHEN** 宿主在相同路径创建另一个文件
- **THEN** 旧引用保持失效
- **AND** 新文件具有不同的逻辑身份

### Requirement: 文本与二进制内容读写

Vault 服务 MUST 提供文本和二进制的读取、创建、修改与追加操作，并 MUST 明确区分一致性读取与允许返回缓存的读取。修改既有文件 MUST 使用宿主支持的原子替换策略；同一路径上的并发写入 MUST 被串行化或以可检测的版本冲突拒绝，不得静默覆盖较新的内容。

#### Scenario: 原子修改文本文件
- **WHEN** 插件修改一个已有文本文件
- **THEN** 其他观察者只能看到修改前或修改后的完整内容
- **AND** 不会观察到截断的中间状态
- **AND** 成功结果包含新的内容版本标识

#### Scenario: 检测并发写入冲突
- **GIVEN** 插件基于版本 `v1` 读取并准备写入文件
- **WHEN** 另一来源已将文件推进至版本 `v2`
- **AND** 插件以期望版本 `v1` 提交修改
- **THEN** Vault 服务拒绝该修改并返回当前版本信息
- **AND** `v2` 的内容保持不变

#### Scenario: 读取二进制附件
- **WHEN** 插件读取一个受支持的二进制附件
- **THEN** Vault 服务返回 `ArrayBuffer` 或等价的宿主无关二进制值
- **AND** 不要求插件访问本地文件系统路径

### Requirement: 事务式内容处理

Vault 服务 MUST 提供接收转换回调的 `process` 语义，在宿主控制的临界区内读取最新内容、执行同步转换并提交结果。同一文件上的 `process` 调用 MUST 串行执行；转换回调抛错时 MUST 保留原内容且不得发出成功修改事件。

#### Scenario: 串行更新同一文件
- **WHEN** 两个插件同时对同一文件执行内容转换
- **THEN** 第二个转换读取到第一个已提交的结果
- **AND** 两个成功结果都不会因最后写入者覆盖而丢失

#### Scenario: 转换失败回滚
- **WHEN** 内容转换回调抛出异常
- **THEN** 文件内容和版本保持不变
- **AND** 调用方收到包含插件与文件上下文的诊断

### Requirement: 可观察的文件生命周期事件

Vault 服务 MUST 为 `create`、`modify`、`rename` 与 `delete` 提供类型化订阅，并 MUST 同时接纳插件写入和宿主确认的外部文件系统变化。事件 MUST 携带文件身份、变更来源与单调版本；一次语义操作产生的重复底层 watcher 通知 MUST 被合并。

#### Scenario: 插件写入触发一次修改事件
- **WHEN** 插件成功修改一个文件
- **THEN** 订阅者收到一次该逻辑操作对应的 `modify` 事件
- **AND** 事件来源可识别为发起写入的插件或宿主操作
- **AND** watcher 对同一写入的回声不会产生第二次等价事件

#### Scenario: 外部重命名被宿主确认
- **WHEN** 外部工具在授权根内重命名文件且宿主能够关联旧、新路径
- **THEN** 订阅者收到包含旧路径和更新后文件对象的 `rename` 事件
- **AND** 元数据缓存随后针对同一版本完成更新

### Requirement: 语义化文件管理

文件管理服务 MUST 提供创建附件目标、重命名、移动、生成 Markdown 链接与删除到可恢复位置的语义化操作。重命名或移动 Markdown 文件时，宿主 MUST 按用户设置决定是否更新可解析的内部链接，并 MUST 将文件操作与链接改写的失败作为一个可诊断结果报告。

#### Scenario: 移动文件并更新内部链接
- **GIVEN** 宿主启用了自动更新内部链接
- **WHEN** 插件通过文件管理服务移动一个被其他笔记引用的文件
- **THEN** 文件移动到规范化的目标路径
- **AND** 可解析的引用按宿主链接风格更新
- **AND** 元数据索引最终反映新路径

#### Scenario: 默认删除可恢复
- **WHEN** 插件请求删除文件且未显式获得永久删除权限
- **THEN** 宿主将文件移动到系统回收站或 Vault 内可恢复废纸篓
- **AND** 若可恢复删除失败，操作以错误结束
- **AND** 宿主不得静默回退为永久删除

### Requirement: 安全的 frontmatter 更新

文件管理服务 MUST 提供结构化的 frontmatter 读取与修改入口，并 MUST 在最新文件版本上串行执行修改。服务 MUST 保留 frontmatter 之外的正文，使用宿主的 YAML 解析与序列化规则，并 MUST 拒绝原型污染键、循环值或不可序列化值。

#### Scenario: 修改 frontmatter 属性
- **WHEN** 插件在 frontmatter 修改回调中设置 `status: done`
- **THEN** 宿主仅更新 YAML frontmatter 中的目标结构
- **AND** 文件正文保持不变
- **AND** 对应元数据缓存更新后发出 `changed` 事件

#### Scenario: 文件没有 frontmatter
- **WHEN** 插件修改一个没有 YAML frontmatter 的 Markdown 文件
- **THEN** 宿主在文档开头创建有效的 frontmatter 区块
- **AND** 原正文内容与换行语义得到保留

### Requirement: 元数据缓存与链接解析

元数据服务 MUST 为 Markdown 文件提供带文件版本的结构化缓存，至少覆盖 frontmatter、标题、区块、标签、嵌入和内部链接，并 MUST 提供目标解析、反向链接及已解析/未解析链接查询。缓存属于最终一致的派生数据；插件需要最新结果时 MUST 能等待指定文件版本完成索引。

#### Scenario: 等待写入后的元数据
- **WHEN** 插件写入包含新内部链接的文件并等待该写入版本完成索引
- **THEN** 等待完成后的缓存包含该链接
- **AND** 目标文件的反向链接查询包含来源文件

#### Scenario: 链接无法解析
- **WHEN** Markdown 包含一个当前没有匹配目标的内部链接
- **THEN** 元数据服务将其记录在未解析链接集合中
- **AND** 后续创建匹配文件后，索引可将其迁移到已解析集合并发出解析完成事件

### Requirement: 元数据事件的一致性顺序

元数据服务 MUST 区分单文件缓存变化、批次解析完成和索引错误事件。对于同一内容版本，文件 `modify` 事件 MUST 先于元数据 `changed` 事件，等待索引完成的调用 MUST 在该版本的链接解析和反向索引均可查询后才结束。

#### Scenario: 观察文件修改与缓存更新
- **WHEN** 一个文件修改成功并需要重新索引
- **THEN** 观察者先收到携带新版本的 Vault `modify` 事件
- **AND** 随后收到相同版本的元数据 `changed` 事件
- **AND** 解析失败时收到错误事件而不是伪造完成状态

### Requirement: 宿主管理的资源 URL

内容服务 MUST 能为授权文件生成有生命周期约束的资源 URL，并 MUST 提供显式撤销机制。资源 URL MUST 绑定当前宿主、Vault 与授权策略，不得泄漏绝对路径；插件卸载或授权撤销后，宿主 MUST 能使其失效。

#### Scenario: 在插件 UI 中显示附件
- **WHEN** 插件为 Vault 内图片请求资源 URL
- **THEN** 宿主返回可在该视图窗口加载的 URL
- **AND** URL 不包含本地绝对路径
- **AND** 注册句柄释放后该 URL 不再授予文件访问权

### Requirement: 内容能力可选且可替换

`vault`、`fileManager`、`metadata` 与 `resources` MUST 是可独立发现的宿主 capability。插件声明为必需的内容能力缺失时，运行时 MUST 在执行插件代码前拒绝加载；可选能力缺失时，插件 MUST 能以无文件系统或无索引模式运行。

#### Scenario: 浏览器宿主没有元数据索引
- **GIVEN** 插件仅把 `metadata` 声明为可选能力
- **WHEN** 插件在只提供内存 Vault 的浏览器宿主加载
- **THEN** capability 查询明确返回 `metadata` 不可用
- **AND** 插件仍可使用其余已授权能力
