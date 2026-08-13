import type {
  AuthorPluginManifest,
  NexusApp,
  NexusDiagnostic,
  NexusHostIdentity,
  NexusPluginBase,
  NormalizedPluginManifest,
  PluginId,
} from "@floatboat/nexus-plugin-api";
import type {
  LoadedTrustedPlugin,
  RejectedTrustedPlugin,
  TrustedPluginLoadResult,
  TrustedPluginPackageCandidate,
} from "./loader";
import { DiagnosticBus } from "./diagnostics";
import { ComponentController, ComponentLifecycleRuntime } from "./lifecycle/component-controller";
import { normalizeAuthorManifest } from "./manifest";

export type PluginManagerState =
  | "discovered"
  | "validating"
  | "disabled"
  | "incompatible"
  | "loading"
  | "enabled"
  | "unloading"
  | "failed";

export interface PluginPackageLoader {
  load(candidate: TrustedPluginPackageCandidate): Promise<TrustedPluginLoadResult>;
}

export interface PluginManagerOptions {
  readonly host: NexusHostIdentity;
  readonly apiVersion: string;
  readonly loader: PluginPackageLoader;
  readonly diagnostics?: DiagnosticBus;
}

export interface PluginRecordSnapshot {
  readonly id: PluginId;
  readonly manifest: NormalizedPluginManifest;
  readonly state: PluginManagerState;
  readonly instance: NexusPluginBase | null;
  readonly diagnostics: readonly NexusDiagnostic[];
}

export type PluginDiscoveryResult =
  | { readonly ok: true; readonly plugin: PluginRecordSnapshot }
  | { readonly ok: false; readonly diagnostics: readonly NexusDiagnostic[] };

export type PluginEnableResult =
  | {
      readonly ok: true;
      readonly state: "enabled";
      readonly plugin: NexusPluginBase;
      readonly diagnostics: readonly NexusDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly state: "incompatible" | "failed";
      readonly diagnostics: readonly NexusDiagnostic[];
    };

export interface PluginDisableResult {
  readonly state: "disabled";
  readonly clean: boolean;
  readonly diagnostics: readonly NexusDiagnostic[];
}

interface PluginRecord {
  readonly id: PluginId;
  readonly candidate: TrustedPluginPackageCandidate;
  manifest: NormalizedPluginManifest;
  state: PluginManagerState;
  instance: NexusPluginBase | null;
  controller: ComponentController | null;
  loaded: LoadedTrustedPlugin | null;
  readonly diagnostics: NexusDiagnostic[];
  enablePromise?: Promise<PluginEnableResult>;
  disablePromise?: Promise<PluginDisableResult>;
  lastDisableResult?: PluginDisableResult;
}

function candidateFromManifest(manifest: NormalizedPluginManifest): TrustedPluginPackageCandidate {
  const authorManifest: AuthorPluginManifest = Object.freeze({
    schemaVersion: manifest.schemaVersion,
    id: manifest.identity.id,
    name: manifest.identity.name,
    version: manifest.identity.version,
    entrypoint: manifest.entrypoint,
    apiVersion: manifest.apiVersion,
    ...(manifest.hostVersion ? { hostVersion: manifest.hostVersion } : {}),
    platforms: manifest.platforms,
    requiredCapabilities: manifest.requiredCapabilities,
    optionalCapabilities: manifest.optionalCapabilities,
    permissions: manifest.permissions,
    deprecatedApis: manifest.deprecatedApis,
    extensions: manifest.extensions,
  });
  return Object.freeze({
    authorManifest,
    host: Object.freeze({
      source: manifest.host.source,
      ...(manifest.host.installLocation ? { installLocation: manifest.host.installLocation } : {}),
      ...(manifest.host.digest ? { digest: manifest.host.digest } : {}),
    }),
  });
}

function pluginId(value: string): PluginId {
  return value as PluginId;
}

