import type { NexusDiagnostic } from "@floatboat/nexus-plugin-api";

export class LifecycleOperationError extends Error {
  readonly diagnostics: readonly NexusDiagnostic[];

  constructor(message: string, diagnostics: readonly NexusDiagnostic[], options?: ErrorOptions) {
    super(message, options);
    this.name = "LifecycleOperationError";
    this.diagnostics = diagnostics;
  }
}

export class PluginLoadError extends LifecycleOperationError {
  readonly loadError: unknown;
  readonly cleanupErrors: readonly unknown[];

  constructor(
    message: string,
    loadError: unknown,
    cleanupErrors: readonly unknown[],
    diagnostics: readonly NexusDiagnostic[],
  ) {
    super(message, diagnostics, { cause: loadError });
    this.name = "PluginLoadError";
    this.loadError = loadError;
    this.cleanupErrors = cleanupErrors;
  }
}
