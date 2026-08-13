import { RuntimeCapabilityRegistry } from "../capability";
import { DiagnosticBus } from "../diagnostics";
import { FixtureEntrypointResolver } from "./fixture-loader";
import { ResourceTracker } from "./resource-tracker";
import { VirtualClock } from "./virtual-clock";
import { VirtualVault } from "./virtual-vault";
import { VirtualWorkspace } from "./virtual-workspace";
import { RuntimeUiHost, createWindowContext } from "../ui/runtime-ui";

export interface RuntimeTestkitOptions {
  readonly document?: Document;
  readonly vaultFiles?: Readonly<Record<string, string | Uint8Array>>;
}

export function createRuntimeTestkit(options: RuntimeTestkitOptions = {}) {
  const ownerDocument = options.document ?? globalThis.document;
  if (!ownerDocument) throw new Error("Runtime testkit requires a DOM Document");
  const workspace = new VirtualWorkspace(ownerDocument);
  const workspaceWindow = workspace.createWindow(ownerDocument);
  const ui = new RuntimeUiHost({ defaultWindow: workspaceWindow });
  return {
    capabilities: new RuntimeCapabilityRegistry(),
    clock: new VirtualClock(),
    diagnostics: new DiagnosticBus(),
    fixtures: new FixtureEntrypointResolver(),
    resources: new ResourceTracker(),
    vault: new VirtualVault(options.vaultFiles),
    workspace,
    ui,
  } as const;
}

export { FixtureEntrypointResolver } from "./fixture-loader";
export {
  ResourceTracker,
  type TestResourceKind,
  type TestResourceSnapshot,
  type TrackedTestResource,
} from "./resource-tracker";
export { VirtualClock, type VirtualTimerKind, type VirtualTimerSnapshot } from "./virtual-clock";
export { VirtualVault, type VirtualVaultEntry } from "./virtual-vault";
export {
  VirtualWorkspace,
  type VirtualWorkspaceEvent,
  type VirtualWorkspaceLeaf,
  type VirtualWorkspaceWindow,
} from "./virtual-workspace";
export { RuntimeUiHost, createWindowContext } from "../ui/runtime-ui";