function isCompatibilityRejection(result: RejectedTrustedPlugin): boolean {
  return result.diagnostics.some((diagnostic) =>
    diagnostic.phase === "validation" &&
    diagnostic.code !== "manifest-invalid" &&
    diagnostic.code !== "plugin-id-invalid" &&
    diagnostic.code !== "plugin-id-conflict",
  );
}

/** Application-scoped owner of plugin discovery, instances and lifecycles. */
export class PluginManager {
  readonly diagnostics: DiagnosticBus;
  private readonly lifecycle: ComponentLifecycleRuntime;
  private readonly records = new Map<PluginId, PluginRecord>();
  private readonly loader: PluginPackageLoader;
  private readonly host: NexusHostIdentity;
  private readonly apiVersion: string;

  constructor(options: PluginManagerOptions) {
    this.diagnostics = options.diagnostics ?? new DiagnosticBus();
    this.lifecycle = new ComponentLifecycleRuntime(this.diagnostics);
    this.loader = options.loader;
    this.host = Object.freeze({ ...options.host });
    this.apiVersion = options.apiVersion;
  }

  discover(candidate: TrustedPluginPackageCandidate): PluginDiscoveryResult {
    const normalized = normalizeAuthorManifest(candidate.authorManifest, candidate.host);
    for (const diagnostic of normalized.diagnostics) this.diagnostics.report(diagnostic);
    if (!normalized.ok) return normalized;

    const id = normalized.manifest.identity.id;
    const existing = this.records.get(id);
    if (existing) {
      const diagnostic = this.diagnostics.emit({
        code: "plugin-id-conflict",
        phase: "discovery",
        message: "A plugin with the same normalized id has already been discovered.",
        identity: normalized.manifest.identity,
        details: {
          existingSource: existing.manifest.identity.source.locator,
          conflictingSource: normalized.manifest.identity.source.locator,
        },
      });
      return { ok: false, diagnostics: [diagnostic] };
    }

    const record: PluginRecord = {
      id,
      candidate: candidateFromManifest(normalized.manifest),
      manifest: normalized.manifest,
      state: "discovered",
      instance: null,
      controller: null,
      loaded: null,
      diagnostics: [...normalized.diagnostics],
    };
    this.records.set(id, record);
    return { ok: true, plugin: this.snapshot(record) };
  }

  discoverMany(candidates: readonly TrustedPluginPackageCandidate[]): readonly PluginDiscoveryResult[] {
    return candidates.map((candidate) => {
      try {
        return this.discover(candidate);
      } catch (error) {
        const diagnostic = this.diagnostics.emit({
          code: "manifest-invalid",
          phase: "discovery",
          message: "Plugin discovery failed.",
          cause: error,
        });
        return { ok: false, diagnostics: [diagnostic] };
      }
    });
  }

  enable(id: PluginId | string): Promise<PluginEnableResult> {
    const record = this.requireRecord(id);
    if (record.state === "enabled" && record.instance) {
      return Promise.resolve({
        ok: true,
        state: "enabled",
        plugin: record.instance,
        diagnostics: record.diagnostics,
      });
    }
    if ((record.state === "validating" || record.state === "loading") && record.enablePromise) {
      return record.enablePromise;
    }
    if (record.state === "unloading" && record.disablePromise) {
      if (record.enablePromise) return record.enablePromise;
      const promise = record.disablePromise.then(() => this.performEnable(record));
      record.enablePromise = promise.finally(() => {
        record.enablePromise = undefined;
      });
      return record.enablePromise;
    }
    if (record.state === "incompatible" || record.state === "failed") {
      return Promise.resolve({
        ok: false,
        state: record.state,
        diagnostics: record.diagnostics,
      });
    }
    return this.startEnable(record);
  }

  disable(id: PluginId | string): Promise<PluginDisableResult> {
    const record = this.requireRecord(id);
    if (record.disablePromise) return record.disablePromise;
    if (record.state === "disabled" && record.lastDisableResult) {
      return Promise.resolve(record.lastDisableResult);
    }
    if (record.state === "validating" || record.state === "loading") {
      record.disablePromise = this.waitForEnableThenDisable(record);
      return record.disablePromise;
    }
    record.disablePromise = this.performDisable(record);
    return record.disablePromise;
  }

