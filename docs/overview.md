# Nexus-Editor Docs

Welcome to Nexus-Editor's developer documentation.

- **What it is**: a headless, AST-driven Markdown editor engine built on
  [CodeMirror 6](https://codemirror.net/) + the [unified](https://unifiedjs.com/)
  ecosystem. Framework-agnostic core with official React & Vue bindings. MIT.

Nexus keeps **Markdown as the source of truth** (lossless round-trip), gives you
Obsidian-style inline live preview, a Widget API, a three-tier plugin system, and
local-first file-IO hooks — without locking you into a WYSIWYG document model.

## Contents

### Getting started

- [Getting Started](getting-started.md) — React / Vue / Vanilla quickstarts.

### Guides

- [Theming](guides/theming.md) — `NexusTheme`, `lightTheme` / `darkTheme`, runtime switching.
- [Live Preview](guides/live-preview.md) — how inline preview works and how to extend it.
- [Markdown Table Editing](guides/live-preview-table.md) — the table widget interaction rules.
- [Folding](guides/folding.md) — `markdownFold()` / `markdownFoldService()`.
- [Content Extraction](guides/content-extraction.md) — TOC, `exportHTML()`, markdown-to-HTML.
- [Editing Features](guides/editing-features.md) — multi-cursor, wikilinks, auto-pair, keymap.

### Reference

- [API Reference](API.md) — public API of `@floatboat/nexus-core` and official plugins.
- [Native Plugin API](plugins/native-plugin-api.zh.md) — three-tier plugin platform.
- [Obsidian Migration](plugins/obsidian-migration.zh.md) — what to change when porting.
- [Legacy Plugin Migration](plugins/legacy-plugin-migration.zh.md) — upgrade path.
- [Security & Events](plugins/security-and-events.zh.md) — XSS surface and event model.

### Project

- [Roadmap](./ROADMAP.md) · [Roadmap (中文)](./ROADMAP.zh.md)
- [Showcase](../SHOWCASE.md) — community integrations.

## Quick orientation

| Area | Location |
|---|---|
| Editor engine & state | `packages/core/src/editor.ts`, `transaction-pipeline.ts` |
| Live preview & tables | `live-preview.ts`, `live-preview-table.ts`, `live-preview-renderers.ts` |
| Theme / fold / locale | `theme.ts`, `markdown-fold.ts`, `locale.ts` |
| Wiki links / multi-cursor | `wikilinks.ts`, `multi-cursor.ts` |
| Plugin platform | `packages/plugin-api/`, `packages/plugin-runtime/`, `packages/reference-plugins/` |
| React / Vue bindings | `packages/react/`, `packages/vue/` |
| Web Component wrapper | `packages/wc/` (`<nexus-editor>`) |
| Aggregated default preset | `packages/preset-bundle/` (`createDefaultPreset`) |
| MDX support analysis | `docs/mdx-support-analysis.md` |
| Desktop demo (vault, wikilinks, backlinks) | `apps/electron-demo/` |

## Contributing

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the [contributing Chinese version](../CONTRIBUTING.zh.md).
For spec-driven changes, read [`openspec/AGENTS.md`](../openspec/AGENTS.md).
