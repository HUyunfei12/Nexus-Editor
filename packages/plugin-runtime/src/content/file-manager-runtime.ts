import type {
  AttachmentLocationRequest,
  ContentWriteResult,
  FileManagerService,
  FileMoveOptions,
  MarkdownLinkOptions,
  MutableJsonObject,
  NexusAbstractFile,
  NexusFile,
  ResourceOwner,
  ServiceResult,
  TrashOptions,
  VaultPath,
} from "@floatboat/nexus-plugin-api";

import { parseFrontmatterDocument, serializeFrontmatterDocument } from "./frontmatter";
import { VaultPathPolicy } from "./path-policy";
import { MemoryVaultRuntime } from "./vault-runtime";

export interface MemoryFileManagerOptions {
  readonly vault: MemoryVaultRuntime;
  readonly attachmentFolder?: string;
  readonly updateLinksByDefault?: boolean;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index <= 0 ? "" : name.slice(index + 1);
}

function stemOf(name: string): string {
  const extension = extensionOf(name);
  return extension ? name.slice(0, -(extension.length + 1)) : name;
}

function escapeLinkPart(value: string): string {
  return value.replace(/([\\|\]#^])/g, "\\$1");
}

function normalizeComparableLink(target: string): string {
  return target.replace(/\\/g, "/").replace(/\.md$/i, "").toLocaleLowerCase();
}

function rewriteWikiLinks(source: string, oldPath: string, newPath: string): string {
  const oldWithoutExtension = oldPath.replace(/\.md$/i, "");
  const oldBasename = stemOf(oldPath.slice(oldPath.lastIndexOf("/") + 1));
  const replacement = newPath.replace(/\.md$/i, "");
  return source.replace(
    /(?<!\\)(!?)\[\[([^\[\]\n|]+?)(\|[^\[\]\n]+?)?\]\]/g,
    (whole, embed: string, rawTarget: string, alias: string | undefined) => {
      const anchorIndex = rawTarget.search(/[#^]/);
      const pathPart = (anchorIndex < 0 ? rawTarget : rawTarget.slice(0, anchorIndex)).trim();
      const anchor = anchorIndex < 0 ? "" : rawTarget.slice(anchorIndex);
      const comparable = normalizeComparableLink(pathPart);
      if (
        comparable !== normalizeComparableLink(oldPath) &&
        comparable !== normalizeComparableLink(oldWithoutExtension) &&
        comparable !== normalizeComparableLink(oldBasename)
      ) {
        return whole;
      }
      return `${embed}[[${replacement}${anchor}${alias ?? ""}]]`;
    },
  );
}

export class MemoryFileManagerRuntime {
  private readonly vault: MemoryVaultRuntime;
  private readonly pathPolicy = new VaultPathPolicy();
  private readonly attachmentFolder: VaultPath;
  private readonly updateLinksByDefault: boolean;

  constructor(options: MemoryFileManagerOptions) {
    this.vault = options.vault;
    this.attachmentFolder = this.pathPolicy.normalize(options.attachmentFolder ?? "attachments");
    this.updateLinksByDefault = options.updateLinksByDefault ?? true;
  }

  createService(owner: ResourceOwner): FileManagerService {
    const vaultService = this.vault.createService(owner, () => undefined);
    const service: FileManagerService = {
      getAvailableAttachmentPath: (request) => this.getAvailableAttachmentPath(request),
      moveFile: (file, destination, options) =>
        this.moveFile(vaultService, file, destination, options),
      renameFile: (file, name, options) => {
        if (
          name.includes("/") ||
          name.includes("\\") ||
          !name.trim() ||
          name === "." ||
          name === ".."
        ) {
          return Promise.resolve({
            ok: false,
            diagnostic: {
              code: "path-outside-authorized-root",
              severity: "error",
              phase: "runtime",
              message: "File name must be a single non-empty path segment",
            },
          });
        }
        try {
          const destination = this.pathPolicy.normalize(
            dirname(file.path) ? `${dirname(file.path)}/${name}` : name,
          );
          return this.moveFile(vaultService, file, destination, options);
        } catch (error) {
          return Promise.resolve({
            ok: false,
            diagnostic: {
              code: "path-outside-authorized-root",
              severity: "error",
              phase: "runtime",
              message: error instanceof Error ? error.message : "File name is invalid",
            },
          });
        }
      },
      trashFile: async (file, options) => {
        if (options?.permanent) {
          const result = await vaultService.delete(file, { permanent: true });
          return result.ok
            ? { ok: true, value: { recoverable: false as const } }
            : result;
        }
        return vaultService.trash(file);
      },
      generateMarkdownLink: (file, options) => this.generateMarkdownLink(file, options),
      processFrontmatter: (file, transform) =>
        this.processFrontmatter(vaultService, file, transform),
    };
    return Object.freeze(service);
  }

  private async getAvailableAttachmentPath(
    request: AttachmentLocationRequest,
  ): Promise<VaultPath> {
    const name = request.name.trim();
    if (!name || name.includes("/") || name.includes("\\")) {
      throw new RangeError("Attachment name must be a single non-empty path segment");
    }
    const preferredFolder = request.sourcePath
      ? dirname(this.pathPolicy.normalize(request.sourcePath))
      : this.attachmentFolder;
    const base = preferredFolder ? `${preferredFolder}/${name}` : name;
    if (!this.vault.getAbstractFileByPath(base)) return this.pathPolicy.normalize(base);
    const extension = extensionOf(name);
    const stem = stemOf(name);
    for (let suffix = 1; suffix < Number.MAX_SAFE_INTEGER; suffix += 1) {
      const candidateName = extension
        ? `${stem} ${suffix}.${extension}`
        : `${stem} ${suffix}`;
      const candidate = preferredFolder
        ? `${preferredFolder}/${candidateName}`
        : candidateName;
      if (!this.vault.getAbstractFileByPath(candidate)) {
        return this.pathPolicy.normalize(candidate);
      }
    }
    throw new Error("No attachment path is available");
  }

  private async moveFile(
    service: ReturnType<MemoryVaultRuntime["createService"]>,
    file: NexusAbstractFile,
    destination: VaultPath,
    options: FileMoveOptions = {},
  ): Promise<ServiceResult<NexusAbstractFile>> {
    const oldPath = file.path;
    const result = await service.rename(file, destination, {
      ...(options.expectedVersion ? { expectedVersion: options.expectedVersion } : {}),
      origin: "file-manager-move",
    });
    if (!result.ok) return result;
    const shouldUpdate = options.updateLinks === "always" ||
      (options.updateLinks !== "never" && this.updateLinksByDefault);
    if (shouldUpdate && oldPath.toLocaleLowerCase().endsWith(".md")) {
      const failures: string[] = [];
      for (const source of this.vault.listFiles()) {
        if (!source.path.toLocaleLowerCase().endsWith(".md")) continue;
        const transformed = await service.process(source, (current) =>
          rewriteWikiLinks(current, oldPath, result.value.path));
        if (!transformed.ok) failures.push(source.path);
      }
      if (failures.length > 0) {
        return {
          ok: false,
          diagnostic: {
            code: "unsupported-operation",
            severity: "error",
            phase: "runtime",
            message: "File moved, but one or more Markdown references could not be updated",
            details: { moved: true, failedFiles: failures },
          },
        };
      }
    }
    return result;
  }

  private generateMarkdownLink(
    file: NexusFile,
    options: MarkdownLinkOptions = {},
  ): string {
    if (!file.valid) throw new RangeError("Cannot link to an invalid file reference");
    let target = file.extension.toLocaleLowerCase() === "md"
      ? file.path.slice(0, -(file.extension.length + 1))
      : file.path;
    if (options.subpath) target += options.subpath;
    const alias = options.alias ? `|${escapeLinkPart(options.alias)}` : "";
    return `${options.embed ? "!" : ""}[[${escapeLinkPart(target)}${alias}]]`;
  }

  private processFrontmatter(
    service: ReturnType<MemoryVaultRuntime["createService"]>,
    file: NexusFile,
    transform: (frontmatter: MutableJsonObject) => void,
  ): Promise<ContentWriteResult> {
    return service.process(file, (source) => {
      const parsed = parseFrontmatterDocument(source);
      const result = transform(parsed.frontmatter) as unknown;
      if (
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        "then" in result
      ) {
        throw new TypeError("Frontmatter transforms must be synchronous");
      }
      return serializeFrontmatterDocument(parsed.frontmatter, parsed.body, parsed.newline);
    }, { origin: "frontmatter" });
  }
}