  async enableAll(): Promise<readonly PluginEnableResult[]> {
    const results: PluginEnableResult[] = [];
    for (const id of this.records.keys()) {
      try {
        results.push(await this.enable(id));
      } catch (error) {
        const record = this.records.get(id)!;
        const diagnostic = this.recordDiagnostic(record, {
          code: "plugin-load-failed",
          phase: "loading",
          message: "An isolated plugin enable operation failed.",
          cause: error,
        });
        results.push({ ok: false, state: "failed", diagnostics: [diagnostic] });
      }
    }
    return results;
  }

  async disableAll(): Promise<readonly PluginDisableResult[]> {
    const results: PluginDisableResult[] = [];
    for (const id of [...this.records.keys()].reverse()) {
      try {
        results.push(await this.disable(id));
      } catch (error) {
        const record = this.records.get(id)!;
        const diagnostic = this.recordDiagnostic(record, {
          code: "plugin-unload-failed",
          phase: "unloading",
          message: "An isolated plugin disable operation failed.",
          cause: error,
        });
        results.push({ state: "disabled", clean: false, diagnostics: [diagnostic] });
      }
    }
    return results;
  }

  get(id: PluginId | string): PluginRecordSnapshot | undefined {
    const record = this.records.get(pluginId(id));
    return record ? this.snapshot(record) : undefined;
  }

  list(): readonly PluginRecordSnapshot[] {
    return [...this.records.values()].map((record) => this.snapshot(record));
  }

  getEnabled(id: PluginId | string): NexusPluginBase | undefined {
    const record = this.records.get(pluginId(id));
    return record?.state === "enabled" ? record.instance ?? undefined : undefined;
  }

  private startEnable(record: PluginRecord): Promise<PluginEnableResult> {
    record.enablePromise = this.performEnable(record).finally(() => {
      record.enablePromise = undefined;
    });
    return record.enablePromise;
  }

  private async performEnable(record: PluginRecord): Promise<PluginEnableResult> {
    record.state = "validating";
    record.lastDisableResult = undefined;
    let loaded: TrustedPluginLoadResult;
    try {
      loaded = await this.loader.load(record.candidate);
    } catch (error) {
      const diagnostic = this.recordDiagnostic(record, {
        code: "plugin-load-failed",
        phase: "validation",
        message: "Plugin validation or entrypoint loading failed.",
        cause: error,
      });
      record.state = "failed";
      return { ok: false, state: "failed", diagnostics: [diagnostic] };
    }

    this.acceptDiagnostics(record, loaded.diagnostics);
    if (!loaded.ok) {
      if (loaded.manifest?.identity.id === record.id) record.manifest = loaded.manifest;
      record.state = isCompatibilityRejection(loaded) ? "incompatible" : "failed";
      return { ok: false, state: record.state, diagnostics: record.diagnostics };
    }

    record.loaded = loaded;
    record.manifest = loaded.manifest;
    record.state = "loading";
    const app: NexusApp = Object.freeze({
      host: this.host,
      apiVersion: this.apiVersion,
      capabilities: loaded.capabilityAccess,
      diagnostics: this.diagnostics,
    });

    try {
      const instance = new loaded.Plugin(app, loaded.manifest);
      const controller = this.lifecycle.manage(instance, loaded.manifest.identity);
      loaded.capabilityAccess.bindOwner?.(instance);
      record.instance = instance;
      record.controller = controller;
      await controller.load();
      record.state = "enabled";
      return { ok: true, state: "enabled", plugin: instance, diagnostics: record.diagnostics };
    } catch (error) {
      if (record.controller?.state === "failed" && hasLifecycleDiagnostics(error)) {
        this.acceptDiagnostics(record, error.diagnostics, false);
      } else {
        this.recordDiagnostic(record, {
          code: "plugin-load-failed",
          phase: "loading",
          message: "The plugin instance could not be constructed or loaded.",
          cause: error,
        });
      }
      await this.releaseLoaded(record, "loading");
      record.state = "failed";
      record.instance = null;
      record.controller = null;
      return { ok: false, state: "failed", diagnostics: record.diagnostics };
    }
  }

