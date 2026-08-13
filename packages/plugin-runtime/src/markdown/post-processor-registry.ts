import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
  NexusComponent,
} from "@floatboat/nexus-plugin-api";
import type {
  ContributionRegistration,
  JsonObject,
  ManagedResource,
  MarkdownCodeBlockProcessor,
  MarkdownPostProcessor,
  MarkdownPostProcessorContext,
  MarkdownProcessorService,
  MarkdownSectionInfo,
  NexusDiagnostic,
  PluginIdentity,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
  VaultPath,
} from "@floatboat/nexus-plugin-api";

import { ComponentLifecycleRuntime, type ComponentController } from "../lifecycle/component-controller";

export interface MarkdownPostProcessorRegistryOptions {
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export interface MarkdownRenderFragmentOptions {
  readonly element: HTMLElement;
  readonly sourcePath?: VaultPath | null;
  readonly documentId: string;
  readonly frontmatter?: JsonObject | null;
  readonly getSectionInfo?: (element: HTMLElement) => MarkdownSectionInfo | null;
}

export interface MarkdownRenderCodeBlockOptions extends MarkdownRenderFragmentOptions {
  readonly language: string;
  readonly source: string;
  readonly renderDefault?: (
    element: HTMLElement,
    source: string,
    language: string,
  ) => void;
}

export interface MarkdownRenderResult {
  readonly generation: number;
  readonly status: "committed" | "stale";
  readonly usedCodeBlockProcessor: boolean;
}

export interface MarkdownRenderHandle {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly ready: Promise<MarkdownRenderResult>;
  readonly stale: boolean;
  invalidate(): Promise<void>;
}

type ProcessorKind = "post" | "code";

interface ProcessorEntry {
  readonly key: string;
  readonly localId: string;
  readonly globalId: string;
  readonly owner: ResourceOwner;
  readonly kind: ProcessorKind;
  readonly language?: string;
  readonly processor: MarkdownPostProcessor | MarkdownCodeBlockProcessor;
  readonly sortOrder: number;
  readonly sequence: number;
  state: RegistrationState;
}

interface ChildRecord {
  readonly controller: ComponentController;
  readonly registrationKey: string;
  unloaded: boolean;
}

interface RenderSession {
  readonly generation: number;
  readonly target: HTMLElement;
  readonly controller: AbortController;
  readonly registrationKeys: ReadonlySet<string>;
  readonly children: ChildRecord[];
  stale: boolean;
  cleanup: Promise<void> | null;
}

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function normalizeSortOrder(value: number | undefined): number {
  const order = value ?? 0;
  if (!Number.isInteger(order) || order < MIN_PLUGIN_PRIORITY || order > MAX_PLUGIN_PRIORITY) {
    throw new RangeError(
      `Markdown processor sortOrder must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return order;
}

function normalizeLanguage(value: string): string {
  const language = value.trim().toLocaleLowerCase("en-US");
  if (!/^[a-z0-9][a-z0-9_+.-]*$/.test(language)) {
    throw new TypeError("Markdown code block language must be a non-empty language identifier");
  }
  return language;
}

function pluginIdentity(owner: ResourceOwner): PluginIdentity {
  return Object.freeze({
    id: owner.pluginId,
    name: String(owner.pluginId),
    version: "unknown",
    source: Object.freeze({ kind: "development", locator: `markdown:${owner.componentId}` }),
  });
}

function defaultCodeBlockRenderer(
  element: HTMLElement,
  source: string,
  language: string,
): void {
  const document = element.ownerDocument;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  if (language) code.className = `language-${language}`;
  code.textContent = source;
  pre.append(code);
  element.replaceChildren(pre);
}

function copyStagedElement(target: HTMLElement, staged: HTMLElement): void {
  for (const attribute of Array.from(target.attributes)) {
    target.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(staged.attributes)) {
    target.setAttribute(attribute.name, attribute.value);
  }
  target.replaceChildren(...Array.from(staged.childNodes));
}

class ManagedMarkdownProcessorRegistration implements ContributionRegistration, ManagedResource {
  private disposal: Promise<void> | null = null;

  constructor(
    private readonly entry: ProcessorEntry,
    private readonly activateEntry: (entry: ProcessorEntry) => void,
    private readonly quiesceEntry: (entry: ProcessorEntry) => void,
    private readonly removeEntry: (entry: ProcessorEntry) => Promise<void>,
  ) {}

  get id(): RegistrationId { return asRegistrationId(this.entry.key); }
  get owner(): ResourceOwner { return this.entry.owner; }
  get state(): RegistrationState { return this.entry.state; }
  get disposed(): boolean { return this.entry.state === "disposed"; }
  get localId(): string { return this.entry.localId; }
  get globalId(): string { return this.entry.globalId; }
  get priority(): number { return this.entry.sortOrder; }

  activate(): void {
    if (this.entry.state !== "staged") return;
    this.activateEntry(this.entry);
    this.entry.state = "active";
  }

  quiesce(): void {
    if (this.entry.state !== "staged" && this.entry.state !== "active") return;
    this.entry.state = "quiescing";
    this.quiesceEntry(this.entry);
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

/** Reading-view Markdown processors with deterministic ordering and render generations. */
export class MarkdownPostProcessorRegistry {
  private readonly entries = new Map<string, ProcessorEntry>();
  private readonly active = new Map<string, ProcessorEntry>();
  private readonly sessions = new Set<RenderSession>();
  private readonly latestByTarget = new WeakMap<HTMLElement, RenderSession>();
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  private sequence = 0;
  private generation = 0;

  constructor(options: MarkdownPostProcessorRegistryOptions = {}) {
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  createService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): MarkdownProcessorService {
    return {
      registerPostProcessor: (processor, options) => {
        const result = this.registerPostProcessor(owner, processor, options);
        if (result.ok) this.bindResource(result.registration, registerResource);
        return result;
      },
      registerMarkdownCodeBlockProcessor: (language, processor, options) => {
        const result = this.registerMarkdownCodeBlockProcessor(owner, language, processor, options);
        if (result.ok) this.bindResource(result.registration, registerResource);
        return result;
      },
      registerCodeBlockProcessor: (language, processor, options) => {
        const result = this.registerCodeBlockProcessor(owner, language, processor, options);
        if (result.ok) this.bindResource(result.registration, registerResource);
        return result;
      },
    };
  }

  registerPostProcessor(
    owner: ResourceOwner,
    processor: MarkdownPostProcessor,
    options: { readonly sortOrder?: number } = {},
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    return this.registerEntry(owner, "post", processor, options.sortOrder);
  }

  registerCodeBlockProcessor(
    owner: ResourceOwner,
    language: string,
    processor: MarkdownCodeBlockProcessor,
    options: { readonly sortOrder?: number } = {},
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    return this.registerMarkdownCodeBlockProcessor(owner, language, processor, options);
  }

  registerMarkdownCodeBlockProcessor(
    owner: ResourceOwner,
    language: string,
    processor: MarkdownCodeBlockProcessor,
    options: { readonly sortOrder?: number } = {},
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    let normalized: string;
    try {
      normalized = normalizeLanguage(language);
    } catch (error) {
      return { ok: false, diagnostic: this.diagnostic(owner, "registration-conflict", String(language), error) };
    }
    return this.registerEntry(owner, "code", processor, options.sortOrder, normalized);
  }

  renderFragment(options: MarkdownRenderFragmentOptions): MarkdownRenderHandle {
    return this.startRender(options, undefined);
  }

  renderCodeBlock(options: MarkdownRenderCodeBlockOptions): MarkdownRenderHandle {
    return this.startRender(options, {
      language: options.language.trim().toLocaleLowerCase("en-US"),
      source: options.source,
      renderDefault: options.renderDefault ?? defaultCodeBlockRenderer,
    });
  }

  async dispose(): Promise<void> {
    await Promise.all(Array.from(this.sessions, (session) => this.invalidateSession(session)));
  }

  private registerEntry(
    owner: ResourceOwner,
    kind: ProcessorKind,
    processor: MarkdownPostProcessor | MarkdownCodeBlockProcessor,
    sortOrderInput: number | undefined,
    language?: string,
  ): RegistrationResult<ContributionRegistration & ManagedResource> {
    let sortOrder: number;
    try {
      if (typeof processor !== "function") throw new TypeError("Markdown processor must be a function");
      sortOrder = normalizeSortOrder(sortOrderInput);
    } catch (error) {
      return { ok: false, diagnostic: this.diagnostic(owner, "registration-conflict", kind, error) };
    }
    const sequence = ++this.sequence;
    const localId = kind === "post" ? `post-${sequence}` : `code-${language}-${sequence}`;
    const globalId = `${owner.pluginId}:${localId}`;
    const entry: ProcessorEntry = {
      key: `markdown-processor:${sequence}`,
      localId,
      globalId,
      owner,
      kind,
      ...(language === undefined ? {} : { language }),
      processor,
      sortOrder,
      sequence,
      state: "staged",
    };
    this.entries.set(entry.key, entry);
    return {
      ok: true,
      registration: new ManagedMarkdownProcessorRegistration(
        entry,
        (item) => this.active.set(item.key, item),
        (item) => {
          this.active.delete(item.key);
          void this.invalidateSessionsFor(item.key).catch(() => undefined);
        },
        async (item) => {
          this.active.delete(item.key);
          this.entries.delete(item.key);
          await this.invalidateSessionsFor(item.key);
        },
      ),
    };
  }

  private bindResource(
    registration: ContributionRegistration & ManagedResource,
    registerResource: (resource: ManagedResource) => void,
  ): void {
    try {
      registerResource(registration);
    } catch (error) {
      void registration.dispose();
      throw error;
    }
  }

  private startRender(
    options: MarkdownRenderFragmentOptions,
    code: {
      readonly language: string;
      readonly source: string;
      readonly renderDefault: (element: HTMLElement, source: string, language: string) => void;
    } | undefined,
  ): MarkdownRenderHandle {
    const previous = this.latestByTarget.get(options.element);
    const previousCleanup = previous
      ? this.invalidateSession(previous).catch((error) => {
          this.reportRenderCleanupFailure(previous, error);
        })
      : Promise.resolve();

    const entries = Array.from(this.active.values())
      .filter((entry) => entry.state === "active" && (
        code
          ? entry.kind === "code" && entry.language === code.language
          : entry.kind === "post"
      ))
      .sort((left, right) => left.sortOrder - right.sortOrder || left.sequence - right.sequence);
    const session: RenderSession = {
      generation: ++this.generation,
      target: options.element,
      controller: new AbortController(),
      registrationKeys: new Set(entries.map((entry) => entry.key)),
      children: [],
      stale: false,
      cleanup: null,
    };
    this.sessions.add(session);
    this.latestByTarget.set(options.element, session);
    const ready = previousCleanup.then(() => this.runRender(session, options, entries, code));

    return {
      generation: session.generation,
      signal: session.controller.signal,
      ready,
      get stale() { return session.stale; },
      invalidate: () => this.invalidateSession(session),
    };
  }

  private async runRender(
    session: RenderSession,
    options: MarkdownRenderFragmentOptions,
    entries: readonly ProcessorEntry[],
    code: {
      readonly language: string;
      readonly source: string;
      readonly renderDefault: (element: HTMLElement, source: string, language: string) => void;
    } | undefined,
  ): Promise<MarkdownRenderResult> {
    const staged = options.element.cloneNode(true) as HTMLElement;
    let usedCodeBlockProcessor = false;
    if (code && entries.some((entry) => entry.kind === "code")) staged.replaceChildren();

    for (const entry of entries) {
      if (!this.isCurrent(session) || entry.state !== "active") break;
      const context = this.createContext(session, entry, options);
      try {
        if (entry.kind === "code") {
          usedCodeBlockProcessor = true;
          await (entry.processor as MarkdownCodeBlockProcessor)(code!.source, staged, context);
        } else {
          await (entry.processor as MarkdownPostProcessor)(staged, context);
        }
      } catch (error) {
        if (!session.controller.signal.aborted) {
          this.reportDiagnostic(this.diagnostic(entry.owner, "callback-failed", entry.globalId, error));
          if (entry.kind === "code") {
            usedCodeBlockProcessor = false;
            staged.replaceChildren();
            code!.renderDefault(staged, code!.source, code!.language);
            break;
          }
        }
      }
    }

    if (!this.isCurrent(session)) {
      await this.invalidateSession(session);
      return { generation: session.generation, status: "stale", usedCodeBlockProcessor };
    }
    if (code && !usedCodeBlockProcessor) {
      staged.replaceChildren();
      code.renderDefault(staged, code.source, code.language);
    }
    copyStagedElement(options.element, staged);
    return { generation: session.generation, status: "committed", usedCodeBlockProcessor };
  }

  private createContext(
    session: RenderSession,
    entry: ProcessorEntry,
    options: MarkdownRenderFragmentOptions,
  ): MarkdownPostProcessorContext {
    return Object.freeze({
      sourcePath: options.sourcePath ?? null,
      documentId: options.documentId,
      generation: session.generation,
      frontmatter: options.frontmatter ?? null,
      signal: session.controller.signal,
      getSectionInfo: (element: HTMLElement) => options.getSectionInfo?.(element) ?? null,
      addChild: async (child: NexusComponent) => {
        const runtime = new ComponentLifecycleRuntime();
        const controller = runtime.manage(child, pluginIdentity(entry.owner));
        const record: ChildRecord = {
          controller,
          registrationKey: entry.key,
          unloaded: false,
        };
        session.children.push(record);
        try {
          await controller.load();
        } catch (error) {
          record.unloaded = true;
          throw error;
        }
        if (!this.isCurrent(session)) {
          await this.unloadChild(record);
        }
        return child;
      },
    });
  }

  private isCurrent(session: RenderSession): boolean {
    return !session.stale &&
      !session.controller.signal.aborted &&
      this.latestByTarget.get(session.target) === session;
  }

  private invalidateSessionsFor(registrationKey: string): Promise<void> {
    return Promise.all(
      Array.from(this.sessions)
        .filter((session) => session.registrationKeys.has(registrationKey))
        .map((session) => this.invalidateSession(session)),
    ).then(() => undefined);
  }

  private invalidateSession(session: RenderSession): Promise<void> {
    if (session.cleanup) return session.cleanup;
    session.stale = true;
    session.controller.abort();
    if (this.latestByTarget.get(session.target) === session) {
      this.latestByTarget.delete(session.target);
    }
    const cleanup = (async () => {
      const errors: unknown[] = [];
      for (let index = session.children.length - 1; index >= 0; index -= 1) {
        try {
          await this.unloadChild(session.children[index]!);
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `Markdown render generation ${session.generation} cleanup failed`);
      }
    })();
    session.cleanup = cleanup.finally(() => {
      this.sessions.delete(session);
    });
    return session.cleanup;
  }

  private async unloadChild(record: ChildRecord): Promise<void> {
    if (record.unloaded) return;
    record.unloaded = true;
    await record.controller.unload();
  }

  private reportRenderCleanupFailure(session: RenderSession, error: unknown): void {
    this.reportDiagnostic({
      code: "lifecycle-cleanup-failed",
      severity: "error",
      phase: "runtime",
      message: `Markdown render generation ${session.generation} cleanup failed`,
      resourceId: `markdown-render:${session.generation}`,
      cause: error instanceof Error
        ? { name: error.name, message: error.message }
        : { message: String(error) },
    });
  }

  private diagnostic(
    owner: ResourceOwner,
    code: NexusDiagnostic["code"],
    resourceId: string,
    error?: unknown,
  ): NexusDiagnostic {
    return {
      code,
      severity: "error",
      phase: code === "callback-failed" ? "callback" : "runtime",
      message: error instanceof Error ? error.message : `Markdown processor '${resourceId}' could not be registered`,
      plugin: { id: owner.pluginId, version: "unknown" },
      resourceId,
      ...(error === undefined ? {} : {
        cause: error instanceof Error
          ? { name: error.name, message: error.message }
          : { message: String(error) },
      }),
    };
  }
}
