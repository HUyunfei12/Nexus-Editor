# Nexus-Editor API Reference

This is a consolidated reference for the public surface of `@floatboat/nexus-core`
and the official packages. It focuses on the engine and the most common options;
the [plugin docs](plugins/native-plugin-api.zh.md) cover the plugin platform in
depth.

## `createEditor(config: EditorConfig): EditorAPI`

Creates a headless editor instance.

### EditorConfig

| Option | Type | Notes |
|---|---|---|
| `container` | `HTMLElement` | **Required** mount node. |
| `initialValue` | `string | undefined` | Initial Markdown. |
| `plugins` | `NexusPlugin[] | undefined` | Plugin platform (see below). |
| `livePreview` | `boolean \| LivePreviewConfig \| undefined` | Inline preview (opt-in). |
| `multiCursor` | `boolean \| undefined` | Enable multi-selection & commands. |
| `theme` | `NexusTheme \| undefined` | Color/font theme (see `theming.md`). |
| `locale` | `Partial<NexusLocale> \| undefined` | Localization strings. |
| `widgets` | `WidgetDefinition[] \| undefined` | AST-node widgets (renders custom components). |
| `cmExtensions` | `Extension[] \| undefined` | Raw CM6 extensions (Tier 3). |
| `onChange` / `onFocus` / `onBlur` | `fn \| undefined` | Lifecycle callbacks. |
| `onAssetUpload` | `(file: File) => Promise<string> \| undefined` | Image/file upload hook. |

### EditorAPI

| Method | Description |
|---|---|
| `getDocument()` | Current Markdown text. |
| `getAst()` | Current `mdast Root`. |
| `getTableOfContents()` | `TocEntry[]` heading outline. |
| `exportHTML()` | Current document as HTML string. |
| `getSelection()` | `{ anchor, head }`. |
| `getSelections()` | All ranges + main index. |
| `getSelectedText()` | Selected text (`''` when collapsed). |
| `setSelection(anchor, head?)` | Move cursor. |
| `setSelections(ranges, mainIndex?)` | Replace ranges (needs `multiCursor`). |
| `setDocument(md, opts?)` | Replace whole doc (`silent` / `preserveSelection` / `selection`). |
| `replaceRange(from, to, insert, selection?, opts?)` | Atomic range edit (1 undo entry). |
| `replaceSelection(text)` | Replace current selection. |
| `setTheme(theme)` | Swap theme at runtime. |
| `getSlashCommands()` | Registered slash commands. |
| `getCommands()` / `runCommand(id)` | Command registry / execution. |
| `uploadAsset(file)` | Push a file through the upload hook. |
| `undo()` / `redo()` | Undo / redo (returns boolean). |
| `runShortcut(key)` | Run a registered keybinding by name. |
| `getDocumentStats()` | `{ characters, words, lines }`. |
| `isComposing()` | Whether an IME composition is active. |
| `focus()` / `blur()` | Manage focus. |
| `getCoordsAtPos(pos)` | Screen rect for UI positioning. |
| `getPosAtDOM(node)` | Invert a live-preview widget DOM node to a doc offset. |
| `on(event, handler)` / `off(event, handler)` | Event subscription. |
| `destroy()` | Tear down the editor. |

Events: `change`, `focus`, `blur`, `selectionChange`, `slashMenuChange`.

## Standalone core exports

| Export | Type / Purpose |
|---|---|
| `lightTheme`, `darkTheme`, `NexusTheme` | Themes (`theming.md`). |
| `enLocale`, `zhLocale`, `resolveLocale`, `NexusLocale` | i18n. |
| `markdownFold()`, `markdownFoldService()` | Folding (`folding.md`). |
| `markdownAutoPair()` | Delimiter auto-pairing. |
| `markdownKeymap()`, `handleMarkdownEnter()` | Keymap + smart Enter. |
| `multiCursorExtension()`, `multiCursorKeymap` | Multi-cursor (`editing-features.md`). |
| `scanWikiLinks(doc)`, `createWikilinksPlugin()`, `createWikilinksExtension()` | Wiki links. |
| `createWidgetExtension()`, widget definitions | Widget API. |

## Official packages

| Package | Purpose |
|---|---|
| `@floatboat/nexus-react` | `Editor` component + `useEditor` hook. |
| `@floatboat/nexus-vue` | Vue 3 `Editor` + composable. |
| `@floatboat/nexus-preset-gfm` | GFM (tables, strikethrough, task lists). |
| `@floatboat/nexus-plugin-history` | Undo/redo (`Ctrl+Z` / `Ctrl+Shift+Z`). |
| `@floatboat/nexus-plugin-search` | Search & replace helpers. |
| `@floatboat/nexus-plugin-slash` | Slash-command detection + floating menu UI. |
| `@floatboat/nexus-plugin-toolbar` | Toolbar primitives + formatting commands. |
| `@floatboat/nexus-plugin-math` | Inline/block math (KaTeX). |
| `@floatboat/nexus-plugin-vim` | Vim keybindings. |
| `@floatboat/nexus-plugin-wordcount` | Markdown-aware stats + ARIA status bar. |
| `@floatboat/nexus-plugin-api` / `@floatboat/nexus-plugin-runtime` | Plugin platform API & runtime. |

## `@floatboat/nexus-plugin-search` matched-search helpers

| Function | Signature | Purpose |
|---|---|---|
| `findSearchMatches` | `(doc, query, options?) => SearchMatch[]` | Exact / regex / whole-word matches. |
| `replaceAllMatches` | `(doc, query, replacement, options?) => string` | Replace all matches. |
| `findFuzzyMatches` | `(doc, query, options?) => SearchMatch[]` | Subsequence (fuzzy) matches in doc order. |
| `fuzzyScore`(`query`, `text`, `options?`) | `(string, string, { caseSensitive? }) => number` | Rank key for fuzzy matching; `-Infinity` if no match. |

`SearchMatch = { from: number; to: number; text: string }`. Fuzzy options:
`{ caseSensitive?: boolean }` (default `false`). `fuzzyScore` rewards consecutive
characters and word / CamelCase boundaries, so `fuzzyScore("prc", "process")`
scores higher than `fuzzyScore("pcs", "process")`, making it suitable as an
`Array.prototype.sort` key.

> Signatures are representative. Source of truth: the `dist/*.d.ts` files after
> `pnpm build`, especially `packages/core/src/types.ts` and `index.ts`.
