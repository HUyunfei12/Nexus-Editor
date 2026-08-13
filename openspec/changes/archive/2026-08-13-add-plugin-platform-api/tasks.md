## 1. 公共契约与包骨架

- [x] 1.1 新建 browser-safe 的 `@floatboat/nexus-plugin-api` 包，配置 ESM、类型声明、公共导出和不依赖 Electron/Node 的构建检查
- [x] 1.2 新建 `@floatboat/nexus-plugin-runtime` 包及内部模块边界，确保依赖方向仅为 runtime -> plugin-api/core
- [x] 1.3 在 plugin-api 中定义 `NexusApp`、`NexusPluginBase`、`NexusComponent`、规范化 manifest 和不可变插件身份类型
- [x] 1.4 定义带稳定 ID、版本与作用域的 capability token/result 类型，并覆盖 available、unsupported、version-mismatch 和 permission-denied 结果
- [x] 1.5 定义共享的 owner-bound registration、幂等 disposer、subscription、结构化 diagnostic 和 error-code 类型
- [x] 1.6 定义 command、event、editor、workspace、content、UI、storage 与 secret 服务的分域接口，避免形成依赖宿主实现的巨型 concrete `App`
- [x] 1.7 新建 runtime testkit，提供内存 capability registry、虚拟时钟/DOM、资源计数器、虚拟 Workspace/Vault 和插件 fixture loader
- [x] 1.8 为所有公共包增加 API Extractor 或等价导出快照检查，防止未声明内部类型泄漏到公共 `.d.ts`

## 2. Manifest、预检与插件加载

- [x] 2.1 实现作者 manifest schema、插件 ID 规范化和作者字段/宿主字段分离的 runtime manifest 生成器
- [x] 2.2 实现宿主版本、插件 API semver 范围、平台以及 required/optional capability 的执行前兼容预检
- [x] 2.3 实现 capability 与权限分离的授权结果，并支持运行中撤销 capability handle
- [x] 2.4 实现宿主控制的本地受信插件入口 loader，校验默认导出/构造类型且不向插件暴露动态 `require`、Node 或 Electron 对象
- [x] 2.5 实现插件 ID 冲突、未知可选 manifest 字段、弃用项和 unsupported API 的稳定诊断
- [x] 2.6 增加 manifest 与加载器契约测试，证明不兼容代码在入口执行前被拒绝且不影响其他插件

## 3. Plugin Runtime 与 Component 生命周期

- [x] 3.1 实现 `NexusComponent` 的单一所有者无环树、父子加载顺序和子先父的逆序卸载
- [x] 3.2 实现通用 `register()` 及 DOM、事件、interval/timeout 专用登记入口，支持同步和异步 disposer 的逆序等待
- [x] 3.3 实现 `constructed/loading/loaded/unloading/unloaded/failed` 实例状态机和同一实例生命周期操作串行化
- [x] 3.4 实现 PluginManager 的 discovery、validation、enable、disable 与“重新启用创建新实例”流程
- [x] 3.5 实现 `onload` staging transaction，使加载中贡献不可分发并在成功后一次提交
- [x] 3.6 实现加载失败的逆序原子回滚、原始错误与清理错误聚合，并确保失败实例不调用 `onunload`
- [x] 3.7 实现 quiescing、并发/重复 unload 共用结果、清理错误不阻断剩余资源且实例最终进入 `unloaded`
- [x] 3.8 实现插件回调边界、敏感信息脱敏、每插件失败隔离和宿主可观察的结构化诊断流
- [x] 3.9 增加生命周期契约测试，覆盖父子组件、晚注册资源、异步清理、失败回滚、重复启停和 unload 后零资源残留

## 4. 命令、快捷键与事件服务

