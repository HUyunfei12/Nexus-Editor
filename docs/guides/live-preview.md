# Live Preview

Nexus-Editor provides **Obsidian-style inline live preview**: Markdown syntax is
rendered into rich widgets inside the editing surface, and structure reveal
(e.g. showing `**raw**` syntax) when your cursor is inside it.

## How it works

The preview is powered by CodeMirror `Decoration` and AST mapping:

1. CM6 parses the document (via Lezer) on every transaction.
2. The AST-to-mdast adapter produces an `mdast` tree in sync with the document.
3. A view plugin computes `LivePreviewRange`s — which spans are rendered and
   which are revealed because the cursor intersects them.
4. A renderer turns each marked range into an HTML widget/decoration
   (`live-preview-renderers.ts`).

Because the markdown text is always the source of truth, editing never "fights"
the WYSIWYG layer — the raw syntax is always recoverable by moving the cursor in.

## Enabling

```ts
const editor = createEditor({
  container: el,
  livePreview: true,          // opt-in
  plugins: [createGfmPreset()],
});
```

Without `livePreview`, you get a clean raw-Markdown editor.

`livePreview` also accepts a `LivePreviewConfig` object, letting you override
per-node-type renderers and UI labels without giving up the defaults:

```ts
createEditor({
  container: el,
  livePreview: {
    enabled: true,
    renderers: {
      image: (ctx) => renderMyImage(ctx),   // override one node type
    },
    labels: {
      addColumn: "＋",
      addRow: "＋",
    },
  },
});
```

## Extending preview rendering

Two extension points complement each other:

- **`livePreview.renderers`** — override a specific node type's inline preview
  renderer (image, link, code, table, ...). Default renderers live in
  `packages/core/src/live-preview-renderers.ts`.
- **Widget API (`plugins[].widgets`)** — render a custom component for an AST
  node matched by arbitrary predicates (e.g. a `code` node whose `lang` is
  `mermaid`). This is where diagram previews and interactive blocks go:

```ts
const mermaidWidget = {
  nodeType: "code",
  match: (node) => node.lang === "mermaid",
  render: (node, source) => renderMermaid(source),
  destroy: (el) => el.remove(),
};

createEditor({
  container: el,
  plugins: [createGfmPreset()],
  widgets: [mermaidWidget],
});
```

> For advanced custom widgets (interactive components inside markdown), see the
> plugin `widgets` tier in the [plugin docs](plugins/native-plugin-api.zh.md).

## Focus reveal

When the cursor is inside a Markdown "wrapper" (e.g. the `**` around a bold
segment, or the `![ ](...)` around a link), the raw syntax is revealed so you
can edit it directly. Moving the cursor out collapses it back to the rendered
form. This behavior is computed in `live-preview-ranges.ts`
(`collectLivePreviewRanges` + `selectionIntersects`).
