# plugin-search

## Spec Path
plugins/plugin-search

## ADDED Requirements

### ADDED: Fuzzy matching utility
`@floatboat/nexus-plugin-search` MUST export a `findFuzzyMatches` function that
returns subsequence (fuzzy) matches of a query within a document.

#### Scenario: Returns matches in document order, spanning skipped characters
Given a document `"aXbYc aXbYc"` and query `"abc"`,
then `findFuzzyMatches(doc, "abc")` MUST return an array of `SearchMatch` objects
`[{ from: 0, to: 5, text: "aXbYc" }, { from: 6, to: 11, text: "aXbYc" }]` — each
match is the greedy in-order subsequence (query chars matched at their first
occurrence), so the skipped `X`/`Y` characters are included in `text`.

#### Scenario: Requires in-order subsequence
Given a document `"abc"` and query `"cba"`, then `findFuzzyMatches` MUST return
an empty array because the query characters cannot be matched in order.

#### Scenario: Honors case sensitivity
Given `findFuzzyMatches("process Processor", "pr", { caseSensitive: true })`,
then a match MUST only be produced where the lowercase `p` followed by lowercase
`r` occur, so the result is `[{ from: 0, to: 2, text: "pr" }]` (matching
`process`) and NOT the uppercase `Processor`.

#### Scenario: Empty or whitespace query returns no matches
Given `findFuzzyMatches(doc, "")` or `findFuzzyMatches(doc, "   ")`, then the
result MUST be an empty array.

#### Scenario: Empty document returns no matches
Given `findFuzzyMatches("", "q")`, then the result MUST be an empty array.

### ADDED: Fuzzy scoring helper
`@floatboat/nexus-plugin-search` MUST export a `fuzzyScore` function usable as a
rank key.

#### Scenario: Non-matching query yields non-matching score
Given `fuzzyScore("xyz", "transition")`, the result MUST be `Number.NEGATIVE_INFINITY`
(or otherwise indicate no match).

#### Scenario: Consecutive characters score higher than spread characters
Given a fixed text, `fuzzyScore("prc", "process")` MUST be greater than
`fuzzyScore("pcs", "process")` because `p`,`r`,`c` match consecutively.