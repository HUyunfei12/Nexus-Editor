# Obsidian sample plugin source

- Repository: https://github.com/obsidianmd/obsidian-sample-plugin
- Commit: `07ceb81d1fb3384af611ebf665a1ec42a7e5926d`
- Upstream files consulted: `src/main.ts`, `src/settings.ts`, `manifest.json`, `LICENSE`
- License: ISC-style grant preserved verbatim in `LICENSE`

`src/obsidian-sample-port.ts` is an explicit Nexus port, not an `obsidian`
namespace shim and not a claim that the upstream plugin runs unchanged. It maps
the sample's lifecycle, commands, status/ribbon UI, setting tab and managed DOM
resources to Nexus capabilities, then adds the editor-paste, view and Vault
event fixtures required by the Nexus migration specification.
