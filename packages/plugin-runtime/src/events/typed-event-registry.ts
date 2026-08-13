import {
  MAX_PLUGIN_PRIORITY,
  MIN_PLUGIN_PRIORITY,
  NexusPluginError,
} from "@floatboat/nexus-plugin-api";
import type {
  CancelableDispatchResult,
  CancelableEventLike,
  EventHandler,
  EventMap,
  EventName,
  EventSubscriptionOptions,
  ManagedResource,
  NexusDiagnostic,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
  Subscription,
  TypedEvents,
  TypedEventSource,
} from "@floatboat/nexus-plugin-api";

export type EventResourceRegistrar = (resource: ManagedResource) => void;

export type EventValidator<TPayload> = (payload: unknown) => payload is TPayload;

export type EventContractMap<TEvents extends EventMap> = {
  readonly [K in EventName<TEvents>]: EventValidator<TEvents[K]> | null;
};

export interface TypedEventRegistryOptions<TEvents extends EventMap> {
  readonly serviceId: string;
  readonly events: EventContractMap<TEvents>;
  readonly dispatchBudget?: number;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

interface EventEntry<TEvents extends EventMap> {
  readonly key: string;
  readonly event: EventName<TEvents>;
  readonly handler: EventHandler<TEvents[EventName<TEvents>]>;
  readonly owner: ResourceOwner;
  readonly priority: number;
  readonly sequence: number;
  state: RegistrationState;
}

interface QueuedNotification<TEvents extends EventMap> {
  readonly event: EventName<TEvents>;
  readonly payload: TEvents[EventName<TEvents>];
  readonly sourceOwner?: ResourceOwner;
}

function registrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function normalizePriority(priority: number | undefined): number {
  const value = priority ?? 0;
  if (
    !Number.isInteger(value) ||
    value < MIN_PLUGIN_PRIORITY ||
    value > MAX_PLUGIN_PRIORITY
  ) {
    throw new RangeError(
      `Event priority must be an integer between ${MIN_PLUGIN_PRIORITY} and ${MAX_PLUGIN_PRIORITY}`,
    );
  }
  return value;
}

function errorCause(error: unknown): NexusDiagnostic["cause"] {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { message: String(error) };
}

class ManagedEventSubscription<TEvents extends EventMap>
  implements Subscription, ManagedResource
{
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly entry: EventEntry<TEvents>,
    private readonly activateEntry: (entry: EventEntry<TEvents>) => void,
    private readonly removeEntry: (entry: EventEntry<TEvents>) => void,
  ) {}

  get id(): RegistrationId {
    return registrationId(this.entry.key);
  }

  get owner(): ResourceOwner {
    return this.entry.owner;
  }

  get eventName(): string {
    return this.entry.event;
  }

  get state(): RegistrationState {
    return this.entry.state;
  }

  get disposed(): boolean {
    return this.entry.state === "disposed";
  }

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

abstract class EventRegistryBase<TEvents extends EventMap> {
  protected readonly entries = new Map<string, EventEntry<TEvents>>();
  protected readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;
  protected currentHandler: EventEntry<TEvents> | null = null;
  private readonly activeEntries = new Map<string, EventEntry<TEvents>>();
  private sequence = 0;

