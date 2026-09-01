# Folding

Nexus-Editor ships CodeMirror fold support for Markdown headings, fenced code
blocks, and indented content. It is opt-in.

## Enabling

```ts
import { createEditor, markdownFold } from "@floatboat/nexus-core";

const editor = createEditor({
  container: el,
  cmExtensions: [markdownFold()],
});
```

`markdownFold()` combines a **fold gutter** (click chevrons in the gutter) with
the fold service.

## What folds

- **Headings** — a heading folds down to the line before the next
  same-or-higher-level heading (or end of document).
- **Fenced code blocks** — fold from the opening fence to the closing fence.
- **Indented content** (lists, nested blocks) — a line with content folds
  over following deeper-indented lines.

## Raw access

`markdownFoldService()` returns just the fold-service extension (no gutter) if
you want to bring your own UI and only reuse the fold logic.

```ts
import { markdownFoldService } from "@floatboat/nexus-core";
```

The implementation lives in `packages/core/src/markdown-fold.ts`. It hooks
CM6's `foldGutter` + `foldService` and uses the document's line structure
directly (no AST dependency), so it stays fast and simple.
