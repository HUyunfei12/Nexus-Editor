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
  markdownTransformSnapshotExtension,
  type EditorContributionRegistration,
  type EditorContributionSink,
  type MarkdownTransformSnapshot,
} from "@floatboat/nexus-core";
import type { Root } from "mdast";
import { unified, type Plugin } from "unified";

export interface RemarkTransformRegistryOptions {
  readonly registryId?: string;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export interface RemarkTransformRegistrationOptions {
  readonly id: string;
  readonly priority?: number;
}

interface TransformEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly priority: number;
  readonly sequence: number;
  readonly plugin: Plugin<[], Root, Root>;
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
      `Remark transform priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return priority;
}

function validateLocalId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new TypeError(
      "Remark transform id must start with an alphanumeric character and contain only alphanumerics, '.', '_' or '-'",
    );
  }
}

function emptyRoot(): Root {
  return { type: "root", children: [] };
}

class ManagedRemarkTransformRegistration implements ContributionRegistration, ManagedResource {
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly entry: TransformEntry,
    private readonly activateEntry: (entry: TransformEntry) => Promise<void>,
    private readonly removeEntry: (entry: TransformEntry) => Promise<void>,
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

/** Versioned, owner-scoped Remark transform snapshots committed atomically to editor sinks. */
export class RemarkTransformRegistry {
  readonly registryId: string;
  private readonly entries = new Map<string, TransformEntry>();
  private readonly active = new Map<string, TransformEntry>();
  private readonly attached = new Map<string, AttachedSink>();
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private sequence = 0;
  private sinkSequence = 0;
  private currentVersion = 0;
  private currentTransform: (tree: Root) => Root = (tree) => tree;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: RemarkTransformRegistryOptions = {}) {
    this.registryId = options.registryId ?? "nexus.markdown.remark";
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  get version(): number { return this.currentVersion; }

  get snapshot(): MarkdownTransformSnapshot {
    return Object.freeze({
      registryId: this.registryId,
      version: this.currentVersion,
      transform: this.currentTransform,
    });
  }

  register(
    owner: ResourceOwner,
    plugin: Plugin<[], Root, Root>,
    options: RemarkTransformRegistrationOptions,
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    let priority: number;
    try {
      validateLocalId(options.id);
      priority = normalizePriority(options.priority);
    } catch (error) {
      return { ok: false, diagnostic: this.diagnostic("registration-conflict", owner, String(options.id), error) };
    }
    const globalId = `${owner.pluginId}:${options.id}`;
    if (this.entries.has(globalId)) {
      return { ok: false, diagnostic: this.diagnostic("registration-conflict", owner, globalId) };
    }
    const entry: TransformEntry = {
      key: `remark-transform:${++this.sequence}`,
      localId: options.id,
      globalId,
      owner,
      priority,
      sequence: this.sequence,
      plugin,
      state: "staged",
    };
    this.entries.set(globalId, entry);
    return {
      ok: true,
      registration: new ManagedRemarkTransformRegistration(
        entry,
        (item) => this.enqueue(async () => {
          const nextActive = new Map(this.active);
          nextActive.set(item.globalId, item);
          const transform = this.buildStagedTransform(nextActive);
          await this.commit(nextActive, transform);
        }),
        (item) => this.enqueue(async () => {
          if (this.active.get(item.globalId) === item) {
            const nextActive = new Map(this.active);
            nextActive.delete(item.globalId);
            const transform = this.buildStagedTransform(nextActive);
            await this.commit(nextActive, transform);
          }
          if (this.entries.get(item.globalId) === item) this.entries.delete(item.globalId);
        }),
      ),
    };
  }

  attach(sink: EditorContributionSink): { readonly ready: Promise<void>; dispose(): Promise<void> } {
    const id = `remark-sink:${++this.sinkSequence}`;
    const physical = sink.registerExtension(
      this.registryId,
      markdownTransformSnapshotExtension(this.snapshot),
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

  private sorted(entries: ReadonlyMap<string, TransformEntry>): readonly TransformEntry[] {
    return Array.from(entries.values()).sort(
      (left, right) => right.priority - left.priority || left.sequence - right.sequence,
    );
  }

  private buildStagedTransform(entries: ReadonlyMap<string, TransformEntry>): (tree: Root) => Root {
    const processor = unified();
    for (const entry of this.sorted(entries)) processor.use(entry.plugin);
    processor.freeze();
    const transform = (tree: Root): Root => processor.runSync(tree) as Root;
    // Initialization and sync-only constraints are verified before any visible snapshot changes.
    transform(emptyRoot());
    return transform;
  }

  private async commit(
    nextActive: Map<string, TransformEntry>,
    transform: (tree: Root) => Root,
  ): Promise<void> {
    const nextVersion = this.currentVersion + 1;
    const extension = markdownTransformSnapshotExtension({
      registryId: this.registryId,
      version: nextVersion,
      transform,
    });
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
          this.reportSnapshotFailure("rollback", rollbackError, "Remark snapshot rollback failed", "fatal");
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Remark snapshot '${this.registryId}' failed and could not be fully rolled back`,
        );
      }
      throw error;
    }

    for (const item of journal) item.sink.physical = item.next;
    this.active.clear();
    for (const [id, entry] of nextActive) this.active.set(id, entry);
    this.currentVersion = nextVersion;
    this.currentTransform = transform;

    for (const item of journal) {
      try {
        await item.previous.dispose();
      } catch (error) {
        this.reportSnapshotFailure("runtime", error, "Previous Remark snapshot cleanup failed");
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

  private diagnostic(
    code: NexusDiagnostic["code"],
    owner: ResourceOwner,
    resourceId: string,
    error?: unknown,
  ): NexusDiagnostic {
    const diagnostic: NexusDiagnostic = {
      code,
      severity: "error",
      phase: "runtime",
      message: error instanceof Error ? error.message : `Remark transform '${resourceId}' is already registered`,
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
