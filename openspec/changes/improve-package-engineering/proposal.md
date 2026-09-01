# Change: Improve package engineering (sideEffects, exports, bundle budget)

## Why

Only 3 of 14 packages (`plugin-api`, `plugin-runtime`, `reference-plugins`)
declare `sideEffects: false`. The remaining packages ship no CSS and have no
bare side-effect imports (verified), yet omit the field — so bundlers cannot
drop unused code, inflating the consumer bundle. All packages expose a single
`./dist/index.js` entry with no `module` field and no bundle-size guard in CI.
Compared to competitors (e.g. `@uiw/react-md-editor` `core`/`ui`/`nohighlight`
split entries), Nexus offers no way to slim the bundle.

## What Changes

- **Add `sideEffects: false`** to every library package that has no CSS and no
  bare side-effect import (all remaining packages). Bundlers can then tree-shake
  unused module graphs.
- **Add the `module` field** alongside `main` for tools that read it.
- **Harden `exports`** with a `"default"` condition so both ESM and CJS runners
  resolve faithfully, and keep `types` first.
- **Add a bundle-size budget** to CI using `size-limit` (or an equivalent) so
  package weight regressions fail the build. Gate on `nexus-core` (the critical
  surface), React, and Vue.
- **Document** the package-consumption / tree-shaking story in the getting-started
  guide.

## Impact

- Affected specs: `package-engineering` (new capability).
- Affected code: `package.json` across
  `core`, `plugin-history`, `plugin-math`, `plugin-search`, `plugin-slash`,
  `plugin-toolbar`, `plugin-vim`, `plugin-wordcount`, `preset-gfm`, `react`,
  `vue` (`plugin-api`, `plugin-runtime`, `reference-plugins` already have it).
  Plus root `package.json` (dev deps + size-limit script) and `.github/workflows/ci.yml`.
- **No runtime behavior change** — metadata/CI only.