# 快速上手

本指南帮助你用 React、Vue 或原生 JavaScript 运行第一个 Nexus-Editor。

Nexus 以无头（Headless）引擎发布，不需要懂 CodeMirror 就能使用——你只在写底层插件时才会碰到它。

## 1. 安装

```bash
# pnpm（推荐）
pnpm add @floatboat/nexus-core @floatboat/nexus-preset-gfm

# npm / yarn
npm install @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

如使用框架绑定，还需安装 `@floatboat/nexus-react`（React）或 `@floatboat/nexus-vue`（Vue 3）。

## 2. React

```tsx
import { Editor } from "@floatboat/nexus-react";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

export default function App() {
  return (
    <Editor
      initialValue="# 你好，Nexus 👋"
      plugins={[createGfmPreset()]}
      livePreview
      onChange={(doc, ast) => console.log(doc)}
    />
  );
}
```

> 请给容器设置高度，否则编辑器不可见。

## 3. Vue 3

```vue
<script setup>
import { Editor } from "@floatboat/nexus-vue";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
</script>

<template>
  <Editor
    initial-value="# 你好"
    :plugins="[createGfmPreset()]"
    :live-preview="true"
    @change="(doc) => console.log(doc)"
  />
</template>
```

## 4. 原生 / 纯 DOM

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# 你好\n\n开始编辑...",
  plugins: [createGfmPreset(), createHistoryPlugin()],
  livePreview: true,
  onChange(doc, ast) {
    console.log("Markdown:", doc);
    console.log("AST:", ast);
  },
});
```

## 5. 新手提示

- **Headless 意味着没有主题。** Nexus 提供逻辑，不提供外观。可使用内置的 `lightTheme` / `darkTheme`，或参考 `guides/theming.md` 自行定制。
- **实时预览是 opt-in 的。** 关闭 `livePreview` 就是纯 Markdown 编辑器。
- **AST 是 `mdast`** —— remark/unified 生态的标准语法树，参考 [mdast 规范](https://github.com/syntax-tree/mdast)。
- **不要在每次按键时存盘。** `onChange` 触发频率极高，请做防抖。
- **页面空白？** 多半是容器没有高度。

## 6. 运行 Electron Demo

```bash
git clone https://github.com/floatboatai/Nexus-Editor.git
cd Nexus-Editor
pnpm install
pnpm dev:electron-demo
```

这是观察 Nexus 全部能力的最快路径：笔记库、Wiki 链接、反向链接面板、实时预览，以及完整的插件栈。

## 下一步

- [Theming 指南](guides/theming.md) —— 暗色模式、自定义主题
- [API 参考](API.md) —— 完整公开 API
- [插件文档](plugins/native-plugin-api.zh.md) —— 编写自己的插件