  private async waitForEnableThenDisable(record: PluginRecord): Promise<PluginDisableResult> {
    try {
      await record.enablePromise;
    } catch {
      // performEnable converts plugin failures to result values; retain isolation if an invariant leaks.
    }
    return this.performDisable(record);
  }

  private async performDisable(record: PluginRecord): Promise<PluginDisableResult> {
    const diagnostics: NexusDiagnostic[] = [];
    let clean = true;

    if (record.state === "enabled" && record.controller) {
      record.state = "unloading";
      try {
        const result = await record.controller.unload();
        clean = result.clean;
        diagnostics.push(...result.diagnostics);
        this.acceptDiagnostics(record, result.diagnostics, false);
      } catch (error) {
        clean = false;
        diagnostics.push(this.recordDiagnostic(record, {
          code: "plugin-unload-failed",
          phase: "unloading",
          message: "The plugin lifecycle controller failed during unload.",
          cause: error,
        }));
      }
    }

    const releaseDiagnostics = await this.releaseLoaded(record, "unloading");
    if (releaseDiagnostics.length > 0) clean = false;
    diagnostics.push(...releaseDiagnostics);
    record.instance = null;
    record.controller = null;
    record.state = "disabled";
    const result = Object.freeze({ state: "disabled" as const, clean, diagnostics: Object.freeze(diagnostics) });
    record.lastDisableResult = result;
    record.disablePromise = undefined;
    return result;
  }

  private async releaseLoaded(
    record: PluginRecord,
    phase: "loading" | "unloading",
  ): Promise<readonly NexusDiagnostic[]> {
    const loaded = record.loaded;
    if (!loaded) return [];
    record.loaded = null;
    const diagnostics: NexusDiagnostic[] = [];
    try {
      await loaded.capabilityAccess.dispose();
    } catch (error) {
      diagnostics.push(this.recordDiagnostic(record, {
        code: "lifecycle-cleanup-failed",
        phase,
        message: "Plugin capability handles failed to dispose.",
        cause: error,
        resourceId: `${record.id}:capabilities`,
      }));
    }
    try {
      loaded.identityReservation.release();
    } catch (error) {
      diagnostics.push(this.recordDiagnostic(record, {
        code: "lifecycle-cleanup-failed",
        phase,
        message: "Plugin identity reservation failed to release.",
        cause: error,
        resourceId: `${record.id}:identity`,
      }));
    }
    return diagnostics;
  }

  private acceptDiagnostics(
    record: PluginRecord,
    diagnostics: readonly NexusDiagnostic[],
    report = true,
  ): void {
    record.diagnostics.push(...diagnostics);
    if (report) for (const diagnostic of diagnostics) this.diagnostics.report(diagnostic);
  }

  private recordDiagnostic(
    record: PluginRecord,
    input: Omit<Parameters<DiagnosticBus["emit"]>[0], "identity">,
  ): NexusDiagnostic {
    const diagnostic = this.diagnostics.emit({ ...input, identity: record.manifest.identity });
    record.diagnostics.push(diagnostic);
    return diagnostic;
  }

  private requireRecord(id: PluginId | string): PluginRecord {
    const record = this.records.get(pluginId(id));
    if (!record) throw new RangeError(`Unknown plugin id: ${id}`);
    return record;
  }

  private snapshot(record: PluginRecord): PluginRecordSnapshot {
    return Object.freeze({
      id: record.id,
      manifest: record.manifest,
      state: record.state,
      instance: record.instance,
      diagnostics: Object.freeze([...record.diagnostics]),
    });
  }
}

function hasLifecycleDiagnostics(error: unknown): error is { readonly diagnostics: readonly NexusDiagnostic[] } {
  return (
    typeof error === "object" &&
    error !== null &&
    "diagnostics" in error &&
    Array.isArray(error.diagnostics)
  );
}
