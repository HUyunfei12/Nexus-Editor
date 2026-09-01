## ADDED Requirements

### Requirement: Developer documentation hub

The repository SHALL provide a `docs/overview.md` page that links every guide, the plugin API docs, and the roadmap, so a new contributor can navigate the project.

#### Scenario: New contributor navigates the docs
- **WHEN** a developer opens `docs/overview.md`
- **THEN** they can reach the guides, plugin docs, and roadmap via links

### Requirement: Getting-started guide

The repository SHALL provide a `docs/getting-started.md` with working React, Vue, and Vanilla quickstarts.

#### Scenario: React quickstart
- **WHEN** a React developer follows `docs/getting-started.md`
- **THEN** they can mount a `<Editor>` with a GFM preset in a few lines

### Requirement: Theming guide

The repository SHALL document the `NexusTheme` type, the `lightTheme` / `darkTheme` presets, and runtime theme switching, in both English and Chinese.

#### Scenario: Dark mode setup
- **WHEN** a developer reads `docs/guides/theming.md`
- **THEN** they know how to apply `darkTheme` and switch it at runtime

### Requirement: Live-preview table guide

The repository SHALL document the markdown table widget interaction rules so contributors do not reintroduce the known bugs.

#### Scenario: Table editing guidance
- **WHEN** a contributor reads `docs/guides/live-preview-table.md`
- **THEN** they learn the editing-lock and drag-handling rules for tables

### Requirement: Content extraction guide

The repository SHALL document TOC extraction, `exportHTML()`, and markdown-to-HTML export.

#### Scenario: Export markdown to HTML
- **WHEN** a developer reads `docs/guides/content-extraction.md`
- **THEN** they can use the editor's HTML export API

### Requirement: Public API reference

The repository SHALL provide a consolidated `docs/API.md` reference covering the public API of `@floatboat/nexus-core` and the official plugins.

#### Scenario: Look up an API
- **WHEN** a developer searches `docs/API.md` for a public symbol
- **THEN** they find its signature and usage

### Requirement: Showcase

The repository SHALL provide a `SHOWCASE.md` at the root listing community integrations and be linked from the README.

#### Scenario: Submit an integration
- **WHEN** a maintainer or contributor adds their integration to `SHOWCASE.md`
- **THEN** it is visible in the repo and linked from the README
