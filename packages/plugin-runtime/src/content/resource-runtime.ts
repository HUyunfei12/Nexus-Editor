import type {
  FileId,
  ManagedResource,
  NexusDiagnostic,
  NexusFile,
  RegistrationId,
  RegistrationState,
  ResourceOwner,
  ResourceService,
  ResourceUrlRegistration,
  ServiceResult,
  WindowId,
} from "@floatboat/nexus-plugin-api";

import { MemoryVaultRuntime } from "./vault-runtime";

interface ResourceRecord {
  readonly token: string;
  readonly owner: ResourceOwner;
  readonly fileId: FileId;
  readonly windowId?: WindowId;
  state: RegistrationState;
}

export interface ResourceResolution {
  readonly file: NexusFile;
  readonly windowId?: WindowId;
}

export interface MemoryResourceRuntimeOptions {
  readonly vault: MemoryVaultRuntime;
  readonly hostId?: string;
  readonly vaultId?: string;
  readonly tokenFactory?: () => string;
}

function resourceDiagnostic(
  code: NexusDiagnostic["code"],
  message: string,
  resourceId?: string,
): NexusDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    phase: "runtime",
    message,
    ...(resourceId ? { resourceId } : {}),
  });
}

class MemoryResourceRegistration implements ResourceUrlRegistration, ManagedResource {
  private disposePromise: Promise<void> | null = null;

  constructor(
    private readonly record: ResourceRecord,
    readonly url: string,
    private readonly revoke: (token: string) => void,
  ) {}

  get id(): RegistrationId {
    return `resource-url:${this.record.token}` as RegistrationId;
  }

  get owner(): ResourceOwner {
    return this.record.owner;
  }

  get state(): RegistrationState {
    return this.record.state;
  }

  get disposed(): boolean {
    return this.record.state === "disposed";
  }

  get revoked(): boolean {
    return this.record.state === "quiescing" || this.record.state === "disposed";
  }

  get fileId(): FileId {
    return this.record.fileId;
  }

  activate(): void {
    if (this.record.state === "staged") this.record.state = "active";
  }

  quiesce(): void {
    if (this.revoked) return;
    this.record.state = "quiescing";
    this.revoke(this.record.token);
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.quiesce();
    this.record.state = "disposed";
    this.disposePromise = Promise.resolve();
    return this.disposePromise;
  }
}

/** Opaque, revocable URL broker; public URLs never contain Vault paths. */
export class MemoryResourceRuntime implements ManagedResource {
  private readonly vault: MemoryVaultRuntime;
  private readonly bindingPath: string;
  private readonly tokenFactory: () => string;
  private readonly records = new Map<string, ResourceRecord>();
  private disposed = false;

  constructor(options: MemoryResourceRuntimeOptions) {
    this.vault = options.vault;
    this.bindingPath = `/${encodeURIComponent(options.hostId ?? "memory-host")}/${encodeURIComponent(options.vaultId ?? "memory-vault")}`;
    this.tokenFactory = options.tokenFactory ?? (() => {
      const random = globalThis.crypto?.randomUUID?.();
      if (!random) {
        throw new Error("Secure random UUID generation is required for resource URLs");
      }
      return random;
    });
  }

  createService(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ): ResourceService {
    const service: ResourceService = {
      createResourceUrl: async (file, options) => {
        const result = this.create(owner, file, options?.windowId);
        if (result.ok) {
          try {
            registerResource(result.value);
          } catch (error) {
            await result.value.dispose();
            throw error;
          }
        }
        return result;
      },
    };
    return Object.freeze(service);
  }

  resolve(url: string, windowId?: WindowId): ServiceResult<ResourceResolution> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return {
        ok: false,
        diagnostic: resourceDiagnostic("resource-url-revoked", "Resource URL is invalid"),
      };
    }
    if (
      parsed.protocol !== "nexus-resource:" ||
      parsed.hostname !== "resource" ||
      parsed.pathname !== this.bindingPath
    ) {
      return {
        ok: false,
        diagnostic: resourceDiagnostic(
          "permission-denied",
          "Resource URL belongs to another host or Vault",
        ),
      };
    }
    const token = parsed.searchParams.get("token") ?? "";
    const record = this.records.get(token);
    if (!record || record.state !== "active") {
      return {
        ok: false,
        diagnostic: resourceDiagnostic(
          "resource-url-revoked",
          "Resource URL has been revoked",
          token ? `resource-url:${token}` : undefined,
        ),
      };
    }
    if (record.windowId !== undefined && record.windowId !== windowId) {
      return {
        ok: false,
        diagnostic: resourceDiagnostic(
          "permission-denied",
          "Resource URL is bound to a different window",
          `resource-url:${token}`,
        ),
      };
    }
    const file = this.vault.getFileById(record.fileId);
    if (!file) {
      this.revoke(token);
      return {
        ok: false,
        diagnostic: resourceDiagnostic(
          "resource-url-revoked",
          "Resource file is no longer available",
          `resource-url:${token}`,
        ),
      };
    }
    return {
      ok: true,
      value: Object.freeze({
        file,
        ...(record.windowId ? { windowId: record.windowId } : {}),
      }),
    };
  }

  revokeOwner(owner: ResourceOwner): void {
    for (const [token, record] of this.records) {
      if (
        record.owner.pluginId === owner.pluginId &&
        record.owner.componentId === owner.componentId
      ) {
        this.revoke(token);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.records.values()) record.state = "disposed";
    this.records.clear();
  }

  private create(
    owner: ResourceOwner,
    file: NexusFile,
    windowId?: WindowId,
  ): ServiceResult<ResourceUrlRegistration & ManagedResource> {
    if (this.disposed) {
      return {
        ok: false,
        diagnostic: resourceDiagnostic("resource-url-revoked", "Resource service was disposed"),
      };
    }
    if (!this.vault.ownsFile(file)) {
      return {
        ok: false,
        diagnostic: resourceDiagnostic(
          "file-invalid-reference",
          "Cannot create a URL for an invalid file reference",
        ),
      };
    }
    let token = this.tokenFactory();
    while (!token || this.records.has(token)) token = this.tokenFactory();
    const record: ResourceRecord = {
      token,
      owner,
      fileId: file.id,
      ...(windowId ? { windowId } : {}),
      state: "staged",
    };
    this.records.set(token, record);
    const url = `nexus-resource://resource${this.bindingPath}?token=${encodeURIComponent(token)}`;
    return {
      ok: true,
      value: new MemoryResourceRegistration(record, url, (value) => this.revoke(value)),
    };
  }

  private revoke(token: string): void {
    const record = this.records.get(token);
    if (!record) return;
    if (record.state !== "disposed") record.state = "quiescing";
    this.records.delete(token);
  }
}
