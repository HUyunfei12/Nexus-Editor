# Add fuzzy search to the search plugin

## Why

`@floatboat/nexus-plugin-search` currently supports `caseSensitive`, `wholeWord`,
`regexp`, and `literal` matching only. Competitors (VS Code, vim's `fzf`, toast
UI editors) all offer **fuzzy / subsequence matching**: the query characters
match a hit in order with skips allowed, so `prcs` finds `process`. This is the
natural, high-value extension missing from our search plugin (ROADMAP #17).

CM6's native `SearchQuery` has no fuzzy cursor, so wiring fuzzy into the
in-editor panel cursor is non-trivial and risks destabilizing the highly
specialized search/table-highlight machinery. We therefore ship fuzzy matching
as a **pure, exported, opt-in utility** that hosts can use directly (and future
UIs can build on), exactly mirroring the additive `findSearchMatches` API.

## Out of scope

- Wiring fuzzy into the in-editor CM6 search panel cursor (separate, higher-risk change).
- A fuzzy UI toggle in the panel.
- Tunable ranking weights (boundary bonus / gap penalty are deliberately fixed
  constants so `fuzzyScore` stays a simple rank key; hosts wanting fzf-grade
  tuning can swap in their own scorer).

## Change

- Add `findFuzzyMatches(doc, query, options?)` to `@floatboat/nexus-plugin-search`.
- Add a `fuzzyScore(query, text, { caseSensitive? })` helper (also exported)
  implementing subsequence matching with consecutive-character and word-boundary
  bonuses; returns `-Infinity` when no in-order match exists.
- Reuse the existing `SearchMatch { from; to; text }` shape so fuzzy results drop
  into replacement/selection flows unchanged.

## Notes

- `findFuzzyMatches` uses a greedy in-order pass (each query character matched at
  its first occurrence), producing the earliest bounded match — suitable for
  highlighting; it is not the maximum-score alignment.
- `fuzzyScore` uses a memoized backtracking scorer (per-call memo keyed by
  `queryIndex * text.length + textIndex`, so it is collision-free on any doc
  length) — suitable as an `Array.prototype.sort` rank key.