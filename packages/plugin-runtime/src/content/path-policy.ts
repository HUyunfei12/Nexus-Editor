import { NexusPluginError } from "@floatboat/nexus-plugin-api";
import type {
  NexusDiagnostic,
  ServiceResult,
  VaultPath,
} from "@floatboat/nexus-plugin-api";

export interface VaultPathAuthorization {
  readonly authorized: boolean;
}

/**
 * Host-side hook for resolving symlinks (or equivalent aliases) against the
 * currently authorized Vault root. Absolute paths stay inside the adapter.
 */
export interface VaultPathAuthorizationResolver {
  resolve(path: VaultPath): VaultPathAuthorization;
}

export interface VaultPathPolicyOptions {
  readonly resolver?: VaultPathAuthorizationResolver;
}

function pathDiagnostic(message: string): NexusDiagnostic {
  return Object.freeze({
    code: "path-outside-authorized-root",
    severity: "error",
    phase: "runtime",
    message,
    resourceId: "nexus.vault:path",
  });
}

function looksAbsolute(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("//") ||
    /^[A-Za-z]:\//.test(path) ||
    /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(path)
  );
}

function validateDecodedPath(path: string, previous: string): void {
  if (path.includes("\0") || path.includes("\\") || looksAbsolute(path)) {
    throw new NexusPluginError(pathDiagnostic("Vault path is outside the authorized root"));
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new NexusPluginError(pathDiagnostic("Vault path traversal is not allowed"));
  }
  // Encoded separators create aliases that a filesystem or URL layer may
  // interpret differently from the public Vault path.
  if (
    path !== previous &&
    path.split("/").length !== previous.split("/").length
  ) {
    throw new NexusPluginError(pathDiagnostic("Encoded Vault path separators are not allowed"));
  }
}

/** Normalize a public path without ever resolving or returning a host path. */
export function normalizeVaultPath(input: string): VaultPath {
  if (typeof input !== "string") {
    throw new NexusPluginError(pathDiagnostic("Vault path must be a string"));
  }
  validateDecodedPath(input, input);

  let decoded = input;
  // Repeated decoding catches both percent-encoded and double-encoded
  // traversal while retaining harmless literal escapes such as `%20`.
  for (let depth = 0; depth < 4 && decoded.includes("%"); depth += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new NexusPluginError(pathDiagnostic("Vault path contains invalid percent encoding"));
    }
    validateDecodedPath(next, decoded);
    if (next === decoded) break;
    decoded = next;
  }
  if (/%(?:[0-9A-Fa-f]{2})/.test(decoded)) {
    throw new NexusPluginError(pathDiagnostic("Vault path encoding is nested too deeply"));
  }

  const normalized = input
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/")
    .normalize("NFC");
  return normalized as VaultPath;
}

export class VaultPathPolicy {
  private readonly resolver?: VaultPathAuthorizationResolver;

  constructor(options: VaultPathPolicyOptions = {}) {
    this.resolver = options.resolver;
  }

  normalize(path: string): VaultPath {
    const normalized = normalizeVaultPath(path);
    if (this.resolver && !this.resolver.resolve(normalized).authorized) {
      throw new NexusPluginError(
        pathDiagnostic("Resolved Vault path is outside the authorized root"),
      );
    }
    return normalized;
  }

  result(path: string): ServiceResult<VaultPath> {
    try {
      return { ok: true, value: this.normalize(path) };
    } catch (error) {
      if (error instanceof NexusPluginError) {
        return { ok: false, diagnostic: error.diagnostic };
      }
      return {
        ok: false,
        diagnostic: pathDiagnostic("Vault path could not be authorized"),
      };
    }
  }
}
