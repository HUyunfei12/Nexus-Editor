# `wc-and-preset` Specification

## ADDED Requirements

### Requirement: Web Component Embedding

The editor SHALL be embeddable in framework-less hosts as a custom element registered through `defineNexusEditor()` (aliased as `registerNexusEditor`), exposed by the `@floatboat/nexus-wc` package.

#### Scenario: Register and mount

- **GIVEN** a host that calls `defineNexusEditor("my-editor")`
- **THEN** a `<my-editor></my-editor>` element upgrades to the editor element
- **AND** inserting it into the DOM mounts an editor, `isMounted()` returns `true`, and `getEditor()` returns the `EditorAPI`

#### Scenario: Idempotent registration

- **WHEN** `defineNexusEditor` is called twice with the same tag name
- **THEN** the second call returns the same class without re-registering or throwing

#### Scenario: Controlled value without feedback loop

- **WHEN** a host sets the `value` property (or `value` attribute) on a mounted element
- **THEN** the document is updated via a silent `setDocument` and no `change` event is emitted

#### Scenario: User edit fires change

- **WHEN** the editor document changes through normal editing flow
- **THEN** the element dispatches a `change` event and does not reset the document on its own

#### Scenario: Teardown

- **WHEN** the element is removed from the DOM
- **THEN** the editor is destroyed and `getEditor()` returns `null` and `isMounted()` returns `false`

### Requirement: Aggregate Default Preset

The `@floatboat/nexus-preset-bundle` package SHALL provide a one-call `createDefaultPreset()` that returns an ordered `NexusPlugin[]` combining curated first-party plugins.

#### Scenario: Default composition

- **GIVEN** `createDefaultPreset()` with no options
- **THEN** the returned plugins include GFM, history, and search (in that order) and no toolbar, math, vim, or word-count plugin

#### Scenario: Opt-in plugins

- **WHEN** `createDefaultPreset({ toolbar: true, math: true, wordCount: { readingSpeed: 300 } })` is called
- **THEN** the returned plugins include a toolbar, a math, and a word-count plugin configured with the supplied options

#### Scenario: Search options passthrough

- **WHEN** `createDefaultPreset({ search: { caseSensitive: true } })` is called
- **THEN** the included search plugin is configured with `caseSensitive: true`

#### Scenario: Slash commands

- **WHEN** `createDefaultPreset({ slash: [{ id: "h1", title: "Heading 1" }] })` is called
- **THEN** the returned plugins include a slash plugin built from the provided `SlashCommandDef[]`

#### Scenario: Disable all by default

- **WHEN** `createDefaultPreset({ gfm: false, history: false, search: false })` is called
- **THEN** the returned array contains no plugins