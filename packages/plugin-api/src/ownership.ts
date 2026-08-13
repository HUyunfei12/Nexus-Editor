import type { ComponentId, PluginId, RegistrationId } from "./identifiers";
import type { NexusDiagnostic } from "./diagnostics";

export type Disposer = () => void | Promise<void>;

export interface ResourceOwner {
  readonly pluginId: PluginId;
  readonly componentId: ComponentId;
}

export type RegistrationState = "staged" | "active" | "quiescing" | "disposed";

export interface Registration {
  readonly id: RegistrationId;
  readonly owner: ResourceOwner;
  readonly state: RegistrationState;
  readonly disposed: boolean;
  dispose(): Promise<void>;
}

export interface Subscription extends Registration {
  readonly eventName: string;
}

export interface ContributionRegistration extends Registration {
  readonly localId: string;
  readonly globalId: string;
  readonly priority: number;
}

export type RegistrationResult<TRegistration extends Registration = Registration> =
  | {
      readonly ok: true;
      readonly registration: TRegistration;
    }
  | {
      readonly ok: false;
      readonly diagnostic: NexusDiagnostic;
    };

export type ServiceResult<T, TFailure extends NexusDiagnostic = NexusDiagnostic> =
  | {
      readonly ok: true;
      readonly value: T;
    }
  | {
      readonly ok: false;
      readonly diagnostic: TFailure;
    };

export const PLUGIN_PRIORITY = Object.freeze({
  fallback: -100,
  low: -50,
  normal: 0,
  high: 50,
} as const);

export const MIN_PLUGIN_PRIORITY = -1_000;
export const MAX_PLUGIN_PRIORITY = 1_000;
