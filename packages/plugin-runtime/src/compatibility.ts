import {
  type CapabilityId,
  type CapabilityRequestContext,
  type CapabilityResolution,
  type DeprecatedApiDeclaration,
  type JsonObject,
  type NexusDiagnostic,
  type NormalizedPluginManifest,
  type PluginPlatform,
  type ResolvedCapabilityRequirement,
  type SemanticVersion,
} from "@floatboat/nexus-plugin-api";
import { satisfies, valid } from "semver";

import {
  PluginCapabilityAccess,
  RuntimeCapabilityRegistry,
  type PermissionDecisions,
} from "./capability";
import { withResolvedCapabilities } from "./manifest";

export type CompatibilityApiPolicy =
  | {
      readonly status: "deprecated";
      readonly introducedIn?: SemanticVersion;
      readonly deprecatedIn?: SemanticVersion;
      readonly replacement: string;
      readonly removedIn: SemanticVersion;
    }
  | {
      readonly status: "unsupported";
      readonly reason?: string;
    }
  | {
      readonly status: "available";
    };

export interface PluginCompatibilityValidatorOptions {
  readonly hostId: string;
  readonly hostVersion: SemanticVersion;
  readonly apiVersion: SemanticVersion;
  readonly platform: PluginPlatform;
  readonly capabilities: RuntimeCapabilityRegistry;
  readonly capabilityContext?: CapabilityRequestContext;
  readonly permissionDecisions?: (
    manifest: NormalizedPluginManifest,
  ) => PermissionDecisions;
  readonly apiPolicies?: Readonly<Record<string, CompatibilityApiPolicy>>;
}

export type PluginCompatibilityResult =
  | {
      readonly ok: true;
      readonly manifest: NormalizedPluginManifest;
      readonly capabilityAccess: PluginCapabilityAccess;
      readonly diagnostics: readonly NexusDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly manifest: NormalizedPluginManifest;
      readonly diagnostics: readonly NexusDiagnostic[];
    };

function pluginDiagnostic(
  manifest: NormalizedPluginManifest,
  code: NexusDiagnostic["code"],
  severity: NexusDiagnostic["severity"],
  message: string,
  details?: JsonObject,
): NexusDiagnostic {
  return {
    code,
    severity,
    phase: "validation",
    message,
    plugin: {
      id: manifest.identity.id,
      version: manifest.identity.version,
    },
    ...(details === undefined ? {} : { details }),
  };
}

function capabilityDiagnostic(
  manifest: NormalizedPluginManifest,
  resolution: Exclude<CapabilityResolution<unknown>, { status: "available" }>,
): NexusDiagnostic {
  return {
    ...resolution.diagnostic,
    phase: "validation",
    plugin: {
      id: manifest.identity.id,
      version: manifest.identity.version,
    },
  };
}

function apiPolicyDiagnostic(
  manifest: NormalizedPluginManifest,
  declaration: DeprecatedApiDeclaration,
  policy: CompatibilityApiPolicy | undefined,
): NexusDiagnostic | undefined {
  if (!policy || policy.status === "available") return undefined;
  if (policy.status === "unsupported") {
    return pluginDiagnostic(
      manifest,
      "api-unsupported",
      "error",
      `API ${declaration.id} is unsupported by this Nexus runtime.`,
      {
        apiId: declaration.id,
        ...(policy.reason === undefined ? {} : { reason: policy.reason }),
      },
    );
  }
  return pluginDiagnostic(
    manifest,
    "api-deprecated",
    "warning",
    `API ${declaration.id} is deprecated; use ${policy.replacement}.`,
    {
      apiId: declaration.id,
      replacement: policy.replacement,
      removedIn: policy.removedIn,
      ...(policy.introducedIn === undefined ? {} : { introducedIn: policy.introducedIn }),
      ...(policy.deprecatedIn === undefined ? {} : { deprecatedIn: policy.deprecatedIn }),
    },
  );
}

export class PluginCompatibilityValidator {
  readonly hostId: string;
  readonly hostVersion: SemanticVersion;
  readonly apiVersion: SemanticVersion;
  readonly platform: PluginPlatform;

  private readonly capabilities: RuntimeCapabilityRegistry;
  private readonly capabilityContext: CapabilityRequestContext;
  private readonly permissionDecisions: NonNullable<PluginCompatibilityValidatorOptions["permissionDecisions"]>;
  private readonly apiPolicies: Readonly<Record<string, CompatibilityApiPolicy>>;

