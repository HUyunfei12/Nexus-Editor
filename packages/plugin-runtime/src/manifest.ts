import {
  NexusPluginError,
  type AuthorPluginManifest,
  type CapabilityRequirement,
  type DeprecatedApiDeclaration,
  type JsonObject,
  type JsonValue,
  type NexusDiagnostic,
  type NormalizedPluginManifest,
  type PermissionDeclaration,
  type PluginDigest,
  type PluginId,
  type PluginInstallLocation,
  type PluginPlatform,
  type PluginSource,
  type ResolvedCapabilityRequirement,
} from "@floatboat/nexus-plugin-api";
import { valid, validRange } from "semver";

const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPABILITY_ID_PATTERN = /^nexus\.[a-z][a-z0-9]*(?:-[a-z0-9]+|\.[a-z0-9]+)*$/;
const PERMISSION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const SUPPORTED_PLATFORMS = new Set<PluginPlatform>([
  "web",
  "desktop",
  "mobile",
  "headless",
]);
const SUPPORTED_SOURCE_KINDS = new Set(["bundled", "development", "local-trusted"]);
const SUPPORTED_INSTALL_SCHEMES = new Set(["host", "url"]);
const SUPPORTED_SCOPES = new Set(["application", "window", "workspace", "view", "editor"]);
const AUTHOR_FIELDS = new Set([
  "schemaVersion",
  "id",
  "name",
  "version",
  "entrypoint",
  "apiVersion",
  "hostVersion",
  "platforms",
  "requiredCapabilities",
  "optionalCapabilities",
  "permissions",
  "deprecatedApis",
  "extensions",
]);

export interface RuntimeManifestHostFields {
  readonly source: PluginSource;
  readonly installLocation?: PluginInstallLocation;
  readonly digest?: PluginDigest;
}

export type ManifestNormalizationResult =
  | {
      readonly ok: true;
      readonly manifest: NormalizedPluginManifest;
      readonly diagnostics: readonly NexusDiagnostic[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly NexusDiagnostic[];
    };

export interface PluginIdentityReservation {
  readonly pluginId: PluginId;
  readonly manifest: NormalizedPluginManifest;
  readonly released: boolean;
  release(): void;
}

export type PluginIdentityReservationResult =
  | { readonly ok: true; readonly reservation: PluginIdentityReservation }
  | { readonly ok: false; readonly diagnostic: NexusDiagnostic };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value: unknown, path: string, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
    throw new TypeError(`${path} must not contain non-finite numbers.`);
  }
  if (typeof value !== "object") {
    throw new TypeError(`${path} must contain JSON-compatible values only.`);
  }
  if (seen.has(value)) throw new TypeError(`${path} must not contain circular references.`);

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) => cloneJson(item, `${path}[${index}]`, seen));
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: cloneJson(item, `${path}.${key}`, seen),
        writable: true,
      });
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function deepFreezeJson<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
      deepFreezeJson(child);
    }
    Object.freeze(value);
  }
  return value;
}

function asJsonObject(value: unknown, path: string): JsonObject {
  if (!isRecord(value)) throw new TypeError(`${path} must be a JSON object.`);
  return cloneJson(value, path) as JsonObject;
}

function validationDiagnostic(
  message: string,
  details?: JsonObject,
  code: NexusDiagnostic["code"] = "manifest-invalid",
): NexusDiagnostic {
  return {
    code,
    severity: "error",
    phase: "validation",
    message,
    details,
  };
}

function manifestDiagnostic(
  manifest: Pick<NormalizedPluginManifest, "identity">,
  diagnostic: Omit<NexusDiagnostic, "plugin" | "phase"> & { readonly phase?: NexusDiagnostic["phase"] },
): NexusDiagnostic {
  return {
    ...diagnostic,
    phase: diagnostic.phase ?? "validation",
    plugin: {
      id: manifest.identity.id,
      version: manifest.identity.version,
    },
  };
}

export function normalizePluginId(value: string): PluginId {
  const normalized = value.trim().toLowerCase();
  if (!PLUGIN_ID_PATTERN.test(normalized)) {
    throw new NexusPluginError({
      code: "plugin-id-invalid",
      severity: "error",
      phase: "validation",
      message: "Plugin id must use lowercase ASCII letters, digits, and single hyphens.",
      details: { suppliedId: value },
    });
  }
  return normalized as PluginId;
}

