import {
  NexusPluginBase,
  type NexusDiagnostic,
  type NexusPluginConstructor,
  type NormalizedPluginManifest,
  type PluginInstallLocation,
  type PluginSource,
} from "@floatboat/nexus-plugin-api";

import type { PluginCapabilityAccess } from "./capability";
import {
  PluginCompatibilityValidator,
  type PluginCompatibilityResult,
} from "./compatibility";
import {
  PluginIdentityRegistry,
  normalizeAuthorManifest,
  type PluginIdentityReservation,
  type RuntimeManifestHostFields,
} from "./manifest";

export interface TrustedPluginPackageCandidate {
  /** Untrusted author-controlled JSON value. */
  readonly authorManifest: unknown;
  /** Host-controlled location, digest, and trust classification. */
  readonly host: RuntimeManifestHostFields;
}

export interface HostEntrypointLoadRequest {
  readonly manifest: NormalizedPluginManifest;
  readonly source: PluginSource;
  readonly installLocation?: PluginInstallLocation;
  readonly entrypoint: string;
}

/**
 * Implemented by a host adapter. Browser-safe runtime code deliberately has no
 * dynamic import, require, filesystem, Electron, or IPC primitive of its own.
 */
export interface HostPluginEntrypointResolver {
  loadEntrypoint(request: HostEntrypointLoadRequest): Promise<unknown>;
}

export interface PluginEntrypointLoader {
  load(manifest: NormalizedPluginManifest): Promise<EntrypointLoadResult>;
}

export type EntrypointLoadResult =
  | {
      readonly ok: true;
      readonly Plugin: NexusPluginConstructor;
      readonly diagnostics: readonly NexusDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly NexusDiagnostic[];
    };

export interface LoadedTrustedPlugin {
  readonly ok: true;
  readonly manifest: NormalizedPluginManifest;
  readonly Plugin: NexusPluginConstructor;
  readonly capabilityAccess: PluginCapabilityAccess;
  readonly identityReservation: PluginIdentityReservation;
  readonly diagnostics: readonly NexusDiagnostic[];
}

export interface RejectedTrustedPlugin {
  readonly ok: false;
  readonly manifest?: NormalizedPluginManifest;
  readonly diagnostics: readonly NexusDiagnostic[];
}

export type TrustedPluginLoadResult = LoadedTrustedPlugin | RejectedTrustedPlugin;

export interface TrustedPluginPackageLoaderOptions {
  readonly validator: PluginCompatibilityValidator;
  readonly entrypoints: PluginEntrypointLoader;
  readonly identities?: PluginIdentityRegistry;
}

function pluginDiagnostic(
  manifest: NormalizedPluginManifest,
  code: NexusDiagnostic["code"],
  message: string,
  cause?: NexusDiagnostic["cause"],
): NexusDiagnostic {
  return {
    code,
    severity: "error",
    phase: "loading",
    message,
    plugin: {
      id: manifest.identity.id,
      version: manifest.identity.version,
    },
    ...(cause === undefined ? {} : { cause }),
  };
}

function isPluginConstructor(value: unknown): value is NexusPluginConstructor {
  if (typeof value !== "function") return false;
  const prototype = (value as { prototype?: unknown }).prototype;
  return prototype instanceof NexusPluginBase;
}

function asDefaultExport(moduleNamespace: unknown): unknown {
  if (moduleNamespace === null || (typeof moduleNamespace !== "object" && typeof moduleNamespace !== "function")) {
    return undefined;
  }
  return Reflect.get(moduleNamespace, "default");
}

export class HostControlledPluginEntrypointLoader implements PluginEntrypointLoader {
  constructor(private readonly resolver: HostPluginEntrypointResolver) {}

