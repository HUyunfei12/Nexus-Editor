# Theming

Nexus-Editor's theme system lets you control colors, fonts, and content width.
It is headless by design — Nexus does not ship a full visual theme out of the
box, but it provides tokens, light/dark presets, and runtime switching.

## The theme type

```ts
import type { NexusTheme } from "@floatboat/nexus-core";

// Common tokens: bg, bgSubtle, bgMuted, text, textMuted, textFaint,
// border, borderSubtle, accent, tooltipBg, tooltipText,
// syntax-highlight tokens (hlKeyword, hlString, hlTitle, ...),
// plus optional fontSize (px), fontFamily, fontFamilyMono, contentMaxWidth.
```

All color tokens are mapped to `--nexus-*` CSS custom properties at render time,
so they compose with your host app's CSS variables.

## Using the presets

Nexus ships `lightTheme` and `darkTheme`. Wire one into the editor via the
`theme` config option:

```ts
import { createEditor, darkTheme } from "@floatboat/nexus-core";

const editor = createEditor({
  container: el,
  theme: darkTheme,
});
```

## Runtime switching

Use `setTheme(nextTheme)` to swap themes after mount:

```ts
// toggle dark mode
editor.setTheme(isDark ? darkTheme : lightTheme);
```

Switching reconfigures the theme **compartment** — a single CM6 transaction,
so it is cheap and does not recreate the editor.

## Custom theme

Build your own `NexusTheme` object and pass it anywhere a theme is accepted:

```ts
const myBrand = {
  bg: "#ffffff",
  bgSubtle: "#f6f8fa",
  bgMuted: "#f0f0f0",
  text: "#1a1a1a",
  textMuted: "#6b7280",
  textFaint: "#9ca3af",
  border: "#e5e7eb",
  borderSubtle: "#e5e7eb",
  accent: "#4f46e5",
  tooltipBg: "#1f2937",
  tooltipText: "#f9fafb",
  hlKeyword: "#d73a49",
  hlString: "#032f62",
  hlTitle: "#6f42c1",
  hlComment: "#6a737d",
  hlNumber: "#005cc5",
  hlType: "#e36209",
  hlDeletion: "#b31d28",
  hlVariable: "#24292e",
  fontSize: 16,
  contentMaxWidth: "720px",
};
```

## Content width

Set `contentMaxWidth` (e.g. `"700px"`) to constrain the prose column and center
it — useful for reading-focused layouts (notes, articles).
