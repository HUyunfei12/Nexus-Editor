import type {
  CapabilityId,
  EditorId,
  SemanticVersion,
  SemanticVersionRange,
  ViewId,
  WindowId,
  WorkspaceId,
} from "./identifiers";
import type { NexusDiagnostic } from "./diagnostics";
import type { Subscription } from "./ownership";

export type CapabilityScope = "application" | "window" | "workspace" | "view" | "editor";

export interface CapabilityTokenOptions<
  TId extends string = string,
  TVersion extends SemanticVersion = SemanticVersion,
  TScope extends CapabilityScope = CapabilityScope,
> {
  readonly id: TId;
  readonly version: TVersion;
  readonly scope: TScope;
}

export interface CapabilityToken<
  TService,
  TId extends string = string,
  TVersion extends SemanticVersion = SemanticVersion,
  TScope extends CapabilityScope = CapabilityScope,
> extends CapabilityTokenOptions<TId, TVersion, TScope> {
  /** Type-only marker. It has no runtime value. */
  readonly serviceType?: TService;
}

export interface CapabilityRequestContext {
  readonly windowId?: WindowId;
  readonly workspaceId?: WorkspaceId;
  readonly viewId?: ViewId;
  readonly editorId?: EditorId;
}

export interface CapabilityDescriptor {
  readonly id: CapabilityId;
  readonly version: SemanticVersion;
  readonly scope: CapabilityScope;
}

export interface CapabilityHandle<TService> {
  readonly service: TService;
  readonly version: SemanticVersion;
  readonly scope: CapabilityScope;
  readonly revoked: boolean;
  readonly grantedPermissions: readonly string[];
  onRevoked(handler: (reason: NexusDiagnostic) => void): Subscription;
  assertAvailable(): TService;
}

export interface AvailableCapability<TService> {
  readonly status: "available";
  readonly descriptor: CapabilityDescriptor;
  readonly handle: CapabilityHandle<TService>;
}

export interface UnsupportedCapability {
  readonly status: "unsupported";
  readonly requestedId: CapabilityId;
  readonly requestedVersion: SemanticVersionRange;
  readonly diagnostic: NexusDiagnostic;
}

export interface VersionMismatchCapability {
  readonly status: "version-mismatch";
  readonly requestedId: CapabilityId;
  readonly requestedVersion: SemanticVersionRange;
  readonly availableVersions: readonly SemanticVersion[];
  readonly diagnostic: NexusDiagnostic;
}

export interface PermissionDeniedCapability {
  readonly status: "permission-denied";
  readonly requestedId: CapabilityId;
  readonly requestedVersion: SemanticVersionRange;
  readonly deniedPermissions: readonly string[];
  readonly diagnostic: NexusDiagnostic;
}

export type CapabilityResolution<TService> =
  | AvailableCapability<TService>
  | UnsupportedCapability
  | VersionMismatchCapability
  | PermissionDeniedCapability;

export interface CapabilityRegistry {
  has<TService>(
    token: CapabilityToken<TService>,
    versionRange?: SemanticVersionRange,
    context?: CapabilityRequestContext,
  ): boolean;
  resolve<TService>(
    token: CapabilityToken<TService>,
    versionRange?: SemanticVersionRange,
    context?: CapabilityRequestContext,
  ): CapabilityResolution<TService>;
  get<TService>(
    token: CapabilityToken<TService>,
    versionRange?: SemanticVersionRange,
    context?: CapabilityRequestContext,
  ): TService | undefined;
  require<TService>(
    token: CapabilityToken<TService>,
    versionRange?: SemanticVersionRange,
    context?: CapabilityRequestContext,
  ): TService;
  list(context?: CapabilityRequestContext): readonly CapabilityDescriptor[];
}

const CAPABILITY_ID_PATTERN = /^nexus\.[a-z][a-z0-9]*(?:-[a-z0-9]+|\.[a-z0-9]+)*$/;
const SEMANTIC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const CAPABILITY_SCOPES = new Set<CapabilityScope>([
  "application",
  "window",
  "workspace",
  "view",
  "editor",
]);

export function defineCapabilityToken<
  TService,
  const TId extends string,
  const TVersion extends SemanticVersion,
  const TScope extends CapabilityScope,
>(options: CapabilityTokenOptions<TId, TVersion, TScope>): CapabilityToken<TService, TId, TVersion, TScope> {
  if (!CAPABILITY_ID_PATTERN.test(options.id)) {
    throw new TypeError(`Invalid Nexus capability id: ${options.id}`);
  }
  if (!SEMANTIC_VERSION_PATTERN.test(options.version)) {
    throw new TypeError(`Invalid Nexus capability version: ${options.version}`);
  }
  if (!CAPABILITY_SCOPES.has(options.scope)) {
    throw new TypeError(`Invalid Nexus capability scope: ${options.scope}`);
  }
  return Object.freeze({ ...options });
}