- [x] 4.1 实现 `${pluginId}:${localId}` 命名空间的原子 CommandRegistry，并同步程序化查询、命令面板和快捷键所见集合
- [x] 4.2 使用可辨识联合或注册校验实现四种互斥命令模式，并拒绝零个或多个 callback 的定义
- [x] 4.3 实现无副作用 availability probe、执行前重验以及触发时 editor/file/view 上下文解析
- [x] 4.4 实现用户快捷键覆盖、清除与恢复默认值的持久模型，并实现跨平台 `Mod` 和键名规范化
- [x] 4.5 实现带父级继承的 Scope 栈、上下文遮蔽、同步消费语义和 owner 卸载自动 pop
- [x] 4.6 实现相同 scope/优先级快捷键冲突诊断，禁止按插件加载顺序任意选择候选
- [x] 4.7 实现基于 typed event map 的 Events/Subscription，支持有界整数优先级、稳定注册序和分发快照
- [x] 4.8 实现通知事件 FIFO 重入队列、有限预算和单处理器异常隔离
- [x] 4.9 明确实现普通通知与同步可取消事件的不同 dispatcher，使异常和异步返回都不会被误判为取消
- [x] 4.10 增加命令、hotkey、Scope 与事件契约测试，覆盖命名冲突、状态过期、无活动编辑器、订阅中增删、重入预算和错误隔离

## 5. Core 动态编辑器基础

- [x] 5.1 在 core 增加最小动态 contribution sink，同时保持 `createEditor({ plugins })` 的构造期静态路径与公共行为不变
- [x] 5.2 实现 EditorHostRegistry attach/detach、稳定 `editorId` 和可空 file/view/leaf/window 上下文，不把活动编辑器建模为全局单例
- [x] 5.3 为每个 editor/plugin owner 建立 CM6 Compartment 并以 reconfigure 动态安装、更新和撤销 extension tree
- [x] 5.4 实现跨编辑器 extension snapshot journal、失败逆序回滚和已 detach editor 的竞态处理
- [x] 5.5 实现 interaction barrier，在 IME composition、mousedown、表格编辑/范围选择/grip 拖动期间延迟会破坏 Widget DOM 的重配置
- [x] 5.6 实现应用前事务过滤与提交后 update listener，携带 changes、前后选区、origin、editorId 和可选文件上下文
- [x] 5.7 实现 origin 链、批量原子事务和同步递归上限，使插件可识别自身后续事务
- [x] 5.8 增加动态扩展测试，证明启停不重建 `EditorView` 且保留文档、selection、多光标、history、scroll、focus、fold 与 IME 内容

## 6. 真实 DOM 输入、剪贴板与 Widget 边界

- [x] 6.1 在每个 EditorHost 根节点实现唯一 capture dispatcher，覆盖 `copy`、`cut`、`paste`、`beforeinput`、`drop`、`contextmenu` 和 `keydown`
- [x] 6.2 实现 capture/bubble、数值 priority、注册序、consume/pass、post-consume observer 和同步 `preventDefault` 契约
- [x] 6.3 实现结构化 clipboard pipeline，分别保留 `text/plain`、`text/html`、文件及其他 MIME 项并报告浏览器权限降级
- [x] 6.4 实现 outgoing copy/cut 管线，确保剪贴板写入失败时不删除来源内容
- [x] 6.5 实现 `EditorInputTarget`/editable-surface adapter，使普通文档、Widget 和表格单元格拥有各自 selection/replace/copy 语义
- [x] 6.6 保证 `WidgetDefinition.ignoreEvents` 只绕过 CM6 光标处理而不绕过宿主 capture hook，且未注册 target adapter 时文本替换明确返回 unsupported
- [x] 6.7 增加真实 DOM 事件测试，覆盖快捷键、系统菜单和上下文菜单触发的 copy/cut/paste，证明 `Ctrl/Cmd+V` 不会被伪造成粘贴事件
- [x] 6.8 增加表格回归测试，覆盖 click-to-edit、拖选范围、grip 点选列/行、grip 拖动重排、点击外部取消、选择后 Delete 和聚焦单元格后开始拖动
- [x] 6.9 验证跨帧交互始终配平 `self.editing`/`tableEditingCount`，rAF 清理尊重全部活动状态且动态卸载不重建活动表格 DOM

## 7. Markdown、Remark 与渲染生命周期

- [x] 7.1 实现版本化 RemarkTransformRegistry，以 staging processor 验证、缓存和安全点 AST/decorations 刷新支持动态装卸
- [x] 7.2 实现版本化 WidgetRegistry 和 contribution ID，使用 StateEffect 更新 definition snapshot 并销毁被移除 Widget
- [x] 7.3 实现 MarkdownPostProcessorRegistry 的 sort order、sourcePath、frontmatter、section info 与 async render generation 失效检查
- [x] 7.4 实现围栏代码块 processor，并与通用 postprocessor 共享排序、取消、安全和注销后默认渲染语义
- [x] 7.5 实现每个渲染片段拥有的 `MarkdownRenderChild`/Component，确保重渲染、view detach 和插件卸载时恰好一次清理
- [x] 7.6 增加 Markdown 动态注册测试，覆盖 transform 构建失败、过期异步结果、代码块 fallback、子组件 timer/listener 清理和不修改 undo 历史

