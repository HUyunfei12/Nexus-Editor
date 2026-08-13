import { defineCapabilityToken } from "./capability";
import type { CommandService, HotkeyService, ScopeService } from "./commands";
import type {
  FileManagerService,
  MetadataService,
  ResourceService,
  VaultService,
} from "./content";
import type {
  ClipboardService,
  EditorHostService,
  EditorTransactionService,
  MarkdownProcessorService,
} from "./editor";
import type { PluginStorageService, SecretStorageService } from "./storage";
import type { UiService } from "./ui";
import type { WorkspaceService } from "./workspace";

export const COMMANDS_CAPABILITY = defineCapabilityToken<CommandService, "nexus.commands", "1.0.0", "application">({
  id: "nexus.commands",
  version: "1.0.0",
  scope: "application",
});

export const HOTKEYS_CAPABILITY = defineCapabilityToken<HotkeyService, "nexus.hotkeys", "1.0.0", "application">({
  id: "nexus.hotkeys",
  version: "1.0.0",
  scope: "application",
});

export const SCOPES_CAPABILITY = defineCapabilityToken<ScopeService, "nexus.scopes", "1.0.0", "application">({
  id: "nexus.scopes",
  version: "1.0.0",
  scope: "application",
});

export const EDITOR_HOST_CAPABILITY = defineCapabilityToken<EditorHostService, "nexus.editor-host", "1.0.0", "application">({
  id: "nexus.editor-host",
  version: "1.0.0",
  scope: "application",
});

export const EDITOR_CLIPBOARD_CAPABILITY = defineCapabilityToken<ClipboardService, "nexus.editor-clipboard", "1.0.0", "editor">({
  id: "nexus.editor-clipboard",
  version: "1.0.0",
  scope: "editor",
});

export const EDITOR_TRANSACTIONS_CAPABILITY = defineCapabilityToken<EditorTransactionService, "nexus.editor-transactions", "1.0.0", "editor">({
  id: "nexus.editor-transactions",
  version: "1.0.0",
  scope: "editor",
});

export const MARKDOWN_PROCESSORS_CAPABILITY = defineCapabilityToken<MarkdownProcessorService, "nexus.markdown-processors", "1.0.0", "application">({
  id: "nexus.markdown-processors",
  version: "1.0.0",
  scope: "application",
});

export const WORKSPACE_CAPABILITY = defineCapabilityToken<WorkspaceService, "nexus.workspace", "1.0.0", "workspace">({
  id: "nexus.workspace",
  version: "1.0.0",
  scope: "workspace",
});

export const VAULT_CAPABILITY = defineCapabilityToken<VaultService, "nexus.vault", "1.0.0", "workspace">({
  id: "nexus.vault",
  version: "1.0.0",
  scope: "workspace",
});

export const FILE_MANAGER_CAPABILITY = defineCapabilityToken<FileManagerService, "nexus.file-manager", "1.0.0", "workspace">({
  id: "nexus.file-manager",
  version: "1.0.0",
  scope: "workspace",
});

export const METADATA_CAPABILITY = defineCapabilityToken<MetadataService, "nexus.metadata-cache", "1.0.0", "workspace">({
  id: "nexus.metadata-cache",
  version: "1.0.0",
  scope: "workspace",
});

export const RESOURCES_CAPABILITY = defineCapabilityToken<ResourceService, "nexus.resources", "1.0.0", "workspace">({
  id: "nexus.resources",
  version: "1.0.0",
  scope: "workspace",
});

export const UI_CAPABILITY = defineCapabilityToken<UiService, "nexus.ui", "1.0.0", "window">({
  id: "nexus.ui",
  version: "1.0.0",
  scope: "window",
});

export const PLUGIN_STORAGE_CAPABILITY = defineCapabilityToken<PluginStorageService, "nexus.plugin-storage", "1.0.0", "application">({
  id: "nexus.plugin-storage",
  version: "1.0.0",
  scope: "application",
});

export const SECRETS_CAPABILITY = defineCapabilityToken<SecretStorageService, "nexus.secrets", "1.0.0", "application">({
  id: "nexus.secrets",
  version: "1.0.0",
  scope: "application",
});
