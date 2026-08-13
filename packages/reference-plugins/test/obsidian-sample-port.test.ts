import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  PLUGIN_STORAGE_CAPABILITY,
  UI_CAPABILITY,
  VAULT_CAPABILITY,
  WORKSPACE_CAPABILITY,
  type ComponentId,
  type NexusApp,
  type PluginId,
  type ResourceOwner,
  type VaultPath,
} from "@floatboat/nexus-plugin-api";
import { createEditor } from "@floatboat/nexus-core";
import {
  CommandRegistry,
  ComponentLifecycleRuntime,
  DiagnosticBus,
  EditorHostRegistry,
  MemoryPluginStorageBackend,
  MemoryVaultRuntime,
  PluginStorageRuntime,
  RuntimeCapabilityRegistry,
  RuntimeUiHost,
  RuntimeWorkspace,
  normalizeAuthorManifest,
} from "@floatboat/nexus-plugin-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ObsidianSamplePortPlugin,
  createObsidianSamplePortManifest,
} from "../src/obsidian-sample-port";

const SAMPLE_PLUGIN_ID = "obsidian-sample-port";
const SAMPLE_VIEW_TYPE = `${SAMPLE_PLUGIN_ID}:sample-view`;
const COMMAND_IDS = [
  `${SAMPLE_PLUGIN_ID}:open-modal-simple`,
  `${SAMPLE_PLUGIN_ID}:replace-selected`,
  `${SAMPLE_PLUGIN_ID}:open-modal-complex`,
  `${SAMPLE_PLUGIN_ID}:open-sample-view`,
] as const;

const teardowns: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const teardown of teardowns.splice(0).reverse()) await teardown();
  vi.useRealTimers();
  document.body.replaceChildren();
});

function testOwner(id: string): ResourceOwner {
  return {
    pluginId: id as PluginId,
    componentId: `${id}/root` as ComponentId,
  };
}

function normalizedManifest() {
  const result = normalizeAuthorManifest(createObsidianSamplePortManifest(), {
    source: {
      kind: "development",
      locator: "fixture:obsidian-sample-port",
    },
  });
  if (!result.ok) throw new Error("The sample port fixture manifest is invalid");
  return result.manifest;
}

function clipboardEvent(type: "paste", text: string): ClipboardEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: {
      getData: (mime: string) => mime === "text/plain" ? text : "",
    },
  });
  return event;
}

