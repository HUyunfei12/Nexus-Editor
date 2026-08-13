import type {
  ClipboardFilter,
  ClipboardFilterContext,
  ClipboardFilterResult,
  ClipboardOperation,
  ClipboardPayload,
  ClipboardPayloadItem,
  ClipboardService,
  ClipboardWriteResult,
  ContributionRegistration,
  EditorContext,
  EditorDomEventContext,
  EditorInputSurface,
  ManagedResource,
  NexusDiagnostic,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
} from "@floatboat/nexus-plugin-api";
import {
  EDITOR_PLUGIN_PRIORITY_MIN,
  type EditorContributionRegistration,
  type EditorDomEventHookContext as CoreEditorDomEventContext,
  type EditorDomEventHookResult,
} from "@floatboat/nexus-core";

export interface ClipboardPipelineOptions {
  readonly writer?: ClipboardWriter;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export interface ClipboardWriter {
  write(payload: ClipboardPayload, context: EditorContext): Promise<ClipboardWriteResult>;
}

export interface ClipboardFilterOutcome {
  readonly action: "pass" | "replace" | "reject";
  readonly payload: ClipboardPayload;
  readonly diagnostic?: NexusDiagnostic;
}

export interface ClipboardTransferOptions {
  readonly event?: ClipboardEvent;
  readonly deleteSource?: () => void;
}

export interface ClipboardTransferResult extends ClipboardWriteResult {
  readonly payload: ClipboardPayload;
}

interface FilterEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly operation: ClipboardOperation;
  readonly filter: ClipboardFilter;
  readonly priority: number;
  readonly surfaces: ReadonlySet<EditorInputSurface> | null;
  readonly sequence: number;
  state: RegistrationState;
}

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function normalizePriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (
    !Number.isInteger(value) ||
    value < MIN_PLUGIN_PRIORITY ||
    value > MAX_PLUGIN_PRIORITY
  ) {
    throw new RangeError(
      `Clipboard filter priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return value;
}

function diagnostic(
  code: NexusDiagnostic["code"],
  message: string,
  cause?: unknown,
  owner?: ResourceOwner,
): NexusDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    phase: "runtime",
    message,
    ...(owner
      ? { plugin: { id: owner.pluginId, version: "unknown" } }
      : {}),
    ...(cause === undefined
      ? {}
      : {
          cause:
            cause instanceof Error
              ? { name: cause.name, message: cause.message }
              : { message: String(cause) },
        }),
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && "then" in value && typeof value.then === "function";
}

function isFilterResult(value: unknown): value is ClipboardFilterResult {
  if (!value || typeof value !== "object" || !("action" in value)) return false;
  const action = value.action;
  if (action === "pass" || action === "reject") return true;
  return action === "replace" && "payload" in value;
}

function uniqueFiles(files: readonly File[]): readonly File[] {
  return files.filter((file, index) => files.indexOf(file) === index);
}

/**
 * Keep the convenience text/html/files fields and the item list consistent.
 * A filter can therefore use `{ ...payload, text: next }` without discarding
 * HTML, files, or custom MIME items it did not intend to modify.
 */
export function normalizeClipboardPayload(payload: ClipboardPayload): ClipboardPayload {
  const files = uniqueFiles([
    ...payload.files,
    ...payload.items.flatMap((item) => item.kind === "file" ? [item.file] : []),
  ]);
  const items: ClipboardPayloadItem[] = [];
  let textWritten = false;
  let htmlWritten = false;

  for (const item of payload.items) {
    if (item.kind === "file") continue;
    const type = item.type.toLowerCase();
    if (type === "text/plain") {
      if (payload.text !== null && !textWritten) {
        items.push({ kind: "string", type: "text/plain", value: payload.text });
        textWritten = true;
      }
      continue;
    }
    if (type === "text/html") {
      if (payload.html !== null && !htmlWritten) {
        items.push({ kind: "string", type: "text/html", value: payload.html });
        htmlWritten = true;
      }
      continue;
    }
    items.push(Object.freeze({ ...item }));
  }

  if (payload.text !== null && !textWritten) {
    items.push({ kind: "string", type: "text/plain", value: payload.text });
  }
  if (payload.html !== null && !htmlWritten) {
    items.push({ kind: "string", type: "text/html", value: payload.html });
  }
  for (const file of files) {
    items.push({ kind: "file", type: file.type, file });
  }

  return Object.freeze({
    text: payload.text,
    html: payload.html,
    files: Object.freeze([...files]),
    items: Object.freeze(items),
  });
}

export function readClipboardPayload(
  source: ClipboardEvent | DragEvent | DataTransfer | null,
): ClipboardPayload {
  const data = source && "clipboardData" in source
      ? source.clipboardData
      : source && "dataTransfer" in source
        ? source.dataTransfer
        : source;
  if (!data) {
    return Object.freeze({ text: null, html: null, files: [], items: [] });
  }

  const types = Array.from(data.types ?? []);
  const stringItems: ClipboardPayloadItem[] = [];
  for (const type of types) {
    if (type.toLowerCase() === "files") continue;
    stringItems.push({ kind: "string", type, value: data.getData(type) });
  }

  const files: File[] = Array.from(data.files ?? []);
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && !files.includes(file)) files.push(file);
  }

  const hasType = (type: string) => types.some((item) => item.toLowerCase() === type);
  return normalizeClipboardPayload({
    text: hasType("text/plain") ? data.getData("text/plain") : null,
    html: hasType("text/html") ? data.getData("text/html") : null,
    files,
    items: stringItems,
  });
}

class BrowserClipboardWriter implements ClipboardWriter {
  async write(payload: ClipboardPayload, _context: EditorContext): Promise<ClipboardWriteResult> {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) {
      return {
        status: "permission-denied",
        diagnostic: diagnostic(
          "permission-denied",
          "Browser clipboard access is unavailable or has not been granted",
        ),
      };
    }

    const normalized = normalizeClipboardPayload(payload);
    try {
      if (typeof clipboard.write === "function" && typeof globalThis.ClipboardItem === "function") {
        const representations: Record<string, Blob> = {};
        for (const item of normalized.items) {
          if (item.kind === "file") {
            if (!item.type || representations[item.type]) {
              return {
                status: "format-unsupported",
                diagnostic: diagnostic(
                  "unsupported-operation",
                  "The browser clipboard cannot represent every requested file item",
                ),
              };
            }
            representations[item.type] = item.file;
          } else {
            representations[item.type] = new Blob([item.value], { type: item.type });
          }
        }
        if (Object.keys(representations).length === 0) {
          representations["text/plain"] = new Blob([""], { type: "text/plain" });
        }
        await clipboard.write([new ClipboardItem(representations)]);
        return { status: "written" };
      }

      const nonTextItems = normalized.items.filter(
        (item) => item.kind !== "string" || item.type.toLowerCase() !== "text/plain",
      );
      if (typeof clipboard.writeText !== "function" || nonTextItems.length > 0) {
        return {
          status: "format-unsupported",
          diagnostic: diagnostic(
            "unsupported-operation",
            "The browser only supports plain-text clipboard writes in this context",
          ),
        };
      }
      await clipboard.writeText(normalized.text ?? "");
      return { status: "written" };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        return {
          status: "permission-denied",
          diagnostic: diagnostic("permission-denied", "Browser denied clipboard write access", error),
        };
      }
      if (name === "NotSupportedError" || name === "DataError") {
        return {
          status: "format-unsupported",
          diagnostic: diagnostic("unsupported-operation", "Browser rejected a clipboard format", error),
        };
      }
      return {
        status: "failed",
        diagnostic: diagnostic("callback-failed", "Clipboard write failed", error),
      };
    }
  }
}

class ClipboardFilterRegistration
  implements ContributionRegistration, ManagedResource
{
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly entry: FilterEntry,
    private readonly activateEntry: (entry: FilterEntry) => void,
    private readonly removeEntry: (entry: FilterEntry) => void,
  ) {}

  get id(): RegistrationId { return asRegistrationId(this.entry.key); }
  get owner(): ResourceOwner { return this.entry.owner; }
  get state(): RegistrationState { return this.entry.state; }
  get disposed(): boolean { return this.entry.state === "disposed"; }
  get localId(): string { return this.entry.localId; }
  get globalId(): string { return this.entry.globalId; }
  get priority(): number { return this.entry.priority; }

  activate(): void {
    if (this.entry.state !== "staged") return;
    this.activateEntry(this.entry);
    this.entry.state = "active";
  }

  quiesce(): void {
    if (this.entry.state === "staged" || this.entry.state === "active") {
      this.entry.state = "quiescing";
      this.removeEntry(this.entry);
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.quiesce();
    this.entry.state = "disposed";
    this.removeEntry(this.entry);
    this.disposePromise = Promise.resolve();
    return this.disposePromise;
  }
}

/** Owner-scoped, synchronous filter pipeline with browser-safe write adapters. */
export class ClipboardPipeline {
  private readonly entries = new Map<string, FilterEntry>();
  private readonly activeEntries = new Map<string, FilterEntry>();
  private readonly writer: ClipboardWriter;
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private sequence = 0;

  constructor(options: ClipboardPipelineOptions = {}) {
    this.writer = options.writer ?? new BrowserClipboardWriter();
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  createService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): ClipboardService {
    return {
      registerFilter: (operation, filter, options) => {
        const result = this.registerFilter(owner, operation, filter, options);
        if (result.ok) registerResource(result.registration);
        return result;
      },
      write: (payload, context) => this.writer.write(normalizeClipboardPayload(payload), context),
    };
  }

  /**
   * Installs the host-owned bridge that runs structured filters from the real
   * editor-root copy/cut/paste/drop events. The bridge deliberately runs at
   * the host fallback priority so explicit DOM hooks can consume an
   * event before the host's structured default action.
   */
  async attachEditorHost(
    resolveEditor: () => EditorContext,
  ): Promise<ManagedResource> {
    const registrations: EditorContributionRegistration[] = [];
    const sink = resolveEditor().contributions;
    const register = (operation: ClipboardOperation): void => {
      const registration = sink.registerDomEvent(
        "nexus.clipboard-host",
        operation,
        ((event: ClipboardEvent | DragEvent, coreContext: CoreEditorDomEventContext) => {
          const context = this.toDomEventContext(resolveEditor(), coreContext);
          return operation === "paste" || operation === "drop"
            ? this.handleIncomingEvent(operation, event, context)
            : this.handleOutgoingEvent(operation, event as ClipboardEvent, context);
        }) as never,
        {
          phase: "capture",
          priority: EDITOR_PLUGIN_PRIORITY_MIN,
        },
      );
      registrations.push(registration);
    };

    try {
      register("paste");
      register("drop");
      register("copy");
      register("cut");
      await Promise.all(registrations.map((registration) => registration.ready));
    } catch (error) {
      await Promise.allSettled(registrations.reverse().map((registration) => registration.dispose()));
      throw error;
    }

    let disposePromise: Promise<void> | null = null;
    return {
      dispose: () => {
        if (disposePromise) return disposePromise;
        disposePromise = Promise.allSettled(
          [...registrations].reverse().map((registration) => registration.dispose()),
        ).then((results) => {
          const errors = results
            .filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);
          if (errors.length > 0) {
            throw new AggregateError(errors, "Clipboard editor bridge cleanup failed");
          }
        });
        return disposePromise;
      },
    };
  }

  private toDomEventContext(
    editor: EditorContext,
    core: CoreEditorDomEventContext,
  ): EditorDomEventContext {
    const target = core.inputTarget;
    return {
      ...editor,
      surface: Object.freeze({ ...editor.surface, kind: core.surface }),
      inputTarget: target
        ? {
            id: target.id ?? "anonymous",
            kind: target.kind,
            getSelectedText: () => target.getSelectedText(),
            replaceSelection: (text) => core.replaceTargetSelection(text)
              ? { ok: true, value: undefined }
              : {
                  ok: false,
                  diagnostic: diagnostic(
                    "input-target-unsupported",
                    "The active editor surface cannot replace its selection",
                  ),
                },
            ...(target.copySelection
              ? { copySelection: () => target.copySelection!() }
              : {}),
          }
        : null,
      replaceTargetSelection: (text) => core.replaceTargetSelection(text)
        ? { ok: true, value: undefined }
        : {
            ok: false,
            diagnostic: diagnostic(
              "input-target-unsupported",
              "The active editor surface cannot replace its selection",
            ),
          },
    };
  }

  registerFilter(
    owner: ResourceOwner,
    operation: ClipboardOperation,
    filter: ClipboardFilter,
    options: {
      readonly priority?: number;
      readonly surfaces?: readonly EditorInputSurface[];
    } = {},
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    try {
      const priority = normalizePriority(options.priority);
      const sequence = ++this.sequence;
      const localId = `${operation}-${sequence}`;
      const entry: FilterEntry = {
        key: `clipboard-filter:${sequence}`,
        localId,
        globalId: `${owner.pluginId}:${localId}`,
        owner,
        operation,
        filter,
        priority,
        surfaces: options.surfaces ? new Set(options.surfaces) : null,
        sequence,
        state: "staged",
      };
      this.entries.set(entry.key, entry);
      return {
        ok: true,
        registration: new ClipboardFilterRegistration(
          entry,
          (item) => this.activeEntries.set(item.key, item),
          (item) => {
            this.activeEntries.delete(item.key);
            if (item.state === "disposed") this.entries.delete(item.key);
          },
        ),
      };
    } catch (error) {
      const item = diagnostic(
        "registration-conflict",
        error instanceof Error ? error.message : String(error),
        error,
        owner,
      );
      this.reportDiagnostic(item);
      return { ok: false, diagnostic: item };
    }
  }

  runFilters(
    operation: ClipboardOperation,
    payload: ClipboardPayload,
    context: ClipboardFilterContext,
  ): ClipboardFilterOutcome {
    let current = normalizeClipboardPayload(payload);
    let replaced = false;
    const entries = [...this.activeEntries.values()]
      .filter((entry) =>
        entry.state === "active" &&
        entry.operation === operation &&
        (!entry.surfaces || entry.surfaces.has(context.editor.surface.kind)),
      )
      .sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);

    for (const entry of entries) {
      try {
        const result: unknown = entry.filter(current, context);
        if (isPromiseLike(result)) {
          this.reportDiagnostic(diagnostic(
            "callback-failed",
            "Clipboard filters must return synchronously",
            undefined,
            entry.owner,
          ));
          continue;
        }
        if (!isFilterResult(result)) {
          this.reportDiagnostic(diagnostic(
            "callback-failed",
            "Clipboard filter returned an invalid result",
            undefined,
            entry.owner,
          ));
          continue;
        }
        if (result.action === "reject") {
          return {
            action: "reject",
            payload: current,
            diagnostic: diagnostic(
              "permission-denied",
              result.reason ?? "Clipboard operation rejected by a plugin filter",
              undefined,
              entry.owner,
            ),
          };
        }
        if (result.action === "replace") {
          current = normalizeClipboardPayload(result.payload);
          replaced = true;
        }
      } catch (error) {
        this.reportDiagnostic(diagnostic(
          "callback-failed",
          "Clipboard filter failed",
          error,
          entry.owner,
        ));
      }
    }
    return { action: replaced ? "replace" : "pass", payload: current };
  }

  private handleIncomingEvent(
    operation: "paste" | "drop",
    event: ClipboardEvent | DragEvent,
    editor: EditorDomEventContext,
  ): EditorDomEventHookResult {
    const context = this.createFilterContext(operation, event, editor);
    const filtered = this.runFilters(operation, readClipboardPayload(event), context);
    if (filtered.action === "pass") return "pass";
    if (filtered.action === "reject") {
      if (filtered.diagnostic) this.reportDiagnostic(filtered.diagnostic);
      return "consume";
    }

    const text = filtered.payload.text;
    if (text === null || !editor.inputTarget) {
      this.reportDiagnostic(diagnostic(
        "input-target-unsupported",
        "The active editor surface cannot accept the filtered clipboard payload",
      ));
      return "pass";
    }
    const replaced = editor.inputTarget.replaceSelection(text);
    if (!replaced.ok) {
      this.reportDiagnostic(replaced.diagnostic);
      return "pass";
    }
    return "consume";
  }

  private handleOutgoingEvent(
    operation: "copy" | "cut",
    event: ClipboardEvent,
    editor: EditorDomEventContext,
  ): EditorDomEventHookResult {
    let payload: ClipboardPayload;
    try {
      payload = editor.inputTarget?.copySelection?.() ?? {
        text: editor.inputTarget?.getSelectedText() ?? null,
        html: null,
        files: [],
        items: [],
      };
    } catch (error) {
      this.reportDiagnostic(diagnostic(
        "callback-failed",
        "The active editor surface failed to provide its clipboard selection",
        error,
      ));
      return "pass";
    }

    const context = this.createFilterContext(operation, event, editor);
    const filtered = this.runFilters(operation, payload, context);
    if (filtered.action === "pass") return "pass";
    if (filtered.action === "reject") {
      if (filtered.diagnostic) this.reportDiagnostic(filtered.diagnostic);
      return "consume";
    }

    const written = this.writeToEvent(filtered.payload, event);
    if (written.status !== "written") {
      if (written.diagnostic) this.reportDiagnostic(written.diagnostic);
      return "consume";
    }
    if (operation === "cut") {
      const deleted = editor.inputTarget?.replaceSelection("");
      if (!deleted?.ok) {
        this.reportDiagnostic(deleted?.diagnostic ?? diagnostic(
          "input-target-unsupported",
          "The active editor surface cannot delete its selection after a clipboard write",
        ));
      }
    }
    return "consume";
  }

  private createFilterContext(
    operation: ClipboardOperation,
    event: ClipboardEvent | DragEvent,
    editor: EditorDomEventContext,
  ): ClipboardFilterContext {
    const adapter = editor.inputTarget;
    const eventTarget = event.target;
    const ElementCtor = editor.surface.root.ownerDocument.defaultView?.HTMLElement;
    const element = ElementCtor && eventTarget instanceof ElementCtor
      ? eventTarget
      : editor.surface.root;
    return {
      direction: operation === "paste" || operation === "drop" ? "incoming" : "outgoing",
      operation,
      editor,
      target: adapter
        ? {
            id: adapter.id,
            kind: adapter.kind,
            element,
            getSelectedText: () => adapter.getSelectedText(),
            replaceSelection: (text) => adapter.replaceSelection(text).ok,
          }
        : null,
      event,
    };
  }

  async transferOutgoing(
    operation: "copy" | "cut",
    payload: ClipboardPayload,
    context: ClipboardFilterContext,
    options: ClipboardTransferOptions = {},
  ): Promise<ClipboardTransferResult> {
    const filtered = this.runFilters(operation, payload, context);
    if (filtered.action === "reject") {
      return {
        status: "failed",
        payload: filtered.payload,
        diagnostic: filtered.diagnostic,
      };
    }

    const writeResult = options.event
      ? this.writeToEvent(filtered.payload, options.event)
      : await this.writer.write(filtered.payload, context.editor);
    if (writeResult.status === "written" && operation === "cut") {
      options.deleteSource?.();
    }
    return { ...writeResult, payload: filtered.payload };
  }

  writeToEvent(payload: ClipboardPayload, event: ClipboardEvent): ClipboardWriteResult {
    const data = event.clipboardData;
    if (!data) {
      return {
        status: "failed",
        diagnostic: diagnostic("unsupported-operation", "Clipboard event has no writable data store"),
      };
    }
    const normalized = normalizeClipboardPayload(payload);
    const files = normalized.items.filter((item) => item.kind === "file");
    if (files.length > 0 && typeof data.items?.add !== "function") {
      return {
        status: "format-unsupported",
        diagnostic: diagnostic(
          "unsupported-operation",
          "The clipboard event cannot represent requested file items",
        ),
      };
    }
    try {
      data.clearData();
      for (const item of normalized.items) {
        if (item.kind === "string") data.setData(item.type, item.value);
        else data.items.add(item.file);
      }
      event.preventDefault();
      return { status: "written" };
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      return {
        status: name === "NotAllowedError" || name === "SecurityError"
          ? "permission-denied"
          : name === "NotSupportedError" || name === "DataError"
            ? "format-unsupported"
            : "failed",
        diagnostic: diagnostic(
          name === "NotAllowedError" || name === "SecurityError"
            ? "permission-denied"
            : "unsupported-operation",
          "Clipboard event write failed",
          error,
        ),
      };
    }
  }
}
