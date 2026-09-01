# Change: Add QA gates (browser E2E, a11y, performance budget)

## Why

Nexus-Editor lacked any browser-level verification, so regressions in real-interaction paths (table widget drag, search panel, theme switching) could slip past unit tests. Per the comparison, Tiptap / MDXEditor ship browser test suites and CI regression gates; Nexus had none. We also had no performance guard, so hot paths like `setDocument` on large docs could silently degrade.

## What Changes

- **Add Playwright E2E suite** (`e2e/`) against a real harness build:
  - `e2e/harness/` — Vite app wiring `createEditor` + GFM/history/search/toolbar/wordcount with `livePreview:true`, exposing a `window.__nexus` bridge (getDocument/setDocument/exportHTML/setTheme/fontColor/tableCount).
  - `e2e/specs/editor.spec.ts` — table render, doc swap, typing→markdown, undo via real keystrokes, Ctrl+F search panel, theme swap, and an axe a11y scan (critical violations must be empty).
  - Root scripts `e2e:serve`, `e2e:test`, `e2e:install`, `e2e:a11y`.
  - New devDependencies: `@playwright/test`, `playwright`, `@axe-core/playwright`.
- **Add browser performance benchmark** (`scripts/bench.mjs` + `scripts/bench-budgets.json`):
  - Times `setDocument:1k`, `edit:100`, `exportHTML:1k` in a real Chromium session via the harness.
  - With `--budget`, fails the run when any metric exceeds its budget (the CI gate).
  - Root script `bench:core`.
- **Add CI quality gates** (`.github/workflows/ci.yml`): a new `browser-e2e` job that installs Playwright Chromium, runs the E2E suite, and enforces the performance budget.
- **Tooling**: fix Windows ESM path crash in the Node bench; `scripts/bench.mjs` loads the core bundle via `createRequire`. Add Playwright artifact dirs (`test-results/`, `playwright-report/`, `blob-report/`) to `.gitignore`.
- **No breaking changes** to any runtime API.

## Impact

- Affected specs: `qa-gates` (new capability).
- Affected code / files:
  - `e2e/**` (new) — harness, vite config, spec
  - `scripts/bench.mjs`, `scripts/bench-budgets.json` (new)
  - `.github/workflows/ci.yml` — add `browser-e2e` job
  - `package.json` — root scripts + devDependencies
  - `.gitignore` — Playwright artifact dirs
- New devDeps only; no runtime dependency changes.