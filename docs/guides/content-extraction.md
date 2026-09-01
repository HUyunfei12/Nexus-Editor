# Content Extraction

Because Nexus-Editor keeps the parsed `mdast` AST in sync with the document, it
can cheaply expose structured content — outlines and HTML — without a second
parse.

## Table of Contents

```ts
const toc = editor.getTableOfContents();
// TocEntry[] — heading level, text, and document offset.
```

`getTableOfContents()` walks the current AST and returns heading entries. Use it
to drive an outline / TOC panel (the Electron demo uses it for its outline).

## Markdown → HTML

```ts
const html = editor.exportHTML();
```

`exportHTML()` returns the current document rendered as HTML. It is intended for
export / preview outside the editor — the on-canvas live preview uses a
different (decoration-based) path.

> **Security note:** review XSS considerations in
> [`security-and-events.zh.md`](plugins/security-and-events.zh.md) before
> rendering `exportHTML()` output from untrusted sources.

## AST access

```ts
const ast = editor.getAst();   // the current mdast Root
const doc = editor.getDocument();
```

## Document stats

```ts
const stats = editor.getDocumentStats();
// { characters, words, lines }
```

Useful for a word-count status bar. The dedicated
`@floatboat/nexus-plugin-wordcount` provides Markdown-aware stats that
understand CJK and reading time.
