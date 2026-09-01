## 1. Implementation

- [ ] 1.1 Add `"sideEffects": false` to `core`, `preset-gfm`, `react`, `vue`, and all remaining `plugin-*` packages.
- [ ] 1.2 Add `"module"` field to the same packages.
- [ ] 1.3 Harden `exports` with a `"default"` condition (keep `types` first) in all packages.
- [ ] 1.4 Add `size-limit` dev dependency + `size-limit` script at the repo root targeting `nexus-core`, `nexus-react`, `nexus-vue`.
- [ ] 1.5 Add a `size-limit` job to `.github/workflows/ci.yml`.
- [ ] 1.6 Document the tree-shaking / bundle story in `docs/getting-started.md`.