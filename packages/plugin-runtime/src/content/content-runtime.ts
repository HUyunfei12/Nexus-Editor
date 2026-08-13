import type {
  ManagedResource,
  NexusDiagnostic,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";

import { MemoryFileManagerRuntime, type MemoryFileManagerOptions } from "./file-manager-runtime";
import { MemoryMetadataRuntime } from "./metadata-runtime";
import { MemoryResourceRuntime, type MemoryResourceRuntimeOptions } from "./resource-runtime";
import {
  MemoryVaultRuntime,
  type MemoryVaultRuntimeOptions,
} from "./vault-runtime";

export interface MemoryContentRuntimeOptions extends MemoryVaultRuntimeOptions {
  readonly attachmentFolder?: MemoryFileManagerOptions["attachmentFolder"];
  readonly updateLinksByDefault?: MemoryFileManagerOptions["updateLinksByDefault"];
  readonly hostId?: MemoryResourceRuntimeOptions["hostId"];
  readonly vaultId?: MemoryResourceRuntimeOptions["vaultId"];
  readonly resourceTokenFactory?: MemoryResourceRuntimeOptions["tokenFactory"];
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

/** Aggregates four independently publishable content capabilities. */
export class MemoryContentRuntime implements ManagedResource {
  readonly vault: MemoryVaultRuntime;
  readonly fileManager: MemoryFileManagerRuntime;
  readonly metadata: MemoryMetadataRuntime;
  readonly resources: MemoryResourceRuntime;
  private disposed = false;

  constructor(options: MemoryContentRuntimeOptions = {}) {
    this.vault = new MemoryVaultRuntime(options);
    this.fileManager = new MemoryFileManagerRuntime({
      vault: this.vault,
      ...(options.attachmentFolder ? { attachmentFolder: options.attachmentFolder } : {}),
      ...(options.updateLinksByDefault === undefined
        ? {}
        : { updateLinksByDefault: options.updateLinksByDefault }),
    });
    this.metadata = new MemoryMetadataRuntime({
      vault: this.vault,
      ...(options.reportDiagnostic ? { reportDiagnostic: options.reportDiagnostic } : {}),
    });
    this.resources = new MemoryResourceRuntime({
      vault: this.vault,
      ...(options.hostId ? { hostId: options.hostId } : {}),
      ...(options.vaultId ? { vaultId: options.vaultId } : {}),
      ...(options.resourceTokenFactory
        ? { tokenFactory: options.resourceTokenFactory }
        : {}),
    });
  }

  createServices(
    owner: ResourceOwner,
    registerResource: (resource: ManagedResource) => void,
  ) {
    return Object.freeze({
      vault: this.vault.createService(owner, registerResource),
      fileManager: this.fileManager.createService(owner),
      metadata: this.metadata.createService(owner, registerResource),
      resources: this.resources.createService(owner, registerResource),
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.metadata.dispose();
    await this.resources.dispose();
    await this.vault.dispose();
  }
}