function normalizeEntrypoint(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.includes("\0") ||
    trimmed.includes("\\") ||
    trimmed.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    throw new TypeError("entrypoint must be a package-relative module path.");
  }

  let decoded = trimmed;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new TypeError("entrypoint contains invalid percent encoding.");
    }
    if (next === decoded) break;
    decoded = next;
  }
  const segments = decoded.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new TypeError("entrypoint must stay inside the plugin package.");
  }
  return `./${segments.join("/")}`;
}

function normalizeVersion(value: unknown, field: string): string {
  if (typeof value !== "string" || valid(value) === null) {
    throw new TypeError(`${field} must be a valid semantic version.`);
  }
  return value;
}

function normalizeVersionRange(value: unknown, field: string): string {
  if (typeof value !== "string" || validRange(value) === null) {
    throw new TypeError(`${field} must be a valid semantic version range.`);
  }
  return value;
}

function normalizeCapabilityRequirement(value: unknown, field: string): CapabilityRequirement {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object.`);
  if (typeof value.id !== "string" || !CAPABILITY_ID_PATTERN.test(value.id)) {
    throw new TypeError(`${field}.id must be a valid Nexus capability id.`);
  }
  const version = normalizeVersionRange(value.version, `${field}.version`);
  if (value.scope !== undefined && (typeof value.scope !== "string" || !SUPPORTED_SCOPES.has(value.scope))) {
    throw new TypeError(`${field}.scope is invalid.`);
  }
  return Object.freeze({
    id: value.id,
    version,
    ...(value.scope === undefined ? {} : { scope: value.scope as CapabilityRequirement["scope"] }),
  });
}

function normalizeCapabilities(
  value: unknown,
  field: string,
  seen: Set<string>,
): readonly CapabilityRequirement[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  const result = value.map((item, index) => normalizeCapabilityRequirement(item, `${field}[${index}]`));
  for (const requirement of result) {
    const key = `${requirement.id}\0${requirement.scope ?? "*"}`;
    if (seen.has(key)) throw new TypeError(`${field} contains duplicate capability ${requirement.id}.`);
    seen.add(key);
  }
  return Object.freeze(result);
}

function normalizePermissions(value: unknown): readonly PermissionDeclaration[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError("permissions must be an array.");
  const seen = new Set<string>();
  const result = value.map((item, index): PermissionDeclaration => {
    if (!isRecord(item)) throw new TypeError(`permissions[${index}] must be an object.`);
    if (typeof item.id !== "string" || !PERMISSION_ID_PATTERN.test(item.id)) {
      throw new TypeError(`permissions[${index}].id is invalid.`);
    }
    if (seen.has(item.id)) throw new TypeError(`permissions contains duplicate permission ${item.id}.`);
    seen.add(item.id);
    if (typeof item.purpose !== "string" || item.purpose.trim().length === 0) {
      throw new TypeError(`permissions[${index}].purpose must be a non-empty string.`);
    }
    if (item.required !== undefined && typeof item.required !== "boolean") {
      throw new TypeError(`permissions[${index}].required must be boolean.`);
    }
    if (item.scope !== undefined && (typeof item.scope !== "string" || item.scope.trim().length === 0)) {
      throw new TypeError(`permissions[${index}].scope must be a non-empty string.`);
    }
    return Object.freeze({
      id: item.id,
      purpose: item.purpose.trim(),
      ...(item.required === undefined ? {} : { required: item.required }),
      ...(item.scope === undefined ? {} : { scope: item.scope.trim() }),
    });
  });
  return Object.freeze(result);
}

function normalizeDeprecatedApis(value: unknown): readonly DeprecatedApiDeclaration[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError("deprecatedApis must be an array.");
  const seen = new Set<string>();
  const result = value.map((item, index): DeprecatedApiDeclaration => {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.trim().length === 0) {
      throw new TypeError(`deprecatedApis[${index}].id must be a non-empty string.`);
    }
    const id = item.id.trim();
    if (seen.has(id)) throw new TypeError(`deprecatedApis contains duplicate API ${id}.`);
    seen.add(id);
    if (item.replacement !== undefined && (typeof item.replacement !== "string" || item.replacement.trim().length === 0)) {
      throw new TypeError(`deprecatedApis[${index}].replacement must be a non-empty string.`);
    }
    return Object.freeze({
      id,
      ...(item.replacement === undefined ? {} : { replacement: item.replacement.trim() }),
    });
  });
  return Object.freeze(result);
}

function normalizePlatforms(value: unknown): readonly PluginPlatform[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError("platforms must be an array.");
  const result: PluginPlatform[] = [];
  const seen = new Set<PluginPlatform>();
  for (const [index, platform] of value.entries()) {
    if (typeof platform !== "string" || !SUPPORTED_PLATFORMS.has(platform as PluginPlatform)) {
      throw new TypeError(`platforms[${index}] is invalid.`);
    }
    if (!seen.has(platform as PluginPlatform)) {
      seen.add(platform as PluginPlatform);
      result.push(platform as PluginPlatform);
    }
  }
  return Object.freeze(result);
}

function cloneHostFields(host: RuntimeManifestHostFields) {
  if (
    !isRecord(host.source) ||
    typeof host.source.kind !== "string" ||
    !SUPPORTED_SOURCE_KINDS.has(host.source.kind) ||
    typeof host.source.locator !== "string" ||
    host.source.locator.trim().length === 0
  ) {
    throw new TypeError("Host-controlled plugin source is invalid.");
  }
  const source = Object.freeze({ ...host.source, locator: host.source.locator.trim() });
  let installLocation: PluginInstallLocation | undefined;
  if (host.installLocation !== undefined) {
    if (
      !SUPPORTED_INSTALL_SCHEMES.has(host.installLocation.scheme) ||
      host.installLocation.locator.trim().length === 0
    ) {
      throw new TypeError("Host-controlled install location is invalid.");
    }
    installLocation = Object.freeze({
      scheme: host.installLocation.scheme,
      locator: host.installLocation.locator.trim(),
    });
  }
  let digest: PluginDigest | undefined;
  if (host.digest !== undefined) {
    if (host.digest.algorithm.trim().length === 0 || host.digest.value.trim().length === 0) {
      throw new TypeError("Host-controlled plugin digest is invalid.");
    }
    digest = Object.freeze({
      algorithm: host.digest.algorithm.trim(),
      value: host.digest.value.trim(),
    });
  }
  return { source, installLocation, digest };
}

function freezeManifest(manifest: NormalizedPluginManifest): NormalizedPluginManifest {
  Object.freeze(manifest.identity);
  for (const resolved of manifest.host.resolvedCapabilities) {
    Object.freeze(resolved.resolution);
    Object.freeze(resolved);
  }
  Object.freeze(manifest.host.resolvedCapabilities);
  Object.freeze(manifest.host);
  return Object.freeze(manifest);
}

export function normalizeAuthorManifest(
  input: unknown,
  hostInput: RuntimeManifestHostFields,
): ManifestNormalizationResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      diagnostics: Object.freeze([validationDiagnostic("Plugin manifest must be a JSON object.")]),
    };
  }

  const diagnostics: NexusDiagnostic[] = [];
  let id: PluginId | undefined;
  try {
    if (typeof input.id !== "string") throw new TypeError("id must be a string.");
    id = normalizePluginId(input.id);
  } catch (error) {
    if (error instanceof NexusPluginError) diagnostics.push(error.diagnostic);
    else diagnostics.push(validationDiagnostic(error instanceof Error ? error.message : "Plugin id is invalid."));
  }

  const read = <T>(operation: () => T): T | undefined => {
    try {
      return operation();
    } catch (error) {
      diagnostics.push(validationDiagnostic(error instanceof Error ? error.message : "Manifest field is invalid."));
      return undefined;
    }
  };

  const name = read(() => {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new TypeError("name must be a non-empty string.");
    }
    return input.name.trim();
  });
  const version = read(() => normalizeVersion(input.version, "version"));
  const entrypoint = read(() => {
    if (typeof input.entrypoint !== "string") throw new TypeError("entrypoint must be a string.");
    return normalizeEntrypoint(input.entrypoint);
  });
  const apiVersion = read(() => normalizeVersionRange(input.apiVersion, "apiVersion"));
  const hostVersion = input.hostVersion === undefined
    ? undefined
    : read(() => normalizeVersionRange(input.hostVersion, "hostVersion"));
  const schemaVersion = read(() => {
    const value = input.schemaVersion ?? 1;
    if (!Number.isSafeInteger(value) || (value as number) < 1) {
      throw new TypeError("schemaVersion must be a positive safe integer.");
    }
    return value as number;
  });
  const platforms = read(() => normalizePlatforms(input.platforms));
  const capabilityIds = new Set<string>();
  const requiredCapabilities = read(() => normalizeCapabilities(input.requiredCapabilities, "requiredCapabilities", capabilityIds));
  const optionalCapabilities = read(() => normalizeCapabilities(input.optionalCapabilities, "optionalCapabilities", capabilityIds));
  const permissions = read(() => normalizePermissions(input.permissions));
  const deprecatedApis = read(() => normalizeDeprecatedApis(input.deprecatedApis));
  const extensions = read(() => input.extensions === undefined ? Object.freeze({}) : deepFreezeJson(asJsonObject(input.extensions, "extensions")));

  const unknownFields: Record<string, JsonValue> = {};
  for (const [field, value] of Object.entries(input)) {
    if (AUTHOR_FIELDS.has(field)) continue;
    const cloned = read(() => cloneJson(value, field));
    if (cloned !== undefined) {
      Object.defineProperty(unknownFields, field, {
        configurable: true,
        enumerable: true,
        value: cloned,
        writable: true,
      });
      diagnostics.push({
        code: "manifest-unknown-field",
        severity: "warning",
        phase: "validation",
        message: `Unknown manifest field retained for forward compatibility: ${field}.`,
        details: { field },
      });
    }
  }

  const host = read(() => cloneHostFields(hostInput));
  if (
    id === undefined ||
    name === undefined ||
    version === undefined ||
    entrypoint === undefined ||
    apiVersion === undefined ||
    schemaVersion === undefined ||
    platforms === undefined ||
    requiredCapabilities === undefined ||
    optionalCapabilities === undefined ||
    permissions === undefined ||
    deprecatedApis === undefined ||
    extensions === undefined ||
    host === undefined ||
    (input.hostVersion !== undefined && hostVersion === undefined) ||
    diagnostics.some((diagnostic) => diagnostic.severity === "error" || diagnostic.severity === "fatal")
  ) {
    return { ok: false, diagnostics: Object.freeze(diagnostics) };
  }

  const unknown = deepFreezeJson(unknownFields);
  const manifest = freezeManifest({
    schemaVersion,
    identity: {
      id,
      name,
      version,
      source: host.source,
      ...(host.digest === undefined ? {} : { digest: host.digest }),
    },
    entrypoint,
    apiVersion,
    ...(hostVersion === undefined ? {} : { hostVersion }),
    platforms,
    requiredCapabilities,
    optionalCapabilities,
    permissions,
    deprecatedApis,
    extensions,
    unknownFields: unknown,
    host: {
      source: host.source,
      ...(host.installLocation === undefined ? {} : { installLocation: host.installLocation }),
      ...(host.digest === undefined ? {} : { digest: host.digest }),
      resolvedCapabilities: Object.freeze([]),
    },
  });

  const contextualDiagnostics = diagnostics.map((diagnostic) => ({
    ...diagnostic,
    plugin: { id, version },
  }));
  return {
    ok: true,
    manifest,
    diagnostics: Object.freeze(contextualDiagnostics),
  };
}

export function withResolvedCapabilities(
  manifest: NormalizedPluginManifest,
  resolvedCapabilities: readonly ResolvedCapabilityRequirement[],
): NormalizedPluginManifest {
  return freezeManifest({
    ...manifest,
    host: {
      ...manifest.host,
      resolvedCapabilities: resolvedCapabilities.map((resolved) => ({ ...resolved })),
    },
  });
}

interface StoredReservation {
  readonly manifest: NormalizedPluginManifest;
  readonly reservation: PluginIdentityReservation;
}

export class PluginIdentityRegistry {
  private readonly reservations = new Map<PluginId, StoredReservation>();

  reserve(manifest: NormalizedPluginManifest): PluginIdentityReservationResult {
    const existing = this.reservations.get(manifest.identity.id);
    if (existing) {
      return {
        ok: false,
        diagnostic: manifestDiagnostic(manifest, {
          code: "plugin-id-conflict",
          severity: "error",
          message: `Plugin id ${manifest.identity.id} is already reserved by another package.`,
          details: {
            existingSource: existing.manifest.identity.source.locator,
            conflictingSource: manifest.identity.source.locator,
          },
        }),
      };
    }

    let released = false;
    const reservation: PluginIdentityReservation = Object.freeze({
      pluginId: manifest.identity.id,
      manifest,
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        const current = this.reservations.get(manifest.identity.id);
        if (current?.reservation === reservation) this.reservations.delete(manifest.identity.id);
      },
    });
    this.reservations.set(manifest.identity.id, { manifest, reservation });
    return { ok: true, reservation };
  }

  get(pluginId: PluginId): NormalizedPluginManifest | undefined {
    return this.reservations.get(pluginId)?.manifest;
  }
}