## 8. Workspace 与 UI 能力

- [x] 8.1 定义并实现 testkit Workspace 的 leaf/view/window 模型、view type 工厂、持久 state、ephemeral state 与占位恢复策略
- [x] 8.2 实现 focused leaf、active view/file、recent editor 的独立可空查询和类型化活动/布局事件
- [x] 8.3 实现显式 reuse/new-tab/split/window/default 导航策略、reveal/focus 选项和实际 leaf 结果
- [x] 8.4 实现 owner-bound ViewRegistry，保证插件卸载时先停止工厂并按 close/placeholder 策略处理已打开 view
- [x] 8.5 实现 WindowContext，使 view、菜单、模态框、DOM listener 和坐标均使用目标 `ownerDocument`/`ownerWindow`
- [x] 8.6 实现 Menu/MenuItem 的 section、priority、冻结来源上下文、键盘 scope、焦点恢复与幂等 close
- [x] 8.7 实现 Modal 的焦点陷阱、异步打开失败回滚、插件卸载关闭和跨窗口焦点恢复
- [x] 8.8 实现非阻塞 Notice 的级别、持续时间、去重、dismiss、ARIA live 与 headless 日志降级
- [x] 8.9 实现 SettingTab 的声明式常用控件、验证、display/hide 资源域和插件私有存储绑定
- [x] 8.10 实现 status bar、ribbon、editor/view toolbar 与 command palette 命名 slot，并让命令面板消费统一 CommandRegistry
- [x] 8.11 为插件 UI 文本/HTML、外部 URL、资源 URL 和危险动作接入 sanitizer 与宿主策略，拒绝未命名图标动作
- [x] 8.12 增加 Workspace/UI 契约测试，覆盖多实例 view、布局恢复、非活动 leaf 菜单、多窗口 DOM、焦点键盘可访问性、headless 降级与卸载清理

## 9. Vault、FileManager 与 Metadata 能力

- [x] 9.1 实现规范化 Vault 相对路径、授权根与符号链接越界校验，确保公共对象不泄漏绝对路径
- [x] 9.2 实现 `NexusAbstractFile`/`NexusFile`/`NexusFolder` 类型判别、稳定身份、rename 路径更新和 delete 后失效引用
- [x] 9.3 实现文本/二进制读取、创建、追加与原子修改，并提供一致性读取、缓存读取和内容版本标识
- [x] 9.4 实现期望版本冲突与同文件 `process` 串行转换，保证失败时内容/版本不变
- [x] 9.5 实现 create/modify/rename/delete 类型化事件、origin/operation ID、watcher 回声合并和外部变更确认
- [x] 9.6 实现 FileManager 的移动/重命名、Markdown 链接生成、可配置引用更新和默认可恢复删除
- [x] 9.7 实现基于最新版本串行化的 frontmatter 处理，保留正文并拒绝原型污染与不可序列化值
- [x] 9.8 实现带文件版本的 MetadataCache，覆盖 frontmatter、标题、区块、标签、嵌入、resolved/unresolved link 与 backlink
- [x] 9.9 实现等待指定版本索引完成及 Vault modify -> metadata changed -> resolve completed 的一致事件顺序
- [x] 9.10 实现绑定宿主/Vault/授权且可撤销的资源 URL，不包含本地绝对路径
- [x] 9.11 增加内容服务契约测试，覆盖路径穿越、符号链接越界、原子/并发写、稳定身份、可恢复删除、frontmatter、事件去重和索引版本

## 10. 插件数据、秘密与兼容层

- [x] 10.1 实现按规范化插件 ID 隔离、快照读取和原子串行保存的 `loadData/saveData`
- [x] 10.2 实现插件 data schema 版本、幂等迁移、损坏数据保留和外部变更缓存失效/通知
- [x] 10.3 定义 SecretStorage optional capability，并为无安全后端宿主返回明确 unsupported 而不回退普通 JSON
- [x] 10.4 实现 legacy adapter，把旧 `NexusPlugin` 的 commands、shortcuts、handlers、cmExtensions、remarkPlugins 和 widgets 归入稳定 owner
- [x] 10.5 对无法安全动态撤销的 legacy 字段在加载前返回明确兼容限制，不用 no-op 或“已成功但需重启”伪装
- [x] 10.6 增加存储、授权撤销、secret 脱敏和 legacy static/runtime-managed 对照测试

