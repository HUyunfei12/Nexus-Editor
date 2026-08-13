import type { NexusDiagnostic } from "./diagnostics";
import type { TypedEvents } from "./events";
import type {
  ContentVersion,
  FileId,
  OperationId,
  PluginId,
  VaultPath,
  WindowId,
} from "./identifiers";
import type { JsonObject, MutableJsonObject } from "./json";
import type { Registration, ServiceResult } from "./ownership";

export interface NexusAbstractFileBase {
  readonly id: FileId;
  readonly path: VaultPath;
  readonly name: string;
  readonly parent: NexusFolder | null;
  readonly valid: boolean;
}

export interface NexusFile extends NexusAbstractFileBase {
  readonly kind: "file";
  readonly basename: string;
  readonly extension: string;
  readonly size: number;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly version: ContentVersion;
}

export interface NexusFolder extends NexusAbstractFileBase {
  readonly kind: "folder";
  readonly children: readonly NexusAbstractFile[];
}

export type NexusAbstractFile = NexusFile | NexusFolder;

export interface FileOperationOrigin {
  readonly kind: "plugin" | "host" | "external";
  readonly pluginId?: PluginId;
  readonly operationId: OperationId;
}

export interface VaultReadOptions {
  readonly consistency?: "latest" | "cached";
}

export interface VaultWriteOptions {
  readonly expectedVersion?: ContentVersion;
  readonly origin?: string;
}

export interface VaultRenameOptions {
  readonly expectedVersion?: ContentVersion;
  readonly origin?: string;
}

export interface VaultDeleteOptions {
  /** Permanent deletion requires a distinct host permission. */
  readonly permanent: true;
  readonly origin?: string;
}

export interface ContentWriteSuccess<TFile extends NexusFile = NexusFile> {
  readonly ok: true;
  readonly file: TFile;
  readonly version: ContentVersion;
  readonly operationId: OperationId;
}

export interface ContentWriteFailure {
  readonly ok: false;
  readonly diagnostic: NexusDiagnostic;
  readonly currentVersion?: ContentVersion;
}

export type ContentWriteResult<TFile extends NexusFile = NexusFile> =
  | ContentWriteSuccess<TFile>
  | ContentWriteFailure;

export interface VaultEventMap {
  readonly create: {
    readonly file: NexusAbstractFile;
    readonly version?: ContentVersion;
    readonly origin: FileOperationOrigin;
  };
  readonly modify: {
    readonly file: NexusFile;
    readonly version: ContentVersion;
    readonly origin: FileOperationOrigin;
  };
  readonly rename: {
    readonly file: NexusAbstractFile;
    readonly oldPath: VaultPath;
    readonly version?: ContentVersion;
    readonly origin: FileOperationOrigin;
  };
  readonly delete: {
    readonly fileId: FileId;
    readonly path: VaultPath;
    readonly version?: ContentVersion;
    readonly origin: FileOperationOrigin;
  };
}

export interface VaultService {
  readonly events: TypedEvents<VaultEventMap>;
  getAbstractFileByPath(path: VaultPath): NexusAbstractFile | null;
  getFileByPath(path: VaultPath): NexusFile | null;
  getFolderByPath(path: VaultPath): NexusFolder | null;
  read(file: NexusFile, options?: VaultReadOptions): Promise<string>;
  readBinary(file: NexusFile, options?: VaultReadOptions): Promise<ArrayBuffer>;
  create(path: VaultPath, data: string, options?: VaultWriteOptions): Promise<ContentWriteResult>;
  createBinary(
    path: VaultPath,
    data: ArrayBuffer,
    options?: VaultWriteOptions,
  ): Promise<ContentWriteResult>;
  createFolder(path: VaultPath): Promise<ServiceResult<NexusFolder>>;
  modify(
    file: NexusFile,
    data: string,
    options?: VaultWriteOptions,
  ): Promise<ContentWriteResult>;
  modifyBinary(
    file: NexusFile,
    data: ArrayBuffer,
    options?: VaultWriteOptions,
  ): Promise<ContentWriteResult>;
  append(
    file: NexusFile,
    data: string,
    options?: VaultWriteOptions,
  ): Promise<ContentWriteResult>;
  process(
    file: NexusFile,
    transform: (current: string) => string,
    options?: Omit<VaultWriteOptions, "expectedVersion">,
  ): Promise<ContentWriteResult>;
  rename(
    file: NexusAbstractFile,
    destination: VaultPath,
    options?: VaultRenameOptions,
  ): Promise<ServiceResult<NexusAbstractFile>>;
  trash(file: NexusAbstractFile): Promise<ServiceResult<{ readonly recoverable: true }>>;
  delete(
    file: NexusAbstractFile,
    options: VaultDeleteOptions,
  ): Promise<ServiceResult<void>>;
}

