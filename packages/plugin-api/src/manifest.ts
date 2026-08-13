import type { NexusApp } from "./app";
import type { CapabilityResolution, CapabilityScope } from "./capability";
import type { NexusPluginBase } from "./component";
import type {
  CapabilityId,
  PluginId,
  SemanticVersion,
  SemanticVersionRange,
} from "./identifiers";
import type { JsonObject } from "./json";

export type PluginPlatform = "web" | "desktop" | "mobile" | "headless";

export interface CapabilityRequirement {
  readonly id: string;
  readonly version: SemanticVersionRange;
  readonly scope?: CapabilityScope;
}

export interface PermissionDeclaration {
  readonly id: string;
  readonly purpose: string;
  readonly required?: boolean;
  readonly scope?: string;
}

export interface DeprecatedApiDeclaration {
  readonly id: string;
  readonly replacement?: string;
}

export interface AuthorPluginManifest {
  readonly schemaVersion?: number;
  readonly id: string;
  readonly name: string;
  readonly version: SemanticVersion;
  readonly entrypoint: string;
  readonly apiVersion: SemanticVersionRange;
  readonly hostVersion?: SemanticVersionRange;
  readonly platforms?: readonly PluginPlatform[];
  readonly requiredCapabilities?: readonly CapabilityRequirement[];
  readonly optionalCapabilities?: readonly CapabilityRequirement[];
  readonly permissions?: readonly PermissionDeclaration[];
  readonly deprecatedApis?: readonly DeprecatedApiDeclaration[];
  readonly extensions?: JsonObject;
}

export type PluginSourceKind = "bundled" | "development" | "local-trusted";

export interface PluginSource {
  readonly kind: PluginSourceKind;
  /** Opaque host locator; it is not a filesystem path contract. */
  readonly locator: string;
}

export interface PluginInstallLocation {
  readonly scheme: "host" | "url";
  readonly locator: string;
}

export interface PluginDigest {
  readonly algorithm: "sha256" | string;
  readonly value: string;
}

export interface PluginIdentity {
  readonly id: PluginId;
  readonly name: string;
  readonly version: SemanticVersion;
  readonly source: PluginSource;
  readonly digest?: PluginDigest;
}

export interface ResolvedCapabilityRequirement {
  readonly id: CapabilityId;
  readonly requestedVersion: SemanticVersionRange;
  readonly required: boolean;
  readonly resolution: CapabilityResolution<unknown>;
}

export interface PluginHostMetadata {
  readonly source: PluginSource;
  readonly installLocation?: PluginInstallLocation;
  readonly digest?: PluginDigest;
  readonly resolvedCapabilities: readonly ResolvedCapabilityRequirement[];
}

export interface NormalizedPluginManifest {
  readonly schemaVersion: number;
  readonly identity: PluginIdentity;
  readonly entrypoint: string;
  readonly apiVersion: SemanticVersionRange;
  readonly hostVersion?: SemanticVersionRange;
  readonly platforms: readonly PluginPlatform[];
  readonly requiredCapabilities: readonly CapabilityRequirement[];
  readonly optionalCapabilities: readonly CapabilityRequirement[];
  readonly permissions: readonly PermissionDeclaration[];
  readonly deprecatedApis: readonly DeprecatedApiDeclaration[];
  readonly extensions: JsonObject;
  /** Unknown author fields retained for forward-compatible diagnostics only. */
  readonly unknownFields: JsonObject;
  readonly host: PluginHostMetadata;
}

export type NexusPluginConstructor<TPlugin extends NexusPluginBase = NexusPluginBase> = new (
  app: NexusApp,
  manifest: NormalizedPluginManifest,
) => TPlugin;

export interface PluginEntrypoint<TPlugin extends NexusPluginBase = NexusPluginBase> {
  readonly default: NexusPluginConstructor<TPlugin>;
}
