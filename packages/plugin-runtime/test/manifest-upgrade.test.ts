import {
  defineCapabilityToken,
  type AuthorPluginManifest,
  type ComponentId,
  type PluginId,
  type ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it } from "vitest";

import { RuntimeCapabilityRegistry } from "../src/capability";
import { CommandRegistry } from "../src/commands/command-registry";
import { HotkeyRegistry, MemoryHotkeyPreferenceStore } from "../src/commands/hotkey-registry";
import { normalizeAuthorManifest } from "../src/manifest";
import {
  MemoryPluginStorageBackend,
  PluginStorageRuntime,
} from "../src/storage";

const source = { kind: "local-trusted" as const, locator: "plugin:stable-upgrade" };

function normalize(name: string) {
  const author: AuthorPluginManifest = {
    id: "stable-upgrade",
    name,
    version: name === "Original Name" ? "1.0.0" : "2.0.0",
    entrypoint: "main.js",
    apiVersion: "^1.0.0",
    permissions: [{ id: "workspace.read", purpose: "Read workspace context" }],
  };
  const result = normalizeAuthorManifest(author, { source });
  if (!result.ok) throw new Error("Upgrade fixture manifest did not normalize");
  return result.manifest;
}

function owner(pluginId: PluginId): ResourceOwner {
  return { pluginId, componentId: `${pluginId}/root` as ComponentId };
}

describe("stable plugin identity upgrades", () => {
  it("keeps hotkeys, storage and permission decisions by ID while exposing the new display name", async () => {
    const original = normalize("Original Name");
    const upgraded = normalize("Renamed Plugin");
    expect(upgraded.identity.id).toBe(original.identity.id);
    expect(upgraded.identity.name).toBe("Renamed Plugin");

    const preferences = new MemoryHotkeyPreferenceStore();
    const originalCommands = new CommandRegistry();
    const originalResources: Array<{ activate?(): void | Promise<void>; dispose(): void | Promise<void> }> = [];
    const originalCommandService = originalCommands.createService(owner(original.identity.id), (resource) => {
      originalResources.push(resource);
    });
    const originalRegistration = originalCommandService.registerCommand({
      id: "inspect",
      name: "Inspect",
      callback: () => undefined,
    });
    expect(originalRegistration.ok).toBe(true);
    for (const resource of originalResources) await resource.activate?.();
    const originalHotkeys = new HotkeyRegistry(originalCommands, { platform: "linux", preferences });
    await originalHotkeys.setPreference("stable-upgrade:inspect", {
      mode: "custom",
      bindings: [{ key: "I", modifiers: ["Ctrl", "Shift"] }],
    });
    for (const resource of [...originalResources].reverse()) await resource.dispose();

    const upgradedCommands = new CommandRegistry();
    const upgradedResources: typeof originalResources = [];
    const upgradedCommandService = upgradedCommands.createService(owner(upgraded.identity.id), (resource) => {
      upgradedResources.push(resource);
    });
    expect(upgradedCommandService.registerCommand({
      id: "inspect",
      name: `${upgraded.identity.name}: Inspect`,
      callback: () => undefined,
    }).ok).toBe(true);
    for (const resource of upgradedResources) await resource.activate?.();
    const upgradedHotkeys = new HotkeyRegistry(upgradedCommands, { platform: "linux", preferences });
    expect(upgradedHotkeys.getBindings("stable-upgrade:inspect")).toEqual([
      { key: "i", modifiers: ["Ctrl", "Shift"] },
    ]);
    expect(upgradedCommands.getCommand("stable-upgrade:inspect")?.name).toBe("Renamed Plugin: Inspect");

    const backend = new MemoryPluginStorageBackend();
    const originalStorage = new PluginStorageRuntime({ backend });
    await originalStorage.createService(owner(original.identity.id), () => undefined)
      .saveData({ enabled: true });
    await originalStorage.dispose();
    const upgradedStorage = new PluginStorageRuntime({ backend });
    await expect(upgradedStorage.createService(owner(upgraded.identity.id), () => undefined).loadData())
      .resolves.toMatchObject({ data: { enabled: true } });

    const protectedCapability = defineCapabilityToken<object, "nexus.upgrade-permission", "1.0.0", "application">({
      id: "nexus.upgrade-permission",
      version: "1.0.0",
      scope: "application",
    });
    const capabilities = new RuntimeCapabilityRegistry();
    capabilities.register(protectedCapability, {}, { requiredPermissions: ["workspace.read"] });
    const decisions = new Map<PluginId, Readonly<Record<string, "granted">>>([
      [original.identity.id, { "workspace.read": "granted" }],
    ]);
    const access = capabilities.createPluginAccess(upgraded, decisions.get(upgraded.identity.id));
    expect(access.resolve(protectedCapability)).toMatchObject({ status: "available" });

    await access.dispose();
    await upgradedStorage.dispose();
    for (const resource of [...upgradedResources].reverse()) await resource.dispose();
  });
});