  protected constructor(
    protected readonly options: TypedEventRegistryOptions<TEvents>,
  ) {
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  protected createEventsFacade(
    owner: ResourceOwner,
    registerResource: EventResourceRegistrar,
  ): TypedEvents<TEvents> {
    return {
      on: (event, handler, options) => {
        const result = this.subscribe(owner, event, handler, options);
        if (!result.ok) throw new NexusPluginError(result.diagnostic);
        try {
          registerResource(result.registration);
        } catch (error) {
          void result.registration.dispose();
          throw error;
        }
        return result.registration;
      },
    };
  }

  subscribe<K extends EventName<TEvents>>(
    owner: ResourceOwner,
    event: K,
    handler: EventHandler<TEvents[K]>,
    options: EventSubscriptionOptions = {},
  ): RegistrationResult<Subscription & ManagedResource> {
    if (!this.hasEvent(event)) {
      return {
        ok: false,
        diagnostic: this.unknownEvent(String(event), owner),
      };
    }
    let priority: number;
    try {
      priority = normalizePriority(options.priority);
    } catch (error) {
      const diagnostic = this.diagnostic({
        code: "command-invalid",
        message: error instanceof Error ? error.message : String(error),
        owner,
        event: String(event),
        error,
      });
      this.reportDiagnostic(diagnostic);
      return { ok: false, diagnostic };
    }
    const sequence = ++this.sequence;
    const entry: EventEntry<TEvents> = {
      key: `${this.options.serviceId}:subscription:${sequence}`,
      event,
      handler: handler as EventHandler<TEvents[EventName<TEvents>]>,
      owner,
      priority,
      sequence,
      state: "staged",
    };
    this.entries.set(entry.key, entry);
    return {
      ok: true,
      registration: new ManagedEventSubscription(
        entry,
        (item) => this.activeEntries.set(item.key, item),
        (item) => {
          this.activeEntries.delete(item.key);
          if (item.state === "disposed") this.entries.delete(item.key);
        },
      ),
    };
  }

  protected validateEmission<K extends EventName<TEvents>>(
    event: K,
    payload: TEvents[K],
    sourceOwner?: ResourceOwner,
  ): NexusDiagnostic | null {
    if (!this.hasEvent(event)) return this.unknownEvent(String(event), sourceOwner);
    const validator = this.options.events[event];
    if (validator && !validator(payload)) {
      const diagnostic = this.diagnostic({
        code: "event-unknown",
        message: `Event '${String(event)}' payload does not satisfy '${this.options.serviceId}' contract`,
        owner: sourceOwner,
        event: String(event),
      });
      this.reportDiagnostic(diagnostic);
      return diagnostic;
    }
    return null;
  }

  protected snapshot<K extends EventName<TEvents>>(
    event: K,
  ): readonly EventEntry<TEvents>[] {
    return Array.from(this.activeEntries.values())
      .filter((entry) => entry.event === event && entry.state === "active")
      .sort(
        (left, right) =>
          right.priority - left.priority || left.sequence - right.sequence,
      );
  }

  protected invoke(
    entry: EventEntry<TEvents>,
    payload: TEvents[EventName<TEvents>],
  ): NexusDiagnostic | null {
    const previous = this.currentHandler;
    this.currentHandler = entry;
    try {
      const result = entry.handler(payload);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch((error) => {
          this.reportDiagnostic(this.callbackFailure(entry, error));
        });
      }
      return null;
    } catch (error) {
      const diagnostic = this.callbackFailure(entry, error);
      this.reportDiagnostic(diagnostic);
      return diagnostic;
    } finally {
      this.currentHandler = previous;
    }
  }

  protected diagnostic(input: {
    readonly code: NexusDiagnostic["code"];
    readonly message: string;
    readonly owner?: ResourceOwner;
    readonly event: string;
    readonly error?: unknown;
    readonly details?: NexusDiagnostic["details"];
  }): NexusDiagnostic {
    return {
      code: input.code,
      severity: "error",
      phase: input.code === "callback-failed" ? "callback" : "runtime",
      message: input.message,
      ...(input.owner
        ? { plugin: { id: input.owner.pluginId, version: "unknown" } }
        : {}),
      resourceId: `${this.options.serviceId}:${input.event}`,
      ...(input.error === undefined
        ? {}
        : { cause: errorCause(input.error) }),
      ...(input.details === undefined ? {} : { details: input.details }),
    };
  }

  private hasEvent(event: PropertyKey): event is EventName<TEvents> {
    return typeof event === "string" && Object.hasOwn(this.options.events, event);
  }

  private unknownEvent(
    event: string,
    owner?: ResourceOwner,
  ): NexusDiagnostic {
    const diagnostic = this.diagnostic({
      code: "event-unknown",
      message: `Event service '${this.options.serviceId}' does not declare event '${event}'`,
      owner,
      event,
      details: { serviceId: this.options.serviceId, eventName: event },
    });
    this.reportDiagnostic(diagnostic);
    return diagnostic;
  }

