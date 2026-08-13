import type {
  DiagnosticCause,
  DiagnosticPhase,
  DiagnosticReporter,
  JsonObject,
  JsonValue,
  NexusDiagnostic,
  NexusErrorCode,
  PluginIdentity,
  RegistrationState,
  ResourceOwner,
  Subscription,
} from "@floatboat/nexus-plugin-api";
import type { ComponentId, RegistrationId } from "@floatboat/nexus-plugin-api";

const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token)/i;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const ABSOLUTE_USER_PATH = /\/(?:Users|home)\/[^/\s]+(?:\/[^\s]*)?/g;

export interface DiagnosticBusOptions {
  readonly sensitiveValues?: readonly string[];
  readonly sanitizeMessage?: (message: string) => string;
}

export interface DiagnosticInput {
  readonly code: NexusErrorCode;
  readonly severity?: NexusDiagnostic["severity"];
  readonly phase: DiagnosticPhase;
  readonly message: string;
  readonly identity?: PluginIdentity;
  readonly resourceId?: string;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}

function asComponentId(value: string): ComponentId {
  return value as ComponentId;
}

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function asSystemOwner(): ResourceOwner {
  return {
    pluginId: "nexus-runtime" as ResourceOwner["pluginId"],
    componentId: asComponentId("nexus-runtime/diagnostics"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class DiagnosticSanitizer {
  private readonly sensitiveValues: readonly string[];
  private readonly customMessageSanitizer?: (message: string) => string;

  constructor(options: DiagnosticBusOptions = {}) {
    this.sensitiveValues = (options.sensitiveValues ?? []).filter((value) => value.length > 0);
    this.customMessageSanitizer = options.sanitizeMessage;
  }

  message(message: string): string {
    let sanitized = message.replace(BEARER_VALUE, `Bearer ${REDACTED}`).replace(ABSOLUTE_USER_PATH, "[path]");
    for (const value of this.sensitiveValues) {
      sanitized = sanitized.split(value).join(REDACTED);
    }
    if (this.customMessageSanitizer) {
      sanitized = this.customMessageSanitizer(sanitized);
    }
    return sanitized.slice(0, 2_000);
  }

  cause(cause: unknown): DiagnosticCause | undefined {
    if (cause === undefined || cause === null) return undefined;
    if (cause instanceof Error) {
      const code = "code" in cause && typeof cause.code === "string" ? cause.code : undefined;
      return {
        name: cause.name,
        message: this.message(cause.message || cause.name),
        ...(code ? { code } : {}),
      };
    }
    return { message: this.message(typeof cause === "string" ? cause : "Non-Error exception") };
  }

  details(details: Readonly<Record<string, unknown>> | undefined): JsonObject | undefined {
    if (!details) return undefined;
    return this.object(details, new WeakSet<object>());
  }

  diagnostic(diagnostic: NexusDiagnostic): NexusDiagnostic {
    return Object.freeze({
      ...diagnostic,
      message: this.message(diagnostic.message),
      ...(diagnostic.cause
        ? {
            cause: Object.freeze({
              ...(diagnostic.cause.name ? { name: this.message(diagnostic.cause.name) } : {}),
              message: this.message(diagnostic.cause.message),
              ...(diagnostic.cause.code ? { code: this.message(diagnostic.cause.code) } : {}),
            }),
          }
        : {}),
      ...(diagnostic.details ? { details: this.object(diagnostic.details, new WeakSet<object>()) } : {}),
    });
  }

  private value(key: string, value: unknown, seen: WeakSet<object>): JsonValue {
    if (SENSITIVE_KEY.test(key)) return REDACTED;
    if (value === null || typeof value === "boolean" || typeof value === "number") return value;
    if (typeof value === "string") return this.message(value);
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
      return `[${typeof value}]`;
    }
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    if (Array.isArray(value)) {
      const result = value.map((item) => this.value("", item, seen));
      seen.delete(value);
      return result;
    }
    const result = this.object(isRecord(value) ? value : { value: String(value) }, seen);
    seen.delete(value);
    return result;
  }

  private object(value: Readonly<Record<string, unknown>>, seen: WeakSet<object>): JsonObject {
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = this.value(key, item, seen);
    }
    return result;
  }
}

class DiagnosticSubscription implements Subscription {
  readonly id: RegistrationId;
  readonly owner = asSystemOwner();
  readonly eventName = "diagnostic";
  private currentState: RegistrationState = "active";
  private disposePromise?: Promise<void>;

  constructor(id: number, private readonly release: () => void) {
    this.id = asRegistrationId(`nexus-runtime:diagnostic:${id}`);
  }

  get state(): RegistrationState {
    return this.currentState;
  }

  get disposed(): boolean {
    return this.currentState === "disposed";
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.currentState = "quiescing";
    this.release();
    this.currentState = "disposed";
    this.disposePromise = Promise.resolve();
    return this.disposePromise;
  }
}

export class DiagnosticBus implements DiagnosticReporter {
  private readonly sanitizer: DiagnosticSanitizer;
  private readonly handlers = new Map<number, (diagnostic: NexusDiagnostic) => void>();
  private readonly records: NexusDiagnostic[] = [];
  private nextId = 1;

  constructor(options: DiagnosticBusOptions = {}) {
    this.sanitizer = new DiagnosticSanitizer(options);
  }

  get diagnostics(): readonly NexusDiagnostic[] {
    return this.records;
  }

  report(diagnostic: NexusDiagnostic): void {
    const safe = this.sanitizer.diagnostic(diagnostic);
    this.records.push(safe);
    for (const handler of [...this.handlers.values()]) {
      try {
        handler(safe);
      } catch {
        // Diagnostic observers are host tooling; one observer must not block the stream.
      }
    }
  }

  create(input: DiagnosticInput): NexusDiagnostic {
    const diagnostic: NexusDiagnostic = {
      code: input.code,
      severity: input.severity ?? "error",
      phase: input.phase,
      message: this.sanitizer.message(input.message),
      ...(input.identity
        ? { plugin: { id: input.identity.id, version: input.identity.version } }
        : {}),
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.cause !== undefined ? { cause: this.sanitizer.cause(input.cause) } : {}),
      ...(input.details ? { details: this.sanitizer.details(input.details) } : {}),
    };
    return Object.freeze(diagnostic);
  }

  emit(input: DiagnosticInput): NexusDiagnostic {
    const diagnostic = this.create(input);
    this.report(diagnostic);
    return diagnostic;
  }

  subscribe(handler: (diagnostic: NexusDiagnostic) => void): Subscription {
    const id = this.nextId++;
    this.handlers.set(id, handler);
    return new DiagnosticSubscription(id, () => this.handlers.delete(id));
  }

  clear(): void {
    this.records.length = 0;
  }
}

