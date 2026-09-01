# Getting Started

This guide gets your first Nexus-Editor running with React, Vue, or plain
JavaScript. You do **not** need to know CodeMirror to use the editor — you only
meet CodeMirror when you write a low-level plugin.

## 1. Install

```bash
# pnpm (recommended)
pnpm add @floatboat/nexus-core @floatboat/nexus-preset-gfm

# or npm / yarn
npm install @floatboat/nexus-core @floatboat/nexus-preset-gfm
```

For the framework binding, also install `@floatboat/nexus-react` (React) or
`@floatboat/nexus-vue` (Vue 3).

## 2. React

```tsx
import { Editor } from "@floatboat/nexus-react";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";

export default function App() {
  return (
    <Editor
      initialValue="# Hello, Nexus 👋"
      plugins={[createGfmPreset()]}
      livePreview
      onChange={(doc, ast) => console.log(doc)}
    />
  );
}
```

> The `<Editor />` handles the full lifecycle (mount, focus, destroy). Give
> your container a height or the editor will not render any visible area.

## 3. Vue 3

```vue
<script setup>
import { Editor } from "@floatboat/nexus-vue";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
</script>

<template>
  <Editor
    initial-value="# Hello"
    :plugins="[createGfmPreset()]"
    :live-preview="true"
    @change="(doc) => console.log(doc)"
  />
</template>
```

## 4. Vanilla / plain DOM

```ts
import { createEditor } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "# Hello\n\nStart editing...",
  plugins: [createGfmPreset(), createHistoryPlugin()],
  livePreview: true,
  onChange(doc, ast) {
    console.log("Markdown:", doc);
    console.log("AST:", ast);
  },
});
```

## 5. Newcomer tips

- **Headless = no theme.** Nexus ships logic, not visuals. Style it yourself
  (the Electron demo is a copy-pasteable starting point). You can use the
  built-in themes in [`theming.md`](guides/theming.md).
- **Live preview is opt-in.** With `livePreview: false` you get a clean raw
  Markdown editor.
- **The AST is `mdast`** — the same tree used by `remark` and the unified
  ecosystem. Start with the [mdast spec](https://github.com/syntax-tree/mdast).
- **Debounce before persisting.** `onChange` fires very densely — debounce file
  writes and network requests.
- **Blank page?** Ten to one the container has no height. Give it a height.

## 6. Run the Electron demo

```bash
git clone https://github.com/floatboatai/Nexus-Editor.git
cd Nexus-Editor
pnpm install
pnpm dev:electron-demo
```

The demo is a full Electron app with a note vault, wiki-links, a backlinks
panel, and live preview — the fastest way to see what Nexus can do.

## Bundle size & tree-shaking

All `@floatboat/nexus-*` packages are pure ESM, declare `"sideEffects": false`,
and expose `main` / `module` / `types` with an `exports` map. Bundlers can
tree-shake any part of a package you don't import, so install only the packages
you need:

- Raw editor only → `@floatboat/nexus-core` alone.
- Add GFM features → `@floatboat/nexus-preset-gfm`.
- Framework binding → `@floatboat/nexus-react` or `@floatboat/nexus-vue`.

> `nexus-core` includes heavier optional renderers (e.g. `highlight.js`,
> `mermaid`) behind its bundling; if your build tree-shakes they are dropped
> when unused. Run `node scripts/check-size.mjs` after `pnpm build` to see entry
> sizes. The repo enforces a bundle budget in CI (`pnpm check:size`).

## Next steps

- [Theming](guides/theming.md) — dark mode, custom themes.
- [API Reference](API.md) — full public surface.
- [Plugin docs](plugins/native-plugin-api.zh.md) — write your own plugin.
