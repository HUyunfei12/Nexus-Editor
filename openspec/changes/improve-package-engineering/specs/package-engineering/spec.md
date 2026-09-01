## ADDED Requirements

### Requirement: Tree-shaking metadata

Every published library package SHALL declare `"sideEffects": false` unless it
contains CSS or a bare side-effect import.

#### Scenario: Bundler tree-shakes unused code
- **WHEN** a consumer imports a single export from a Nexus package with a bundler
- **THEN** the bundler can drop the rest of that package's module graph

### Requirement: Module resolution fields

Every published library package SHALL provide `main`, `module`, and `types`
fields, and an `exports` map with `types` first and a `default` condition.

#### Scenario: CJS and ESM resolve the same entry
- **WHEN** a CJS runner or an ESM runner imports a Nexus package
- **THEN** they both resolve to the intended entry without resolution errors

### Requirement: Bundle-size budget in CI

The repository SHALL enforce a bundle-size budget on the core, React, and Vue
packages in CI so weight regressions fail the build.

#### Scenario: Bundle grows beyond budget
- **WHEN** a change increases `nexus-core` packaged size beyond the configured limit
- **THEN** CI fails and flags the regression