async function createFullHarness() {
  const manifest = normalizedManifest();
  const diagnostics = new DiagnosticBus();
  const capabilities = new RuntimeCapabilityRegistry();
  const commands = new CommandRegistry();
  const editors = new EditorHostRegistry();
  const workspace = new RuntimeWorkspace(document, { id: "runtime-workspace" });
  const windowContext = workspace.createWindow(document, "main");
  const vault = new MemoryVaultRuntime();
  const storageBackend = new MemoryPluginStorageBackend();
  storageBackend.putExternal(manifest.identity.id, {
    settings: {
      mySetting: "loaded from storage",
      enablePasteTransform: true,
    },
  });
  const storage = new PluginStorageRuntime({ backend: storageBackend });

  const editorContainer = document.createElement("div");
  document.body.append(editorContainer);
  const editor = createEditor({
    container: editorContainer,
    initialValue: "hello world",
  });
  const attachment = editors.attach({
    editor,
    surface: { kind: "document", root: editorContainer },
    window: windowContext,
  });
  await attachment.ready;

  const ribbon = document.createElement("nav");
  const statusBar = document.createElement("footer");
  document.body.append(ribbon, statusBar);
  const actionContext = Object.freeze({
    window: windowContext,
    leaf: null,
    view: null,
    editor: attachment.context,
    file: null,
    command: null,
  });
  const ui = new RuntimeUiHost({
    defaultWindow: windowContext,
    commandRegistry: commands,
    resolveStorage: (owner) => storage.createService(owner, () => undefined),
    slots: {
      ribbon: {
        window: windowContext,
        containerEl: ribbon,
        actionContext,
      },
      "status-bar": {
        window: windowContext,
        containerEl: statusBar,
        actionContext,
      },
    },
  });

  capabilities.registerOwnerBound(
    COMMANDS_CAPABILITY,
    ({ owner, registerResource }) => commands.createService(owner, registerResource),
  );
  capabilities.registerOwnerBound(
    EDITOR_HOST_CAPABILITY,
    ({ owner, registerResource }) => editors.createService(owner, registerResource),
  );
  capabilities.registerOwnerBound(
    PLUGIN_STORAGE_CAPABILITY,
    ({ owner, registerResource }) => storage.createService(owner, registerResource),
  );
  capabilities.registerOwnerBound(
    UI_CAPABILITY,
    ({ owner, registerResource }) => ui.createService(owner, registerResource),
    { context: { windowId: windowContext.id } },
  );
  capabilities.registerOwnerBound(
    WORKSPACE_CAPABILITY,
    ({ owner, registerResource }) => workspace.createService(owner, registerResource),
    { context: { workspaceId: workspace.id } },
  );
  capabilities.registerOwnerBound(
    VAULT_CAPABILITY,
    ({ owner, registerResource }) => vault.createService(owner, registerResource),
    { context: { workspaceId: workspace.id } },
  );

  const access = capabilities.createPluginAccess(manifest);
  const app: NexusApp = Object.freeze({
    host: Object.freeze({
      id: "sample-port-test-host",
      name: "Sample Port Test Host",
      version: "1.0.0",
      platform: "web" as const,
    }),
    apiVersion: "1.0.0",
    capabilities: access,
    diagnostics,
  });
  const plugin = new ObsidianSamplePortPlugin(app, manifest);
  const controller = new ComponentLifecycleRuntime(diagnostics).manage(
    plugin,
    manifest.identity,
  );
  access.bindOwner(plugin);

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await controller.unload();
    await access.dispose();
    await attachment.detach();
    for (const leaf of [...workspace.getLeaves()]) await workspace.closeLeaf(leaf);
    editor.destroy();
    await storage.dispose();
    await vault.dispose();
    ribbon.remove();
    statusBar.remove();
    editorContainer.remove();
  };
  teardowns.push(dispose);

  await controller.load();
  return {
    access,
    attachment,
    commands,
    controller,
    diagnostics,
    dispose,
    editor,
    editorContainer,
    plugin,
    ribbon,
    statusBar,
    storage,
    ui,
    vault,
    windowContext,
    workspace,
  };
}

async function createHeadlessHarness() {
  const manifest = normalizedManifest();
  const diagnostics = new DiagnosticBus();
  const capabilities = new RuntimeCapabilityRegistry();
  const commands = new CommandRegistry();
  const editors = new EditorHostRegistry();
  capabilities.registerOwnerBound(
    COMMANDS_CAPABILITY,
    ({ owner, registerResource }) => commands.createService(owner, registerResource),
  );
  capabilities.registerOwnerBound(
    EDITOR_HOST_CAPABILITY,
    ({ owner, registerResource }) => editors.createService(owner, registerResource),
  );

  const access = capabilities.createPluginAccess(manifest);
  const app: NexusApp = Object.freeze({
    host: Object.freeze({
      id: "headless-sample-port-test-host",
      name: "Headless Sample Port Test Host",
      version: "1.0.0",
      platform: "headless" as const,
    }),
    apiVersion: "1.0.0",
    capabilities: access,
    diagnostics,
  });
  const plugin = new ObsidianSamplePortPlugin(app, manifest);
  const controller = new ComponentLifecycleRuntime(diagnostics).manage(
    plugin,
    manifest.identity,
  );
  access.bindOwner(plugin);

  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    await controller.unload();
    await access.dispose();
  };
  teardowns.push(dispose);

  await controller.load();
  return { commands, controller, diagnostics, dispose, plugin };
}

