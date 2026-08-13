import type { CapabilityRegistry } from "./capability";
import type { DiagnosticReporter } from "./diagnostics";
import type { SemanticVersion } from "./identifiers";
import type { PluginPlatform } from "./manifest";

export interface NexusHostIdentity {
  readonly id: string;
  readonly name: string;
  readonly version: SemanticVersion;
  readonly platform: PluginPlatform;
}

/**
 * A small, immutable host facade. Domain services are discovered through
 * capabilities so a host never has to expose a concrete, all-powerful App.
 */
export interface NexusApp {
  readonly host: NexusHostIdentity;
  readonly apiVersion: SemanticVersion;
  readonly capabilities: CapabilityRegistry;
  readonly diagnostics: DiagnosticReporter;
}
