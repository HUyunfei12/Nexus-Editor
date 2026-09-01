# Tasks

## 1. Implement `fuzzyScore` and `findFuzzyMatches`

- [x] Add `fuzzyScore(query, text, { caseSensitive? })` implementing subsequence
      matching with consecutive / word-boundary bonuses; returns
      `Number.NEGATIVE_INFINITY` when no subsequence match exists.
- [x] Use a collision-free memo key (`queryIndex * text.length + textIndex`) in the
      backtracking scorer — verified with a >12000-char document regression test.
- [x] Add `findFuzzyMatches(doc, query, opts?)` returning `SearchMatch[]` in doc order
      via a greedy in-order pass (each query char matched at its first occurrence).
- [x] Export both from `packages/plugin-search/src/index.ts`.
- [x] Reuse the `SearchMatch` type from the existing matcher for drop-in compat.

## 2. Tests

- [x] Add tests to `packages/plugin-search/test/plugin-search.test.ts` covering the
      spec scenarios: document order (spanning skips), non-subsequence, case
      sensitivity, empty/whitespace query, empty document, scoring rank, consecutive
      > spread, and long-document memo-collision.
- [x] Run `pnpm vitest run packages/plugin-search/test/plugin-search.test.ts`
      (43 tests pass).

## 3. Docs

- [x] Document `findFuzzyMatches` / `fuzzyScore` usage in `docs/API.md`.
- [x] Mark ROADMAP #17 (fuzzy search) as done in `docs/ROADMAP.md` and
      `docs/ROADMAP.zh.md`.