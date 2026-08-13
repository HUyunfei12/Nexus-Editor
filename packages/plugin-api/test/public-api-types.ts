import type {
  AuthorPluginManifest,
  CapabilityResolution,
  CommandDefinition,
  CommandService,
  EditorContext,
  NexusPluginConstructor,
  NormalizedPluginManifest,
  PluginStorageService,
  SecretStorageService,
  UiService,
  VaultService,
  WorkspaceService,
} from "../src/index";
import {
  COMMANDS_CAPABILITY,
  UI_CAPABILITY,
  VAULT_CAPABILITY,
  WORKSPACE_CAPABILITY,
} from "../src/index";

type Equal<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends
  (<T>() => T extends TRight ? 1 : 2)
    ? true
    : false;
type Expect<T extends true> = T;
type ServiceOf<T> = T extends { readonly serviceType?: infer TService } ? TService : never;

type _CommandsTokenService = Expect<Equal<ServiceOf<typeof COMMANDS_CAPABILITY>, CommandService>>;
type _WorkspaceTokenService = Expect<Equal<ServiceOf<typeof WORKSPACE_CAPABILITY>, WorkspaceService>>;
type _VaultTokenService = Expect<Equal<ServiceOf<typeof VAULT_CAPABILITY>, VaultService>>;
type _UiTokenService = Expect<Equal<ServiceOf<typeof UI_CAPABILITY>, UiService>>;

const authorManifest = {
  id: "sample-plugin",
  name: "Sample Plugin",
  version: "1.0.0",
  entrypoint: "./main.js",
  apiVersion: "^1.0.0",
  requiredCapabilities: [{ id: "nexus.commands", version: "^1.0.0" }],
} satisfies AuthorPluginManifest;

const callbackCommand = {
  id: "open",
  name: "Open",
  callback: async () => undefined,
} satisfies CommandDefinition;

const editorCommand = {
  id: "format",
  name: "Format",
  editorCallback: (_editor: EditorContext) => undefined,
} satisfies CommandDefinition;

const invalidCommand = {
  id: "invalid",
  name: "Invalid",
  callback: () => undefined,
  editorCallback: (_editor: EditorContext) => undefined,
};
// @ts-expect-error command execution modes are mutually exclusive
const rejectedCommand: CommandDefinition = invalidCommand;

declare const capabilityResult: CapabilityResolution<PluginStorageService>;
if (capabilityResult.status === "available") {
  const storage: PluginStorageService = capabilityResult.handle.service;
  void storage;
} else if (capabilityResult.status === "permission-denied") {
  const denied: readonly string[] = capabilityResult.deniedPermissions;
  void denied;
}

declare const pluginConstructor: NexusPluginConstructor;
declare const manifest: NormalizedPluginManifest;
declare const storage: PluginStorageService;
declare const secrets: SecretStorageService;
void pluginConstructor;
void manifest;
void storage;
void secrets;
void authorManifest;
void callbackCommand;
void editorCommand;