  async load(manifest: NormalizedPluginManifest): Promise<EntrypointLoadResult> {
    let moduleNamespace: unknown;
    try {
      moduleNamespace = await this.resolver.loadEntrypoint(Object.freeze({
        manifest,
        source: manifest.host.source,
        ...(manifest.host.installLocation === undefined
          ? {}
          : { installLocation: manifest.host.installLocation }),
        entrypoint: manifest.entrypoint,
      }));
    } catch {
      return {
        ok: false,
        diagnostics: Object.freeze([pluginDiagnostic(
          manifest,
          "plugin-entrypoint-load-failed",
          "The host failed to load the trusted plugin entrypoint.",
          {
            name: "Error",
            message: "Plugin entrypoint loading failed.",
          },
        )]),
      };
    }

    let exported: unknown;
    try {
      exported = asDefaultExport(moduleNamespace);
    } catch {
      return {
        ok: false,
        diagnostics: Object.freeze([pluginDiagnostic(
          manifest,
          "plugin-entrypoint-invalid",
          "The plugin module default export could not be inspected.",
        )]),
      };
    }
    let Plugin: NexusPluginConstructor | undefined;
    try {
      if (isPluginConstructor(exported)) Plugin = exported;
    } catch {
      Plugin = undefined;
    }
    if (Plugin === undefined) {
      return {
        ok: false,
        diagnostics: Object.freeze([pluginDiagnostic(
          manifest,
          "plugin-entrypoint-invalid",
          "Plugin entrypoint must default-export a NexusPluginBase subclass constructor.",
        )]),
      };
    }

    return {
      ok: true,
      Plugin,
      diagnostics: Object.freeze([]),
    };
  }
}

export class TrustedPluginPackageLoader {
  private readonly validator: PluginCompatibilityValidator;
  private readonly entrypoints: PluginEntrypointLoader;
  private readonly identities: PluginIdentityRegistry;

  constructor(options: TrustedPluginPackageLoaderOptions) {
    this.validator = options.validator;
    this.entrypoints = options.entrypoints;
    this.identities = options.identities ?? new PluginIdentityRegistry();
  }

  async load(candidate: TrustedPluginPackageCandidate): Promise<TrustedPluginLoadResult> {
    let normalized;
    try {
      normalized = normalizeAuthorManifest(candidate.authorManifest, candidate.host);
    } catch {
      return {
        ok: false,
        diagnostics: Object.freeze([{
          code: "manifest-invalid",
          severity: "error",
          phase: "validation",
          message: "Plugin manifest normalization failed.",
        }]),
      };
    }
    if (!normalized.ok) return normalized;

    const reservationResult = this.identities.reserve(normalized.manifest);
    if (!reservationResult.ok) {
      return {
        ok: false,
        manifest: normalized.manifest,
        diagnostics: Object.freeze([
          ...normalized.diagnostics,
          reservationResult.diagnostic,
        ]),
      };
    }

    let compatibility: PluginCompatibilityResult;
    try {
      compatibility = this.validator.validate(normalized.manifest);
    } catch {
      reservationResult.reservation.release();
      return {
        ok: false,
        manifest: normalized.manifest,
        diagnostics: Object.freeze([
          ...normalized.diagnostics,
          pluginDiagnostic(
            normalized.manifest,
            "plugin-load-failed",
            "Plugin compatibility validation failed.",
          ),
        ]),
      };
    }
    if (!compatibility.ok) {
      reservationResult.reservation.release();
      return {
        ok: false,
        manifest: compatibility.manifest,
        diagnostics: Object.freeze([
          ...normalized.diagnostics,
          ...compatibility.diagnostics,
        ]),
      };
    }

    const entrypoint = await this.entrypoints.load(compatibility.manifest);
    if (!entrypoint.ok) {
      await compatibility.capabilityAccess.dispose();
      reservationResult.reservation.release();
      return {
        ok: false,
        manifest: compatibility.manifest,
        diagnostics: Object.freeze([
          ...normalized.diagnostics,
          ...compatibility.diagnostics,
          ...entrypoint.diagnostics,
        ]),
      };
    }

    return {
      ok: true,
      manifest: compatibility.manifest,
      Plugin: entrypoint.Plugin,
      capabilityAccess: compatibility.capabilityAccess,
      identityReservation: reservationResult.reservation,
      diagnostics: Object.freeze([
        ...normalized.diagnostics,
        ...compatibility.diagnostics,
        ...entrypoint.diagnostics,
      ]),
    };
  }

  async loadMany(
    candidates: readonly TrustedPluginPackageCandidate[],
  ): Promise<readonly TrustedPluginLoadResult[]> {
    const results: TrustedPluginLoadResult[] = [];
    for (const candidate of candidates) {
      try {
        results.push(await this.load(candidate));
      } catch {
        results.push({
          ok: false,
          diagnostics: Object.freeze([{
            code: "plugin-load-failed",
            severity: "error",
            phase: "loading",
            message: "An isolated plugin loading operation failed.",
          }]),
        });
      }
    }
    return Object.freeze(results);
  }
}
