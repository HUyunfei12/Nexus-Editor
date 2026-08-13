import type { CapabilityId, PluginId, SemanticVersion } from "./identifiers";
import type { JsonObject } from "./json";

export type NexusErrorCode =
  | "api-deprecated"
  | "api-unsupported"
  | "api-version-mismatch"
  | "callback-failed"
  | "capability-permission-denied"
  | "capability-unsupported"
  | "capability-version-mismatch"
  | "command-conflict"
  | "command-invalid"
  | "command-unavailable"
  | "component-ownership-invalid"
  | "component-runtime-already-bound"
  | "component-runtime-not-bound"
  | "event-dispatch-budget-exceeded"
  | "event-unknown"
  | "file-invalid-reference"
  | "file-version-conflict"
  | "host-version-mismatch"
  | "input-target-unsupported"
  | "legacy-contribution-unsupported"
  | "lifecycle-cleanup-failed"
  | "lifecycle-invalid-transition"
  | "manifest-invalid"
  | "manifest-unknown-field"
  | "path-outside-authorized-root"
  | "permission-denied"
  | "permission-revoked"
  | "platform-unsupported"
  | "plugin-id-conflict"
  | "plugin-id-invalid"
  | "plugin-entrypoint-invalid"
  | "plugin-entrypoint-load-failed"
  | "plugin-load-failed"
  | "plugin-unload-failed"
  | "registration-conflict"
  | "registration-owner-quiescing"
  | "resource-late-registration"
  | "resource-url-revoked"
  | "storage-corrupt"
  | "storage-migration-failed"
  | "storage-serialization-failed"
  | "ui-action-inaccessible"
  | "ui-policy-denied"
  | "unsupported-operation";

export type DiagnosticSeverity = "info" | "warning" | "error" | "fatal";

export type DiagnosticPhase =
  | "discovery"
  | "validation"
  | "loading"
  | "callback"
  | "rollback"
  | "unloading"
  | "runtime";

export interface DiagnosticPluginContext {
  readonly id: PluginId;
  readonly version: SemanticVersion;
}

export interface DiagnosticCapabilityContext {
  readonly id: CapabilityId;
  readonly requestedVersion?: string;
  readonly actualVersion?: SemanticVersion;
}

export interface DiagnosticCause {
  readonly name?: string;
  readonly message: string;
  readonly code?: string;
}

export interface NexusDiagnostic {
  readonly code: NexusErrorCode;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly phase: DiagnosticPhase;
  readonly plugin?: DiagnosticPluginContext;
  readonly capability?: DiagnosticCapabilityContext;
  readonly resourceId?: string;
  readonly cause?: DiagnosticCause;
  readonly details?: JsonObject;
}

export interface DiagnosticReporter {
  report(diagnostic: NexusDiagnostic): void;
  subscribe(handler: (diagnostic: NexusDiagnostic) => void): import("./ownership").Subscription;
}

export class NexusPluginError extends Error {
  readonly diagnostic: NexusDiagnostic;

  constructor(diagnostic: NexusDiagnostic, options?: ErrorOptions) {
    super(diagnostic.message, options);
    this.name = "NexusPluginError";
    this.diagnostic = diagnostic;
  }
}
