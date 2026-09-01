# Tasks: Add ecosystem packages

## 1. Web Component package (`packages/wc`)
- [x] 1.1 Create `package.json` / `tsconfig.json` matching monorepo shape
- [x] 1.2 Implement `NexusEditorElement` lifecycle, `config` property, controlled `value`, live-preview/readonly attributes
- [x] 1.3 Export `defineNexusEditor` / `registerNexusEditor` + type re-exports
- [x] 1.4 Write vitest suite (mount, seeding, controlled value, no-loop, change event, disconnect)
- [x] 1.5 Build (tsup ESM + DTS) and typecheck

## 2. Aggregated preset package (`packages/preset-bundle`)
- [x] 2.1 Create `package.json` / `tsconfig.json` matching monorepo shape
- [x] 2.2 Implement `createDefaultPreset` with ordered stack + option passthrough
- [x] 2.3 Write vitest suite (default order, all-off, opt-ins, slash commands, search options)
- [x] 2.4 Build (tsup ESM + DTS) and typecheck

## 3. MDX feasibility analysis
- [x] 3.1 Document parse / AST / export / widget impact in `docs/mdx-support-analysis.md`
- [x] 3.2 Recommend defer + Phase-0 design-doc path (no core change)

## 4. Workspace wiring
- [x] 4.1 Register `@floatboat/nexus-wc` and `@floatboat/nexus-preset-bundle` aliases in `vitest.config.ts`
- [x] 4.2 Add both packages to the root `build` chain in `package.json`
- [x] 4.3 Run vitest + typecheck + package builds green

## 5. Docs & OpenSpec
- [x] 5.1 ROADMAP (22 done; 24–25 added) + `docs/overview.md`
- [x] 5.2 Create `openspec/changes/add-ecosystem-packages/` proposal / tasks / spec delta