describe("ObsidianSamplePortPlugin", () => {
  it("ports the sample commands, paste hook, ribbon, status, modal and settings UI", async () => {
    vi.useFakeTimers();
    const harness = await createFullHarness();
    const {
      attachment,
      commands,
      controller,
      diagnostics,
      editor,
      editorContainer,
      plugin,
      ribbon,
      statusBar,
      ui,
      windowContext,
    } = harness;

    expect(controller.state).toBe("loaded");
    expect(plugin.lifecycleEvents).toEqual(["load"]);
    expect(plugin.settings).toEqual({
      mySetting: "loaded from storage",
      enablePasteTransform: true,
    });
    expect(commands.listCommands().map(({ id }) => id)).toEqual(COMMAND_IDS);

    editor.setSelection(0, 5);
    await expect(commands.executeCommand(`${SAMPLE_PLUGIN_ID}:replace-selected`, {
      trigger: "api",
      editor: attachment.context,
    })).resolves.toMatchObject({ ok: true });
    expect(editor.getDocument()).toBe("Sample editor command world");

    editor.setDocument("before");
    editor.setSelection(0, editor.getDocument().length);
    const paste = clipboardEvent("paste", "sample:after");
    editorContainer.querySelector(".cm-content")!.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(editor.getDocument()).toBe("after");
    expect(plugin.pasteEvents).toBe(1);

    const ribbonAction = ribbon.querySelector<HTMLButtonElement>(
      `[data-ui-action-id='${SAMPLE_PLUGIN_ID}:sample-ribbon']`,
    );
    expect(ribbonAction?.textContent).toBe("Sample");
    expect(statusBar.querySelector(
      `[data-ui-action-id='${SAMPLE_PLUGIN_ID}:sample-status']`,
    )?.textContent).toBe("Status bar text");
    ribbonAction!.click();
    await Promise.resolve();
    expect(Array.from(document.querySelectorAll(".nexus-plugin-notice"))
      .map(({ textContent }) => textContent)).toContain("This is a notice!");

    const displayed = await ui.displaySettingTab(
      `${SAMPLE_PLUGIN_ID}:sample-settings`,
      windowContext,
    );
    expect(displayed.ok).toBe(true);
    if (!displayed.ok) return;
    expect(displayed.value.querySelector<HTMLInputElement>(
      "[data-setting-id='mySetting'] input",
    )?.value).toBe("loaded from storage");
    expect(displayed.value.querySelector<HTMLInputElement>(
      "[data-setting-id='enablePasteTransform'] input",
    )?.checked).toBe(true);

    await expect(commands.executeCommand(`${SAMPLE_PLUGIN_ID}:open-modal-simple`, {
      trigger: "api",
      editor: attachment.context,
    })).resolves.toMatchObject({ ok: true });
    expect(document.querySelector(".nexus-plugin-modal-content")?.textContent).toBe("Woah!");
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));
    await Promise.resolve();
    expect(document.querySelector(".nexus-plugin-modal")).toBeNull();

    await expect(commands.checkCommand(`${SAMPLE_PLUGIN_ID}:open-modal-complex`, {
      trigger: "api",
      editor: attachment.context,
    })).resolves.toEqual({ status: "available" });
    await expect(commands.executeCommand(`${SAMPLE_PLUGIN_ID}:open-modal-complex`, {
      trigger: "api",
      editor: attachment.context,
    })).resolves.toMatchObject({ ok: true });
    expect(document.querySelector(".nexus-plugin-modal-content")?.textContent).toBe("Woah!");

    const pasteCount = plugin.pasteEvents;
    const lifecycleAtUnload = [...plugin.lifecycleEvents, "unload"];
    await expect(controller.unload()).resolves.toMatchObject({
      state: "unloaded",
      clean: true,
    });
    expect(plugin.lifecycleEvents).toEqual(lifecycleAtUnload);
    expect(commands.listCommands()).toEqual([]);
    expect(ribbon.children).toHaveLength(0);
    expect(statusBar.children).toHaveLength(0);
    expect(document.querySelector(".nexus-plugin-setting-tab")).toBeNull();
    expect(document.querySelector(".nexus-plugin-modal")).toBeNull();
    expect(document.querySelector(".nexus-plugin-notice")).toBeNull();

    editor.setDocument("untouched");
    editor.setSelection(0, editor.getDocument().length);
    const pasteAfterUnload = clipboardEvent("paste", "sample:changed");
    editorContainer.querySelector(".cm-content")!.dispatchEvent(pasteAfterUnload);
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    vi.advanceTimersByTime(5 * 60 * 1_000);
    expect(plugin.pasteEvents).toBe(pasteCount);
    expect(editor.getDocument()).toBe("sample:changed");
    expect(document.querySelector(".nexus-plugin-notice")).toBeNull();
    expect(plugin.lifecycleEvents).toEqual(lifecycleAtUnload);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  it("opens and closes the namespaced view and observes Vault create/modify until unload", async () => {
    const harness = await createFullHarness();
    const {
      attachment,
      commands,
      controller,
      diagnostics,
      plugin,
      vault,
      workspace,
    } = harness;
    const driverVault = vault.createService(testOwner("sample-port-driver"), () => undefined);

    await expect(commands.executeCommand(`${SAMPLE_PLUGIN_ID}:open-sample-view`, {
      trigger: "api",
      editor: attachment.context,
    })).resolves.toMatchObject({ ok: true });
    expect(workspace.getLeavesOfType(SAMPLE_VIEW_TYPE)).toHaveLength(1);
    expect(document.querySelector(".nexus-sample-port-view")?.textContent)
      .toBe("Sample plugin view");
    expect(plugin.viewOpenEvents).toBe(1);

    const [firstLeaf] = workspace.getLeavesOfType(SAMPLE_VIEW_TYPE);
    await workspace.closeLeaf(firstLeaf!);
    expect(plugin.viewCloseEvents).toBe(1);
    expect(document.querySelector(".nexus-sample-port-view")).toBeNull();

    await commands.executeCommand(`${SAMPLE_PLUGIN_ID}:open-sample-view`, {
      trigger: "api",
      editor: attachment.context,
    });
    expect(plugin.viewOpenEvents).toBe(2);

    const created = await driverVault.create("sample-note.md" as VaultPath, "one");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const modified = await driverVault.modify(created.file, "two");
    expect(modified.ok).toBe(true);
    if (!modified.ok) return;
    expect(plugin.vaultEvents).toEqual([
      "create:sample-note.md",
      `modify:sample-note.md:${modified.version}`,
    ]);

    const vaultEventsAtUnload = [...plugin.vaultEvents];
    await controller.unload();
    expect(plugin.viewCloseEvents).toBe(2);
    expect(document.querySelector(".nexus-sample-port-view")).toBeNull();
    expect(document.querySelector(".nexus-missing-view")?.textContent)
      .toContain(SAMPLE_VIEW_TYPE);

    await driverVault.modify(created.file, "three");
    expect(plugin.vaultEvents).toEqual(vaultEventsAtUnload);
    expect(commands.listCommands()).toEqual([]);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  it("loads headlessly when UI, workspace, Vault and storage are absent", async () => {
    vi.useFakeTimers();
    const { commands, controller, diagnostics, plugin } = await createHeadlessHarness();

    expect(controller.state).toBe("loaded");
    expect(plugin.settings).toEqual({
      mySetting: "default",
      enablePasteTransform: true,
    });
    expect(commands.listCommands().map(({ id }) => id)).toEqual(COMMAND_IDS);
    expect(document.body.childElementCount).toBe(0);

    await expect(commands.executeCommand(`${SAMPLE_PLUGIN_ID}:open-modal-simple`, {
      trigger: "api",
      editor: null,
    })).resolves.toMatchObject({ ok: true });
    await expect(commands.executeCommand(`${SAMPLE_PLUGIN_ID}:open-sample-view`, {
      trigger: "api",
      editor: null,
    })).resolves.toMatchObject({ ok: true });
    await expect(commands.checkCommand(`${SAMPLE_PLUGIN_ID}:open-modal-complex`, {
      trigger: "api",
      editor: null,
    })).resolves.toEqual({ status: "unavailable" });

    await expect(controller.unload()).resolves.toMatchObject({
      state: "unloaded",
      clean: true,
    });
    const lifecycleAtUnload = [...plugin.lifecycleEvents];
    vi.advanceTimersByTime(5 * 60 * 1_000);
    expect(plugin.lifecycleEvents).toEqual(lifecycleAtUnload);
    expect(commands.listCommands()).toEqual([]);
    expect(document.body.childElementCount).toBe(0);
    expect(diagnostics.diagnostics).toEqual([]);
  });
});
