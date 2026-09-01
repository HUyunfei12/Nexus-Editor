# Change: Add developer docs, guides, and showcase

## Why

Nexus-Editor has a strong core (theme system, folding, TOC extraction, `exportHTML()`, wikilinks, multi-cursor) but almost none of it is discoverable or documented. README mentions `SHOWCASE.md` but it does not exist. Compared to Tiptap / MDXEditor / Milkdown, the onboarding surface (playground, guides, API reference, showcase, starter templates) is missing, which blocks adoption. The README's own "新手必读" advises users to read docs that do not exist yet.

## What Changes

- **Add `docs/` developer documentation hub:**
  - `docs/overview.md` — navigation index linking all guides / plugin docs / roadmap.
  - `docs/guides/` — deep-dive tutorials for the tricky / high-risk modules:
    - `live-preview.md` — how inline preview works, how to extend preview renderers.
    - `live-preview-table.md` — table widget interaction rules (the ones codified in AGENTS.md).
    - `theming.md` — `NexusTheme`, `lightTheme` / `darkTheme`, runtime switching.
    - `folding.md` — `markdownFold()` / `markdownFoldService()`.
    - `content-extraction.md` — TOC extraction, `exportHTML()`, markdown-to-HTML.
    - `editing-features.md` — multi-cursor, wikilinks, auto-pair, keymap.
  - `docs/API.md` — consolidated public API reference for core + plugins.
- **Add `SHOWCASE.md`** at repo root (already promised by README) for community integrations.
- **Add starter template** scaffold notes under `docs/getting-started.md` covering React / Vue / Vanilla with working code (matching README quickstart).
- **Bilingual**: mirror the highest-value docs (`overview`, `getting-started`, `theming`) in `.zh.md`.
- **No breaking changes** to any runtime API.

## Impact

- Affected specs: `developer-docs` (new capability).
- Affected code / files:
  - `docs/overview.md` (new)
  - `docs/getting-started.md` + `.zh.md` (new)
  - `docs/guides/*.md` (new)
  - `docs/API.md` (new)
  - `SHOWCASE.md` (new)
  - `README.md` / `README.zh.md` — link the new `docs/overview.md` and `SHOWCASE.md`, update broken references.
- No runtime deps, no package.json changes.