  private callbackFailure(
    entry: EventEntry<TEvents>,
    error: unknown,
  ): NexusDiagnostic {
    return this.diagnostic({
      code: "callback-failed",
      message: `Event '${entry.event}' handler failed`,
      owner: entry.owner,
      event: entry.event,
      error,
      details: { subscriptionId: entry.key },
    });
  }
}

/** Ordinary fact notifications: snapshot broadcast with per-channel FIFO reentry. */
export class TypedEventRegistry<
  TEvents extends EventMap,
> extends EventRegistryBase<TEvents> {
  private readonly queues = new Map<
    EventName<TEvents>,
    QueuedNotification<TEvents>[]
  >();
  private readonly dispatching = new Set<EventName<TEvents>>();
  private readonly dispatchBudget: number;

  constructor(options: TypedEventRegistryOptions<TEvents>) {
    super(options);
    const budget = options.dispatchBudget ?? 1_000;
    if (!Number.isInteger(budget) || budget < 1) {
      throw new RangeError("Event dispatch budget must be a positive integer");
    }
    this.dispatchBudget = budget;
  }

  createSource(
    owner: ResourceOwner,
    registerResource: EventResourceRegistrar,
  ): TypedEventSource<TEvents> {
    return {
      ...this.createEventsFacade(owner, registerResource),
      emit: (event, payload) => this.emit(event, payload),
    };
  }

  createEvents(
    owner: ResourceOwner,
    registerResource: EventResourceRegistrar,
  ): TypedEvents<TEvents> {
    return this.createEventsFacade(owner, registerResource);
  }

  emit<K extends EventName<TEvents>>(event: K, payload: TEvents[K]): void {
    this.emitFrom(undefined, event, payload);
  }

  emitFrom<K extends EventName<TEvents>>(
    sourceOwner: ResourceOwner | undefined,
    event: K,
    payload: TEvents[K],
  ): void {
    const nestedOwner = sourceOwner ?? this.currentHandler?.owner;
    if (this.validateEmission(event, payload, nestedOwner)) return;
    const queue = this.queues.get(event) ?? [];
    queue.push({
      event,
      payload: payload as TEvents[EventName<TEvents>],
      ...(nestedOwner ? { sourceOwner: nestedOwner } : {}),
    });
    this.queues.set(event, queue);
    if (this.dispatching.has(event)) return;

    this.dispatching.add(event);
    let dispatched = 0;
    try {
      while (queue.length > 0 && dispatched < this.dispatchBudget) {
        const notification = queue.shift()!;
        dispatched += 1;
        const snapshot = this.snapshot(notification.event);
        for (const entry of snapshot) {
          if (entry.state !== "active") continue;
          this.invoke(entry, notification.payload);
        }
      }
      if (queue.length > 0) {
        const firstDropped = queue[0];
        const dropped = queue.length;
        queue.length = 0;
        const diagnostic = this.diagnostic({
          code: "event-dispatch-budget-exceeded",
          message: `Event '${String(event)}' exceeded its dispatch budget`,
          owner: firstDropped?.sourceOwner ?? nestedOwner,
          event: String(event),
          details: {
            eventName: String(event),
            budget: this.dispatchBudget,
            dropped,
          },
        });
        this.reportDiagnostic(diagnostic);
      }
    } finally {
      this.dispatching.delete(event);
      if (queue.length === 0) this.queues.delete(event);
    }
  }
}

/** Synchronous cancelable events; only the final synchronous flag is authoritative. */
export class CancelableEventRegistry<
  TEvents extends EventMap,
> extends EventRegistryBase<TEvents> {
  constructor(options: TypedEventRegistryOptions<TEvents>) {
    super(options);
  }

  createEvents(
    owner: ResourceOwner,
    registerResource: EventResourceRegistrar,
  ): TypedEvents<TEvents> {
    return this.createEventsFacade(owner, registerResource);
  }

  dispatch<K extends EventName<TEvents>>(
    event: K,
    payload: TEvents[K] & CancelableEventLike,
    sourceOwner?: ResourceOwner,
  ): CancelableDispatchResult {
    const validation = this.validateEmission(event, payload, sourceOwner);
    if (validation) {
      return { defaultPrevented: false, diagnostics: [validation] };
    }
    const diagnostics: NexusDiagnostic[] = [];
    const snapshot = this.snapshot(event);
    for (const entry of snapshot) {
      if (entry.state !== "active") continue;
      const failure = this.invoke(
        entry,
        payload as TEvents[EventName<TEvents>],
      );
      if (failure) diagnostics.push(failure);
    }
    return Object.freeze({
      defaultPrevented: payload.defaultPrevented === true,
      diagnostics: Object.freeze(diagnostics),
    });
  }
}