export interface PluginCallbackBoundaryOptions {
  readonly diagnostics: DiagnosticBus;
  readonly identity: PluginIdentity;
  readonly resourceId?: string;
  readonly phase?: DiagnosticPhase;
}

export function runPluginCallback<T>(
  options: PluginCallbackBoundaryOptions,
  callback: () => T,
): { readonly ok: true; readonly value: T } | { readonly ok: false; readonly diagnostic: NexusDiagnostic } {
  try {
    return { ok: true, value: callback() };
  } catch (error) {
    return {
      ok: false,
      diagnostic: options.diagnostics.emit({
        code: "callback-failed",
        phase: options.phase ?? "callback",
        message: "A plugin callback failed.",
        identity: options.identity,
        resourceId: options.resourceId,
        cause: error,
      }),
    };
  }
}

export async function runPluginCallbackAsync<T>(
  options: PluginCallbackBoundaryOptions,
  callback: () => T | PromiseLike<T>,
): Promise<
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly diagnostic: NexusDiagnostic }
> {
  try {
    return { ok: true, value: await callback() };
  } catch (error) {
    return {
      ok: false,
      diagnostic: options.diagnostics.emit({
        code: "callback-failed",
        phase: options.phase ?? "callback",
        message: "A plugin callback failed.",
        identity: options.identity,
        resourceId: options.resourceId,
        cause: error,
      }),
    };
  }
}
