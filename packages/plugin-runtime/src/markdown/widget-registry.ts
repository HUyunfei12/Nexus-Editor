import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
} from "@floatboat/nexus-plugin-api";
import type {
  ContributionRegistration,
  ManagedResource,
  NexusDiagnostic,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import {
  widgetDefinitionSnapshotExtension,
  type EditorContributionRegistration,
  type EditorContributionSink,
  type WidgetDefinition,
  type WidgetDefinitionSnapshot,
} from "@floatboat/nexus-core";

export interface WidgetRegistryOptions {
  readonly registryId?: string;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export interface WidgetRegistrationOptions {
  readonly id: string;
  readonly priority?: number;
}

interface WidgetEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly priority: number;
  readonly sequence: number;
  readonly definition: WidgetDefinition;
  state: RegistrationState;
}

interface AttachedSink {
  readonly id: string;
  readonly sink: EditorContributionSink;
  physical: EditorContributionRegistration;
}

interface SnapshotJournalItem {
  readonly sink: AttachedSink;
  readonly previous: EditorContributionRegistration;
  readonly next: EditorContributionRegistration;
}

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function normalizePriority(value: number | undefined): number {
  const priority = value ?? 0;
  if (!Number.isInteger(priority) || priority < MIN_PLUGIN_PRIORITY || priority > MAX_PLUGIN_PRIORITY) {
    throw new RangeError(
      `Widget priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return priority;
}

function validateLocalId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new TypeError(
      "Widget id must start with an alphanumeric character and contain only alphanumerics, '.', '_' or '-'",
    );
  }
}

function validateDefinition(definition: WidgetDefinition): void {
  if (typeof definition.nodeType !== "string" || definition.nodeType.trim().length === 0) {
    throw new TypeError("Widget nodeType must not be empty");
  }
  if (typeof definition.render !== "function") {
    throw new TypeError("Widget render must be a function");
  }
}

class ManagedWidgetRegistration implements ContributionRegistration, ManagedResource {
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly entry: WidgetEntry,
    private readonly activateEntry: (entry: WidgetEntry) => Promise<void>,
    private readonly removeEntry: (entry: WidgetEntry) => Promise<void>,
  ) {}

  get id(): RegistrationId { return asRegistrationId(this.entry.key); }
  get owner(): ResourceOwner { return this.entry.owner; }
  get state(): RegistrationState { return this.entry.state; }
  get disposed(): boolean { return this.entry.state === "disposed"; }
  get localId(): string { return this.entry.localId; }
  get globalId(): string { return this.entry.globalId; }
  get priority(): number { return this.entry.priority; }

  async activate(): Promise<void> {
    if (this.entry.state !== "staged") return;
    await this.activateEntry(this.entry);
    if (this.entry.state === "staged") this.entry.state = "active";
  }

  quiesce(): void {
    if (this.entry.state === "staged" || this.entry.state === "active") {
      this.entry.state = "quiescing";
    }
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.quiesce();
    this.disposal = this.removeEntry(this.entry).finally(() => {
      this.entry.state = "disposed";
    });
    return this.disposal;
  }
}

/** Versioned Widget definitions shared by all attached editor contribution sinks. */
export class WidgetRegistry {
  readonly registryId: string;
  private readonly entries = new Map<string, WidgetEntry>();
  private readonly active = new Map<string, WidgetEntry>();
  private readonly attached = new Map<string, AttachedSink>();
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private sequence = 0;
  private sinkSequence = 0;
  private currentVersion = 0;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: WidgetRegistryOptions = {}) {
    this.registryId = options.registryId ?? "nexus.markdown.widgets";
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  get version(): number { return this.currentVersion; }

  get snapshot(): WidgetDefinitionSnapshot {
    return this.createSnapshot(this.active, this.currentVersion);
  }

  register(
    owner: ResourceOwner,
    definition: WidgetDefinition,
    options: WidgetRegistrationOptions,
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    let priority: number;
    try {
      validateLocalId(options.id);
      validateDefinition(definition);
      priority = normalizePriority(options.priority);
    } catch (error) {
      return { ok: false, diagnostic: this.diagnostic(owner, String(options.id), error) };
    }
    const globalId = `${owner.pluginId}:${options.id}`;
    if (this.entries.has(globalId)) {
      return { ok: false, diagnostic: this.diagnostic(owner, globalId) };
    }
    const entry: WidgetEntry = {
      key: `widget:${++this.sequence}`,
      localId: options.id,
      globalId,
      owner,
      priority,
      sequence: this.sequence,
      definition,
      state: "staged",
    };
    this.entries.set(globalId, entry);
    return {
      ok: true,
      registration: new ManagedWidgetRegistration(
        entry,
        (item) => this.enqueue(async () => {
          const next = new Map(this.active);
          next.set(item.globalId, item);
          await this.commit(next);
        }),
        (item) => this.enqueue(async () => {
          if (this.active.get(item.globalId) === item) {
            const next = new Map(this.active);
            next.delete(item.globalId);
            await this.commit(next);
          }
          if (this.entries.get(item.globalId) === item) this.entries.delete(item.globalId);
        }),
      ),
    };
  }

  attach(sink: EditorContributionSink): { readonly ready: Promise<void>; dispose(): Promise<void> } {
    const id = `widget-sink:${++this.sinkSequence}`;
    const physical = sink.registerExtension(
      this.registryId,
      widgetDefinitionSnapshotExtension(this.snapshot),
    );
    const attached: AttachedSink = { id, sink, physical };
    this.attached.set(id, attached);
    let disposal: Promise<void> | null = null;
    return {
      ready: physical.ready,
      dispose: () => {
        if (disposal) return disposal;
        this.attached.delete(id);
        disposal = attached.physical.dispose();
        return disposal;
      },
    };
  }

  private createSnapshot(
    entries: ReadonlyMap<string, WidgetEntry>,
    version: number,
  ): WidgetDefinitionSnapshot {
    const definitions = Array.from(entries.values())
      .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence)
      .map((entry) => Object.freeze({ id: entry.globalId, definition: entry.definition }));
    return Object.freeze({
      registryId: this.registryId,
      version,
      definitions: Object.freeze(definitions),
    });
  }

  private async commit(nextActive: Map<string, WidgetEntry>): Promise<void> {
    const nextVersion = this.currentVersion + 1;
    const extension = widgetDefinitionSnapshotExtension(
      this.createSnapshot(nextActive, nextVersion),
    );
    const journal: SnapshotJournalItem[] = [];
    try {
      for (const item of this.attached.values()) {
        const next = item.sink.registerExtension(this.registryId, extension);
        journal.push({ sink: item, previous: item.physical, next });
        await next.ready;
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const item of journal.reverse()) {
        try {
          await item.next.dispose();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
          this.reportSnapshotFailure("rollback", rollbackError, "Widget snapshot rollback failed", "fatal");
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Widget snapshot '${this.registryId}' failed and could not be fully rolled back`,
        );
      }
      throw error;
    }

    for (const item of journal) item.sink.physical = item.next;
    this.active.clear();
    for (const [id, entry] of nextActive) this.active.set(id, entry);
    this.currentVersion = nextVersion;

    for (const item of journal) {
      try {
        await item.previous.dispose();
      } catch (error) {
        this.reportSnapshotFailure("runtime", error, "Previous Widget snapshot cleanup failed");
      }
    }
    for (const item of journal) {
      try {
        await item.sink.sink.refresh();
      } catch (error) {
        this.reportSnapshotFailure("runtime", error, "Widget decoration refresh failed");
      }
    }
  }

  private reportSnapshotFailure(
    phase: NexusDiagnostic["phase"],
    error: unknown,
    message: string,
    severity: NexusDiagnostic["severity"] = "error",
  ): void {
    this.reportDiagnostic({
      code: "lifecycle-cleanup-failed",
      severity,
      phase,
      message,
      resourceId: this.registryId,
      cause: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    });
  }

  private diagnostic(owner: ResourceOwner, resourceId: string, error?: unknown): NexusDiagnostic {
    const diagnostic: NexusDiagnostic = {
      code: "registration-conflict",
      severity: "error",
      phase: "runtime",
      message: error instanceof Error ? error.message : `Widget '${resourceId}' is already registered`,
      plugin: { id: owner.pluginId, version: "unknown" },
      resourceId,
      ...(error === undefined ? {} : {
        cause: error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
      }),
    };
    this.reportDiagnostic(diagnostic);
    return diagnostic;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }
}