  constructor(options: PluginCompatibilityValidatorOptions) {
    if (valid(options.hostVersion) === null) throw new TypeError("Host version must be valid semver.");
    if (valid(options.apiVersion) === null) throw new TypeError("Plugin API version must be valid semver.");
    this.hostId = options.hostId;
    this.hostVersion = options.hostVersion;
    this.apiVersion = options.apiVersion;
    this.platform = options.platform;
    this.capabilities = options.capabilities;
    this.capabilityContext = Object.freeze({ ...(options.capabilityContext ?? {}) });
    this.permissionDecisions = options.permissionDecisions ?? (() => ({}));
    this.apiPolicies = options.apiPolicies ?? {};
  }

  validate(manifest: NormalizedPluginManifest): PluginCompatibilityResult {
    const diagnostics: NexusDiagnostic[] = [];

    if (!satisfies(this.apiVersion, manifest.apiVersion)) {
      diagnostics.push(pluginDiagnostic(
        manifest,
        "api-version-mismatch",
        "error",
        `Plugin API ${this.apiVersion} does not satisfy ${manifest.apiVersion}.`,
        { requestedVersion: manifest.apiVersion, actualVersion: this.apiVersion },
      ));
    }
    if (manifest.hostVersion !== undefined && !satisfies(this.hostVersion, manifest.hostVersion)) {
      diagnostics.push(pluginDiagnostic(
        manifest,
        "host-version-mismatch",
        "error",
        `Host version ${this.hostVersion} does not satisfy ${manifest.hostVersion}.`,
        {
          hostId: this.hostId,
          requestedVersion: manifest.hostVersion,
          actualVersion: this.hostVersion,
        },
      ));
    }
    if (manifest.platforms.length > 0 && !manifest.platforms.includes(this.platform)) {
      diagnostics.push(pluginDiagnostic(
        manifest,
        "platform-unsupported",
        "error",
        `Plugin does not support host platform ${this.platform}.`,
        { hostPlatform: this.platform, supportedPlatforms: [...manifest.platforms] },
      ));
    }

    let decisions: PermissionDecisions;
    try {
      decisions = this.permissionDecisions(manifest);
    } catch {
      decisions = {};
      diagnostics.push(pluginDiagnostic(
        manifest,
        "permission-denied",
        "error",
        "The host could not resolve plugin permission decisions.",
      ));
    }
    for (const permission of manifest.permissions) {
      if (permission.required === true && decisions[permission.id] !== "granted") {
        diagnostics.push(pluginDiagnostic(
          manifest,
          "permission-denied",
          "error",
          `Required permission ${permission.id} was not granted.`,
          { permissionId: permission.id },
        ));
      }
    }

    const access = this.capabilities.createPluginAccess(manifest, decisions);
    const resolved: ResolvedCapabilityRequirement[] = [];
    for (const [required, requirements] of [
      [true, manifest.requiredCapabilities],
      [false, manifest.optionalCapabilities],
    ] as const) {
      for (const requirement of requirements) {
        const resolution = access.resolveById(
          requirement.id,
          requirement.version,
          requirement.scope,
          this.capabilityContext,
        );
        resolved.push({
          id: requirement.id as CapabilityId,
          requestedVersion: requirement.version,
          required,
          resolution,
        });
        if (resolution.status !== "available") {
          const diagnostic = capabilityDiagnostic(manifest, resolution);
          diagnostics.push(required ? diagnostic : {
            ...diagnostic,
            severity: "warning",
          });
        }
      }
    }

    for (const declaration of manifest.deprecatedApis) {
      const diagnostic = apiPolicyDiagnostic(manifest, declaration, this.apiPolicies[declaration.id]);
      if (diagnostic) diagnostics.push(diagnostic);
    }

    const runtimeManifest = withResolvedCapabilities(manifest, resolved);
    if (diagnostics.some((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "fatal")) {
      void access.dispose();
      return {
        ok: false,
        manifest: runtimeManifest,
        diagnostics: Object.freeze(diagnostics),
      };
    }
    return {
      ok: true,
      manifest: runtimeManifest,
      capabilityAccess: access,
      diagnostics: Object.freeze(diagnostics),
    };
  }
}
