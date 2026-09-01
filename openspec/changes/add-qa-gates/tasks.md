# Change: Add QA gates (browser E2E, a11y, performance budget)

## 1. Implementation

- [x] 1.1 Playwright harness app under `e2e/harness/` wiring `createEditor` with GFM/history/search/toolbar/wordcount, `livePreview:true`
- [x] 1.2 Expose `window.__nexus` bridge (getDocument/setDocument/exportHTML/setTheme/fontColor/tableCount)
- [x] 1.3 E2E specs covering table render, setDocument swap, typing→markdown, real-keystroke undo, Ctrl+F search panel, theme swap, axe a11y
- [x] 1.4 Add `@playwright/test`, `playwright`, `@axe-core/playwright` devDependencies + root scripts `e2e:serve`/`e2e:test`/`e2e:install`/`e2e:a11y`
- [x] 1.5 Browser perf benchmark `scripts/bench.mjs` (setDocument:1k / edit:100 / exportHTML:1k) with `--budget` gate + `scripts/bench-budgets.json`
- [x] 1.6 Root script `bench:core`; fix Windows ESM path crash via `createRequire`
- [x] 1.7 CI `browser-e2e` job: install Chromium, run E2E, enforce perf budget
- [x] 1.8 `.gitignore` entries for Playwright artifacts

## 2. Verification

- [x] 2.1 `pnpm vitest run <file>` unaffected (unit tests still pass)
- [x] 2.2 `npx playwright test` passes (7 specs)
- [x] 2.3 `npx playwright test --grep accessibility` passes (critical violations empty)
- [x] 2.4 `node scripts/bench.mjs --budget scripts/bench-budgets.json` passes all budgets
- [x] 2.5 CI YAML is valid (no duplicate keys, references exist)