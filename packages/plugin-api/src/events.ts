import type { NexusDiagnostic } from "./diagnostics";
import type { Subscription } from "./ownership";

export type EventMap = object;
export type EventName<TEvents extends EventMap> = Extract<keyof TEvents, string>;
export type EventHandler<TPayload> = (payload: TPayload) => void;

export interface EventSubscriptionOptions {
  readonly priority?: number;
}

export interface TypedEvents<TEvents extends EventMap> {
  on<K extends EventName<TEvents>>(
    event: K,
    handler: EventHandler<TEvents[K]>,
    options?: EventSubscriptionOptions,
  ): Subscription;
}

export interface EventService<TEvents extends EventMap> extends TypedEvents<TEvents> {}

/** Host/runtime-side companion; plugin service facades normally expose only TypedEvents. */
export interface TypedEventSource<TEvents extends EventMap> extends TypedEvents<TEvents> {
  emit<K extends EventName<TEvents>>(event: K, payload: TEvents[K]): void;
}

export interface CancelableEventLike {
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

export interface CancelableDispatchResult {
  readonly defaultPrevented: boolean;
  readonly diagnostics: readonly NexusDiagnostic[];
}
