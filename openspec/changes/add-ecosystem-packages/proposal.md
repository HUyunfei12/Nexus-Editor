# Change: Add ecosystem packages (Web Component, aggregated preset) and MDX feasibility analysis

## Why

Nexus-Editor's React and Vue SDKs cover framework-native hosts, but framework-less users have no path to embed the editor, and onboarding 14 packages doesn't compose one. Per the comparison, competing editors (ProseMirror on the web, CodeMirror-6 wrappers, MDXEditor) expose plain `<iframe>`/custom-element embeddings and one-call default configurations. This change closes both gaps and de-risks MDX (the largest speculative roadmap item) with a written feasibility study rather than a blind implementation.

## What Changes

- **Web Component wrapper** (new package `@floatboat/nexus-wc`):
  - `NexusEditorElement` extends `HTMLElement`, registered (idempotently) via `defineNexusEditor([name])` (default tag `nexus-editor`); alias export `registerNexusEditor`.
  - Observed attributes: `value`, `initial-value`, `live-preview`, `readonly`.
  - Object/function config (plugins, theme, locale, tabSize, direction, indentGuides, parser, parseDelayMs, slashMenuLimit, multiCursor, onAssetUpload, onChange, onFocus, onBlur) set via the instance `config` property.
  - Instance API: `getEditor(): EditorAPI | null`, `isMounted(): boolean`, `value` getter/setter.
  - Controlled `value`: setting the property or the `value` attribute applies a silent `setDocument` (no loop); user edits surface through a `change` event (no auto re-sync).
  - Lifecycle: `connectedCallback` creates the editor and dispatches `ready`; `disconnectedCallback` schedules a guarded destroy (microtask + destroyToken, mirroring the React SDK) and nulls `getEditor()`.
  - No `autoFocus` (the core `EditorConfig` has none).
- **Aggregated default preset** (new package `@floatboat/nexus-preset-bundle`):
  - `createDefaultPreset(options?)` returns an ordered `NexusPlugin[]`: `createGfmPreset()` + `createHistoryPlugin()` + (optional) `createSearchPlugin()` by default; `toolbar`, `math`, `vim`, `wordcount` opt-in; `slash` accepts `SlashCommandDef[]`.
  - Re-exports `createGfmPreset` and the Search/WordCount option types for tree-shaken discovery.
- **MDX feasibility analysis** (`docs/mdx-support-analysis.md`, research only — no code change): documents that MDX touches the Lezer parse path, the mdast adapter, HTML export (micromark-based), folding, TOC, and table widgets; recommends deferring and starting with a tech-selection design doc (Phase 0 POC via the existing `config.parser` seam).
- **Conventions**: both packages follow the monorepo package shape (`type:module`, `sideEffects:false`, `main`/`module`/`types` → `dist/*`, tsup build, `files:["dist"]`, public). Both are registered in the root `vitest.config.ts` aliases, added to the root `build` script chain, and covered by vitest suites.
- **Docs**: ROADMAP (row 22 done; rows 24–25 added), `docs/overview.md` package table.
- **No breaking changes** to any existing runtime API.

## Impact

- Affected specs: `wc-and-preset` (new capability; Web Component contract + preset composition order). The MDX analysis is research-only and intentionally NOT a spec delta.
- Affected code / files:
  - `packages/wc/` (new) — `src/element.ts`, `src/index.ts`, `test/wc.test.ts`
  - `packages/preset-bundle/` (new) — `src/index.ts`, `test/preset-bundle.test.ts`
  - `docs/mdx-support-analysis.md` (new)
  - `vitest.config.ts` — two new aliases
  - `package.json` — build chain includes both new packages
  - `docs/ROADMAP.md`, `docs/ROADMAP.zh.md`, `docs/overview.md`
- New packages only; no runtime dependency changes to existing packages.