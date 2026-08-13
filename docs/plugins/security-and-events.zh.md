# 插件事件与安全边界示例

本文中的正例使用 Nexus 公共合同，可放进 TypeScript fixture 做类型检查；负例是必须拒绝或避免的模式。

## 1. Copy、cut、paste 必须拦真实 DOM 事件

`Ctrl/Cmd+C/X/V` 是常见触发方式，不是剪贴板操作本身。系统菜单、上下文菜单、辅助技术和程序化浏览器动作都可能产生 `copy/cut/paste`；反过来，按下 `Ctrl/Cmd+V` 不代表浏览器已经给出可读的 clipboard payload。

正例：在每个 EditorHost 根节点的 capture dispatcher 注册 `paste`，并对实际事件同步决定 consume/pass：

```ts
import {
  EDITOR_HOST_CAPABILITY,
  PLUGIN_PRIORITY,
  type NexusPluginBase,
} from "@floatboat/nexus-plugin-api";

export function registerSafePaste(plugin: NexusPluginBase): void {
  const editors = plugin.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");
  const result = editors.registerDomEvent(
    "paste",
    (event, context) => {
      const text = event.clipboardData?.getData("text/plain");
      if (!text?.startsWith("nexus:")) return "pass";

      const replaced = context.replaceTargetSelection(text.slice("nexus:".length));
      if (!replaced.ok) {
        plugin.app.diagnostics.report(replaced.diagnostic);
        return "pass";
      }
      return "consume";
    },
    {
      phase: "capture",
      priority: PLUGIN_PRIORITY.normal,
      surfaces: ["document", "widget", "table"],
    },
  );
  if (!result.ok) plugin.app.diagnostics.report(result.diagnostic);
}
```

返回 `consume` 后宿主同步调用原事件的 `preventDefault()` 并停止后续可取消 handler。异步 Promise 或 handler 异常不能被当成取消。只想记录时使用 observer/通知机制，不要消费事件。

负例：把快捷键伪造成粘贴事件。

```ts
editors.registerDomEvent("keydown", (event, context) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
    context.editor.replaceSelection(cachedClipboardText); // 错：无真实 payload/权限/target。
    return "consume";
  }
  return "pass";
});
```

`copy`/`cut` 的 outgoing pipeline 必须先成功写入剪贴板，再删除来源选区。写入返回 `permission-denied`、`format-unsupported` 或 `failed` 时不得删除原内容。不要只保留 `text/plain`；结构化 payload 还可能含 `text/html`、文件和其他 MIME item。

## 2. 命令热键不是底层键盘监听器

正例：把用户意图注册为命令，使用 `Mod` 表达 macOS 的 Meta 和其他平台的 Ctrl：

```ts
const result = commands.registerCommand({
  id: "paste-as-quote",
  name: "Paste as quote",
  defaultHotkeys: [{ key: "V", modifiers: ["Mod", "Shift"] }],
  editorCheckCallback: (checking, context) => {
    if (!checking) context.editor.replaceSelection("> ");
    return true;
  },
});
```

`checkCallback`/`editorCheckCallback` 的 `checking=true` 是无副作用 availability probe；执行前会重验。不要在 probe 中写文档、打开 Modal 或更新存储。相同 scope 和 priority 的冲突不会按插件加载顺序任意选择，宿主会报告冲突。

需要 Modal 或特定 view 的临时键位时创建子 `Scope` 并 `pushScope()`；把返回 registration 交给对应 Component owner。不要永久监听 `window.keydown` 来绕过用户覆盖和焦点 scope。

## 3. Widget 与 table 使用真实 input target

DOM 事件上下文的 `surface` 可能是 `document/widget/table/external`。表格有自己的范围选择；Widget 也可能拥有独立 selection。永远优先调用 `context.replaceTargetSelection()`，不要无条件调用 document editor 的 `replaceSelection()`。

自定义可编辑 Widget 应注册 target adapter：

