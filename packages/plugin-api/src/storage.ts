import type { NexusDiagnostic } from "./diagnostics";
import type { TypedEvents } from "./events";
import type { JsonValue } from "./json";
import type { ServiceResult } from "./ownership";

export interface PluginDataSnapshot<TData extends JsonValue = JsonValue> {
  readonly data: TData | null;
  readonly version: string | null;
  readonly schemaVersion: number | null;
}

export interface PluginDataSaveOptions {
  readonly schemaVersion?: number;
  readonly expectedVersion?: string;
}

export interface PluginDataSaveResult {
  readonly version: string;
  readonly schemaVersion: number | null;
}

export interface PluginStorageEventMap {
  readonly externalChange: {
    readonly version: string;
    readonly schemaVersion: number | null;
  };
  readonly corrupt: {
    readonly diagnostic: NexusDiagnostic;
    readonly recoveryAvailable: boolean;
  };
}

/** A facade already bound to the current normalized plugin id. */
export interface PluginStorageService {
  readonly events: TypedEvents<PluginStorageEventMap>;
  loadData<TData extends JsonValue = JsonValue>(): Promise<PluginDataSnapshot<TData>>;
  saveData<TData extends JsonValue>(
    data: TData,
    options?: PluginDataSaveOptions,
  ): Promise<ServiceResult<PluginDataSaveResult>>;
  migrateData<TData extends JsonValue>(options: {
    readonly targetSchemaVersion: number;
    readonly migrate: (
      current: PluginDataSnapshot<JsonValue>,
    ) => TData | Promise<TData>;
  }): Promise<ServiceResult<PluginDataSnapshot<TData>>>;
}

export interface SecretDescriptor {
  readonly key: string;
  readonly updatedAt?: number;
}

export interface SecretStorageService {
  get(key: string): Promise<ServiceResult<string | null>>;
  set(key: string, value: string): Promise<ServiceResult<void>>;
  delete(key: string): Promise<ServiceResult<boolean>>;
  list(): Promise<ServiceResult<readonly SecretDescriptor[]>>;
}