## 11. React 与 Vue 宿主绑定

- [x] 11.1 为 React 增加显式 borrowed/owned runtime 接口，mount/unmount 只 attach/detach editor，默认不重复加载应用插件
- [x] 11.2 增加 React Strict Mode、受控文档同步、多编辑器与 runtime 所有权测试
- [x] 11.3 为 Vue 增加与 React 等价的 borrowed/owned runtime 接口，避免 watcher/重挂载重复实例化 manifest
- [x] 11.4 增加 Vue mount/unmount、响应式属性更新、多编辑器与 runtime 所有权测试

## 12. Electron Demo 宿主适配

- [x] 12.1 在 renderer 建立单一 `NexusApp`/PluginRuntime 所有者和首个单 leaf Markdown Workspace adapter，并保留 feature flag 回退旧 boot 路径
- [x] 12.2 抽取 main/preload/renderer 共享的 capability IPC schema，对所有请求和响应执行运行时校验
- [x] 12.3 实现绑定 BrowserWindow sender、Vault session 和授权根的 Vault adapter，renderer 与插件只传规范化相对路径
- [x] 12.4 将现有文件 CRUD、watch、trash 和 LinkIndex 接入 Vault/FileManager/Metadata capability，并合并插件写入与 watcher 回声
- [x] 12.5 实现 Electron plugin storage 分区与原子保存，并接入可用的平台 Secret 后端或明确标记 deferred
- [x] 12.6 将现有 toolbar、status、settings、outline/backlinks 和菜单容器封装为 UI/Workspace slot，防止新旧路径重复挂载
- [x] 12.7 实现每个 BrowserWindow 的 WindowContext、资源 URL 策略以及外部 URL/协议/系统 shell 的独立可选授权
- [x] 12.8 实现停止分发 -> 卸载插件 -> detach view/editor -> 关闭 IPC/watch 的正常关机顺序和强制退出兜底
- [x] 12.9 增加 Electron 集成测试，覆盖 schema 拒绝、sender/session 校验、路径越界、watch 去重、trash 失败、重启存储恢复和关闭零残留

## 13. Reference Plugin 与迁移验证

- [x] 13.1 将 wordcount 实现为首个多编辑器生命周期插件，移除新路径的 attach-once 假设并保留旧 factory 导出
- [x] 13.2 将 toolbar 和 slash menu 接入命令、DOM 事件、UI slot 与 Component disposer，使用 feature flag 保证只有一个 owner 挂载 UI
- [x] 13.3 用 history、search、vim、GFM、math 和 wikilinks 建立 legacy adapter 的编译及运行 fixture
- [x] 13.4 将固定 commit 的 Obsidian sample plugin 显式移植为 Nexus fixture，覆盖生命周期、命令、editor-paste、status bar、setting tab、view 与 Vault event
- [x] 13.5 为 reference plugins 增加 enable/disable 循环、多编辑器、无头降级和旧/新 API 行为对照测试

## 14. 文档、兼容矩阵与发布门禁

- [x] 14.1 编写 Nexus 原生插件 API 指南、manifest schema、capability/permission 模型、生命周期和资源所有权示例
- [x] 14.2 编写从 Obsidian 公开 API 迁移的差异指南，固定参考 commit 并按 `native/adapter/deferred/unsupported` 维护符号族矩阵
- [x] 14.3 编写旧 `NexusPlugin` 到 `NexusPluginBase` 的渐进迁移指南、弃用周期和回滚方式，明确不提供 `obsidian` shim 或 `window.app`
- [x] 14.4 为 copy/cut/paste、命令热键、Widget/table target、文件路径和 trusted-plugin 安全边界编写可执行示例与负面示例
- [x] 14.5 运行公共 API 快照、TypeScript typecheck、所有包 build、Vitest 全量测试和 Electron 打包测试并修复回归
- [x] 14.6 运行多轮插件启停泄漏测试及多编辑器 CM6/Markdown 性能基准，记录 listener、timer、registry、DOM 和重配置耗时基线
- [x] 14.7 按六份 capability spec 逐项完成验收追踪，更新支持矩阵，并执行 `openspec validate add-plugin-platform-api --strict`
