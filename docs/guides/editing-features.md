# Editing Features

This guide covers the built-in power-editing features on top of the core editor.

## Multi-cursor / multi-selection

Opt-in multi-cursor support (`packages/core/src/multi-cursor.ts`).

```ts
import { createEditor, multiCursorExtension } from "@floatboat/nexus-core";

const editor = createEditor({
  container: el,
  multiCursor: true,            // config flag
  // or wire the extension directly:
  // cmExtensions: [multiCursorExtension()],
});
```

Get/select multiple ranges through the public API:

```ts
const ranges = editor.getSelections();         // all ranges + main index
editor.setSelections([
  { anchor: 0 },
  { anchor: 20, head: 26 },
], 1);                                         // mainIndex defaults to last
```

`setSelections` requires `multiCursor: true` — otherwise CodeMirror collapses
the selection to the main range. Standalone commands (`selectNextOccurrence`,
`addCursorAbove/Below`, `collapseToMainSelection`) are also exported.

## Wiki links

Obsidian-style `[[target]]` / `[[target|alias]]` inline links
(`packages/core/src/wikilinks.ts`). Opt-in; use the plugin form for easy wiring:

```ts
import { createWikilinksPlugin } from "@floatboat/nexus-core";

createEditor({
  container: el,
  plugins: [
    createWikilinksPlugin({
      resolve(name, fromPath) { /* return resolved path or null */ },
      onNavigate(target) { /* open the note */ },
      suggest(query) { /* return autocomplete candidates */ },
    }),
  ],
});
```

`scanWikiLinks(doc)` is a pure helper that returns all `[[...]]` matches.

## Auto-pairing

```ts
import { markdownAutoPair } from "@floatboat/nexus-core";
// wire via cmExtensions: [markdownAutoPair()]
```

Adds smart pair/backspace behavior for Markdown delimiters (bold `**`, italic
`*`, code `` ` `` and backticks, etc.).

## Keymap & Enter behavior

```ts
import { markdownKeymap, handleMarkdownEnter } from "@floatboat/nexus-core";
```

`markdownKeymap()` wires the default keymap; `handleMarkdownEnter(view)` is the
smart Enter handler used for list/quote/heading auto-continuation.

## Selection & edit primitives

```ts
const sel = editor.getSelection();        // { anchor, head }
const text = editor.getSelectedText();    // selected text ('' if collapsed)

// Atomic range replace — ONE transaction = ONE undo entry.
editor.replaceRange(from, to, insert, selection?, { silent? });
```

Prefer `replaceRange` over a `setDocument` + `setSelection` pair when editing a
range: the latter produces two undo entries and can mangle the document after a
single Ctrl+Z.

## Undo / Redo

The core exposes `undo()` / `redo()`. The
`@floatboat/nexus-plugin-history` plugin provides `Ctrl+Z` / `Ctrl+Shift+Z`
keybindings:

```ts
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
// plugins: [createHistoryPlugin()]
```