export interface FileMoveOptions {
  readonly updateLinks?: "host-default" | "always" | "never";
  readonly expectedVersion?: ContentVersion;
}

export interface TrashOptions {
  readonly permanent?: boolean;
}

export interface MarkdownLinkOptions {
  readonly sourcePath?: VaultPath;
  readonly subpath?: string;
  readonly alias?: string;
  readonly embed?: boolean;
}

export interface AttachmentLocationRequest {
  readonly name: string;
  readonly sourcePath?: VaultPath;
  readonly mimeType?: string;
}

export interface FileManagerService {
  getAvailableAttachmentPath(request: AttachmentLocationRequest): Promise<VaultPath>;
  moveFile(
    file: NexusAbstractFile,
    destination: VaultPath,
    options?: FileMoveOptions,
  ): Promise<ServiceResult<NexusAbstractFile>>;
  renameFile(
    file: NexusAbstractFile,
    name: string,
    options?: FileMoveOptions,
  ): Promise<ServiceResult<NexusAbstractFile>>;
  trashFile(
    file: NexusAbstractFile,
    options?: TrashOptions,
  ): Promise<ServiceResult<{ readonly recoverable: boolean }>>;
  generateMarkdownLink(file: NexusFile, options?: MarkdownLinkOptions): string;
  processFrontmatter(
    file: NexusFile,
    transform: (frontmatter: MutableJsonObject) => void,
  ): Promise<ContentWriteResult>;
}

export interface MarkdownPosition {
  readonly line: number;
  readonly column: number;
  readonly offset: number;
}

export interface MarkdownLocation {
  readonly start: MarkdownPosition;
  readonly end: MarkdownPosition;
}

export interface MetadataHeading {
  readonly heading: string;
  readonly level: number;
  readonly position: MarkdownLocation;
}

export interface MetadataBlock {
  readonly id: string;
  readonly position: MarkdownLocation;
}

export interface MetadataLink {
  readonly link: string;
  readonly displayText?: string;
  readonly embed: boolean;
  readonly position: MarkdownLocation;
}

export interface FileMetadata {
  readonly fileId: FileId;
  readonly version: ContentVersion;
  readonly frontmatter: JsonObject | null;
  readonly headings: readonly MetadataHeading[];
  readonly blocks: Readonly<Record<string, MetadataBlock>>;
  readonly tags: readonly string[];
  readonly links: readonly MetadataLink[];
  readonly embeds: readonly MetadataLink[];
}

export interface ResolvedLink {
  readonly source: NexusFile;
  readonly target: NexusFile;
  readonly original: string;
}

export interface UnresolvedLink {
  readonly source: NexusFile;
  readonly target: string;
}

export interface MetadataEventMap {
  readonly changed: {
    readonly file: NexusFile;
    readonly version: ContentVersion;
    readonly metadata: FileMetadata;
  };
  readonly resolved: {
    readonly version: number;
    readonly changedFiles: readonly FileId[];
  };
  readonly error: {
    readonly file: NexusFile;
    readonly version: ContentVersion;
    readonly diagnostic: NexusDiagnostic;
  };
}

export interface MetadataService {
  readonly events: TypedEvents<MetadataEventMap>;
  getFileCache(file: NexusFile): FileMetadata | null;
  waitForVersion(file: NexusFile, version: ContentVersion): Promise<FileMetadata>;
  resolveLink(target: string, sourcePath?: VaultPath): NexusFile | null;
  getResolvedLinks(file?: NexusFile): readonly ResolvedLink[];
  getUnresolvedLinks(file?: NexusFile): readonly UnresolvedLink[];
  getBacklinks(file: NexusFile): readonly ResolvedLink[];
}

export interface ResourceUrlRegistration extends Registration {
  readonly url: string;
  readonly fileId: FileId;
  readonly revoked: boolean;
}

export interface ResourceService {
  createResourceUrl(
    file: NexusFile,
    options?: { readonly windowId?: WindowId },
  ): Promise<ServiceResult<ResourceUrlRegistration>>;
}
