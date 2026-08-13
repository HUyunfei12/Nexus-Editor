import { describe, expect, it, vi } from "vitest";
import * as pluginApi from "../src/index";
import {
  NexusComponent,
  NexusPluginBase,
  NexusPluginError,
  bindComponentRuntime,
  defineCapabilityToken,
  type NexusComponentRuntimeBridge,
  type NexusApp,
  type NormalizedPluginManifest,
  type Registration,
  type ResourceOwner,
} from "../src/index";

function makeRegistration(owner: ResourceOwner): Registration {
  let disposed = false;
  return {
    id: "registration-1" as Registration["id"],
    owner,
    state: "active",
    get disposed() {
      return disposed;
    },
    async dispose() {
      disposed = true;
    },
  };
}

describe("public plugin API", () => {
  it("keeps the runtime export surface intentional", () => {
    expect(Object.keys(pluginApi).sort()).toMatchInlineSnapshot(`
      [
        "COMMANDS_CAPABILITY",
        "EDITOR_CLIPBOARD_CAPABILITY",
        "EDITOR_HOST_CAPABILITY",
        "EDITOR_TRANSACTIONS_CAPABILITY",
        "FILE_MANAGER_CAPABILITY",
        "HOTKEYS_CAPABILITY",
        "MARKDOWN_PROCESSORS_CAPABILITY",
        "MAX_PLUGIN_PRIORITY",
        "METADATA_CAPABILITY",
        "MIN_PLUGIN_PRIORITY",
        "NexusComponent",
        "NexusPluginBase",
        "NexusPluginError",
        "PLUGIN_PRIORITY",
        "PLUGIN_STORAGE_CAPABILITY",
        "RESOURCES_CAPABILITY",
        "SCOPES_CAPABILITY",
        "SECRETS_CAPABILITY",
        "UI_CAPABILITY",
        "VAULT_CAPABILITY",
        "WORKSPACE_CAPABILITY",
        "bindComponentRuntime",
        "defineCapabilityToken",
        "getComponentRuntimeBridge",
        "invokeComponentOnload",
        "invokeComponentOnunload",
      ]
    `);
  });

  it("creates frozen, typed capability tokens and rejects unstable ids", () => {
    const token = defineCapabilityToken<{ ping(): string }, "nexus.example", "1.2.0", "application">({
      id: "nexus.example",
      version: "1.2.0",
      scope: "application",
    });

    expect(token).toEqual({ id: "nexus.example", version: "1.2.0", scope: "application" });
    expect(Object.isFrozen(token)).toBe(true);
    expect(() =>
      defineCapabilityToken({ id: "Example Service", version: "1.0.0", scope: "application" }),
    ).toThrow(TypeError);
    expect(() =>
      defineCapabilityToken({ id: "nexus.example", version: "latest", scope: "application" }),
    ).toThrow(TypeError);
  });

  it("delegates component ownership to a one-time runtime bridge", async () => {
    const component = new NexusComponent();
    const child = new NexusComponent();
    const owner: ResourceOwner = {
      pluginId: "sample-plugin" as ResourceOwner["pluginId"],
      componentId: "component-1" as ResourceOwner["componentId"],
    };
    const addChild = vi.fn(async () => undefined);
    const bridge: NexusComponentRuntimeBridge = {
      owner,
      state: "loaded",
      addChild,
      removeChild: vi.fn(async () => undefined),
      register: () => makeRegistration(owner),
      registerEvent: (subscription) => subscription,
      registerDomEvent: () => makeRegistration(owner),
      registerInterval: () => makeRegistration(owner),
      registerTimeout: () => makeRegistration(owner),
    };

    expect(component.lifecycleState).toBe("constructed");
    expect(() => component.register(() => undefined)).toThrow(NexusPluginError);

    bindComponentRuntime(component, bridge);
    expect(component.lifecycleState).toBe("loaded");
    expect(component.owner).toBe(owner);
    await expect(component.addChild(child)).resolves.toBe(child);
    expect(addChild).toHaveBeenCalledWith(child);
    expect(() => bindComponentRuntime(component, bridge)).toThrow(NexusPluginError);
  });

  it("exposes the injected app, manifest, and immutable identity reference", () => {
    const app = {
      host: { id: "test", name: "Test", version: "1.0.0", platform: "headless" },
      apiVersion: "1.0.0",
      capabilities: {},
      diagnostics: {},
    } as NexusApp;
    const identity = {
      id: "sample-plugin",
      name: "Sample",
      version: "1.0.0",
      source: { kind: "development", locator: "fixture:sample" },
    } as NormalizedPluginManifest["identity"];
    const manifest = {
      identity,
    } as NormalizedPluginManifest;

    class SamplePlugin extends NexusPluginBase {}
    const plugin = new SamplePlugin(app, manifest);

    expect(plugin.app).toBe(app);
    expect(plugin.manifest).toBe(manifest);
    expect(plugin.identity).toBe(identity);
    expect(Object.getOwnPropertyDescriptor(plugin, "app")?.writable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(plugin, "manifest")?.writable).toBe(false);
    expect(Object.getOwnPropertyDescriptor(plugin, "identity")?.writable).toBe(false);
  });
});
