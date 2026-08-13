export interface VirtualVaultEntry {
  readonly path: string;
  readonly kind: "file" | "folder";
  readonly version: number;
  readonly data?: Uint8Array;
}

function normalizePath(input: string): string {
  if (input.includes("\\") || input.includes("\0") || input.startsWith("/")) {
    throw new RangeError("Virtual vault paths must be normalized relative paths");
  }
  const segments = input.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new RangeError("Virtual vault path escapes its authorized root");
  }
  return segments.join("/");
}

function cloneBytes(data: Uint8Array): Uint8Array {
  return new Uint8Array(data);
}

/** Small deterministic content store for host adapter and plugin fixtures. */
export class VirtualVault {
  private readonly entries = new Map<string, VirtualVaultEntry>();
  private revision = 0;

  constructor(initialFiles: Readonly<Record<string, string | Uint8Array>> = {}) {
    for (const [path, data] of Object.entries(initialFiles)) this.write(path, data);
  }

  normalize(path: string): string {
    return normalizePath(path);
  }

  has(path: string): boolean {
    return this.entries.has(normalizePath(path));
  }

  read(path: string): string {
    return new TextDecoder().decode(this.readBinary(path));
  }

  readBinary(path: string): Uint8Array {
    const entry = this.requireFile(path);
    return cloneBytes(entry.data!);
  }

  write(path: string, data: string | Uint8Array): VirtualVaultEntry {
    const normalized = normalizePath(path);
    if (!normalized) throw new RangeError("Virtual vault file path must not be empty");
    this.ensureParents(normalized);
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : cloneBytes(data);
    const entry = Object.freeze({
      path: normalized,
      kind: "file" as const,
      version: ++this.revision,
      data: bytes,
    });
    this.entries.set(normalized, entry);
    return entry;
  }

  createFolder(path: string): VirtualVaultEntry {
    const normalized = normalizePath(path);
    if (!normalized) throw new RangeError("Virtual vault folder path must not be empty");
    this.ensureParents(`${normalized}/child`);
    const existing = this.entries.get(normalized);
    if (existing) {
      if (existing.kind !== "folder") throw new Error(`Virtual vault path '${normalized}' is a file`);
      return existing;
    }
    const entry = Object.freeze({ path: normalized, kind: "folder" as const, version: ++this.revision });
    this.entries.set(normalized, entry);
    return entry;
  }

  rename(path: string, destination: string): VirtualVaultEntry {
    const source = normalizePath(path);
    const target = normalizePath(destination);
    const entry = this.entries.get(source);
    if (!entry) throw new RangeError(`Virtual vault path '${source}' does not exist`);
    if (!target) throw new RangeError("Virtual vault destination must not be empty");
    if (this.entries.has(target)) throw new Error(`Virtual vault path '${target}' already exists`);
    this.ensureParents(target);
    const moved = Object.freeze({ ...entry, path: target, version: ++this.revision });
    this.entries.delete(source);
    this.entries.set(target, moved);
    if (entry.kind === "folder") {
      for (const [childPath, child] of [...this.entries]) {
        if (!childPath.startsWith(`${source}/`)) continue;
        const nextPath = `${target}${childPath.slice(source.length)}`;
        this.entries.delete(childPath);
        this.entries.set(nextPath, Object.freeze({ ...child, path: nextPath, version: ++this.revision }));
      }
    }
    return moved;
  }

  delete(path: string): void {
    const normalized = normalizePath(path);
    if (!this.entries.delete(normalized)) return;
    for (const childPath of [...this.entries.keys()]) {
      if (childPath.startsWith(`${normalized}/`)) this.entries.delete(childPath);
    }
    this.revision += 1;
  }

  list(): readonly VirtualVaultEntry[] {
    return [...this.entries.values()]
      .sort((left, right) => left.path.localeCompare(right.path))
      .map((entry) => entry.kind === "file"
        ? Object.freeze({ ...entry, data: cloneBytes(entry.data!) })
        : entry);
  }

  private requireFile(path: string): VirtualVaultEntry & { readonly kind: "file"; readonly data: Uint8Array } {
    const normalized = normalizePath(path);
    const entry = this.entries.get(normalized);
    if (!entry || entry.kind !== "file" || !entry.data) {
      throw new RangeError(`Virtual vault file '${normalized}' does not exist`);
    }
    return entry as VirtualVaultEntry & { readonly kind: "file"; readonly data: Uint8Array };
  }

  private ensureParents(path: string): void {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index++) {
      const parent = segments.slice(0, index).join("/");
      const existing = this.entries.get(parent);
      if (existing?.kind === "file") throw new Error(`Virtual vault parent '${parent}' is a file`);
      if (!existing) {
        this.entries.set(parent, Object.freeze({
          path: parent,
          kind: "folder",
          version: ++this.revision,
        }));
      }
    }
  }
}