```ts
const registration = editors.registerInputTarget(
  widgetRoot,
  {
    id: "query-result-editor",
    kind: "widget",
    getSelectedText: () => selectionModel.text(),
    replaceSelection: (text) => {
      selectionModel.replace(text);
      return { ok: true, value: undefined };
    },
    copySelection: () => ({
      text: selectionModel.text(),
      html: null,
      files: [],
      items: [],
    }),
  },
  { editorId },
);
```

如果 Widget 没有注册 adapter，宿主必须返回 `input-target-unsupported`，不能把文本错误插到主文档光标。`WidgetDefinition.ignoreEvents` 只影响 CM6 光标处理，不会绕过宿主 capture hook。内置 table target 已处理单元格/范围语义，插件不应改 table cell border 或直接破坏其 selection DOM。

负例：事件发生在表格时写入主文档 selection。

```ts
editors.registerDomEvent("paste", (_event, context) => {
  context.editor.replaceSelection("wrong target");
  return "consume";
});
```

## 4. Vault 路径与资源 URL

公共文件对象只暴露规范化 Vault 相对路径和稳定 `fileId`，绝对路径不是合同。正例：

```ts
import { VAULT_CAPABILITY, type VaultPath, type WorkspaceId } from "@floatboat/nexus-plugin-api";

const vault = app.capabilities.require(
  VAULT_CAPABILITY,
  "^1.0.0",
  { workspaceId: "primary" as WorkspaceId },
);
const note = vault.getFileByPath("Notes/today.md" as VaultPath);
if (note) {
  const result = await vault.process(note, (text) => `${text}\n- reviewed`);
  if (!result.ok) app.diagnostics.report(result.diagnostic);
}
```

宿主必须在 IPC/main 边界再次校验路径、授权根和符号链接解析结果。renderer 中做过校验不构成信任。以下输入必须拒绝：

```ts
vault.getFileByPath("../secrets.txt" as VaultPath);
vault.getFileByPath("/Users/alice/vault/note.md" as VaultPath);
vault.getFileByPath("Notes/../../outside.md" as VaultPath);
```

不要拼 `file://` URL 或泄漏磁盘路径。使用 `RESOURCES_CAPABILITY` 取得绑定 host/Vault/授权的可撤销 opaque URL，并在 Component 卸载时释放 registration。删除默认走 `trash()`；永久删除要求单独权限和显式 `{ permanent: true }`。

## 5. Trusted same-realm 的真实边界

第一阶段插件是宿主明确安装的 `bundled/development/local-trusted` 代码，与宿主运行在同一个 renderer JavaScript realm。这意味着：

- capability 和 permission 提供兼容检查、最小服务面、审计、正常撤销与误用防护。
- loader 不向入口注入 Node、Electron、动态 `require` 或通用 `ipcRenderer.invoke`。
- 但同 realm 不是恶意代码隔离：插件仍可使用浏览器全局、占用 CPU、篡改可达对象或绕过约定读取页面内容。
- `contextIsolation`、路径校验和 IPC sender/session 绑定保护主进程边界，不能把 renderer 内任意插件变成安全沙箱。

正例：只请求完成任务所需的 capability，把所有 registration 归入 owner，并对 optional/撤销结果降级。

负例：把 permission 当作不可绕过的 ACL，或声称“未声明 `vault.read` 的恶意同 realm 插件无法观察页面上的笔记文本”。这不是当前架构保证。真正运行不可信插件需要 Worker、isolated world 或独立进程，以及结构化消息、资源配额和独立威胁模型。

同样禁止以下接口逃逸：

```ts
const app = (window as unknown as { app: unknown }).app; // 不存在且不受支持。
const fs = require("node:fs");                            // 插件入口不提供 require/Node。
window.nexusIpc.invoke("read-file", absolutePath);        // 不提供通用 IPC escape hatch。
```

安全审查应同时验证正向能力和负向边界：路径穿越/符号链接越界、权限撤销、剪贴板写失败不删源、HTML sanitization、外部 URL scheme policy、重复启停零 listener/timer/DOM/registry 残留。
