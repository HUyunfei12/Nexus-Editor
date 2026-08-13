import {
  NexusComponent,
  NexusPluginError,
  defineCapabilityToken,
  type AuthorPluginManifest,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import { RuntimeCapabilityRegistry } from "../src/capability";
import { ComponentLifecycleRuntime } from "../src/lifecycle/component-controller";
import { normalizeAuthorManifest } from "../src/manifest";

const source = { kind: "local-trusted" as const, locator: "plugin:test" };

function manifest(author: AuthorPluginManifest) {
  const result = normalizeAuthorManifest(author, { source });
  if (!result.ok) throw new Error("invalid test manifest");
  return result.manifest;
}

describe("runtime capability authorization", () => {
  it("creates owner-bound facades and stages their resources in the plugin lifecycle", async () => {
    const token = defineCapabilityToken<
      { add(label: string): void },
      "nexus.owner-bound-fixture",
      "1.0.0",
      "application"
    >({ id: "nexus.owner-bound-fixture", version: "1.0.0", scope: "application" });
    const calls: string[] = [];
    const owners: string[] = [];
    const host = new RuntimeCapabilityRegistry();
    host.registerOwnerBound(token, ({ owner, registerResource }) => {
      owners.push(`${owner.pluginId}:${owner.componentId}`);
      return {
        add(label) {
          registerResource({
            activate: () => { calls.push(`activate:${label}`); },
            quiesce: () => { calls.push(`quiesce:${label}`); },
            dispose: () => { calls.push(`dispose:${label}`); },
          });
        },
      };
    });
    const pluginManifest = manifest({
      id: "owner-bound-test",
      name: "Owner Bound Test",
      version: "1.0.0",
      entrypoint: "main.js",
      apiVersion: "^1.0.0",
    });
    const access = host.createPluginAccess(pluginManifest);
    const service = access.require(token);
    service.add("constructor");
    const component = new NexusComponent();
    const controller = new ComponentLifecycleRuntime().manage(component, pluginManifest.identity);
    access.bindOwner(component);
    service.add("before-load");

    expect(calls).toEqual([]);
    await controller.load();
    expect(calls).toEqual(["activate:constructor", "activate:before-load"]);
    expect(owners).toEqual(["owner-bound-test:owner-bound-test/root"]);

    await access.revokeCapability(token.id);
    expect(calls).toEqual([
      "activate:constructor",
      "activate:before-load",
      "quiesce:before-load",
      "quiesce:constructor",
      "dispose:before-load",
      "dispose:constructor",
    ]);
    expect(() => service.add("late")).toThrow(NexusPluginError);

    await controller.unload();
    expect(calls.filter((value) => value.startsWith("dispose:"))).toHaveLength(2);
  });

  it("distinguishes permission denial from an unsupported capability", () => {
    const token = defineCapabilityToken<{ write(value: string): void }, "nexus.vault", "1.1.0", "application">({
      id: "nexus.vault",
      version: "1.1.0",
      scope: "application",
    });
    const host = new RuntimeCapabilityRegistry();
    host.register(token, { write() {} }, { requiredPermissions: ["vault.write"] });

    const plugin = manifest({
      id: "permission-test",
      name: "Permission Test",
      version: "1.0.0",
      entrypoint: "main.js",
      apiVersion: "^1.0.0",
      permissions: [{ id: "vault.write", purpose: "Update notes", required: true }],
    });
    const access = host.createPluginAccess(plugin, { "vault.write": "denied" });

    const resolution = access.resolve(token, "^1.0.0");
    expect(resolution.status).toBe("permission-denied");
    if (resolution.status !== "permission-denied") return;
    expect(resolution.diagnostic.code).toBe("capability-permission-denied");
    expect(resolution.deniedPermissions).toEqual(["vault.write"]);
  });

  it("revokes issued proxies, cached methods, and owned resources without affecting other capabilities", async () => {
    const vaultToken = defineCapabilityToken<
      { read(): string; write(value: string): void },
      "nexus.vault",
      "1.1.0",
      "application"
    >({ id: "nexus.vault", version: "1.1.0", scope: "application" });
    const commandsToken = defineCapabilityToken<
      { list(): readonly string[] },
      "nexus.commands",
      "1.0.0",
      "application"
    >({ id: "nexus.commands", version: "1.0.0", scope: "application" });
    const onHandleRevoked = vi.fn(async () => {});
    const host = new RuntimeCapabilityRegistry();
    host.register(
      vaultToken,
      { read: () => "contents", write() {} },
      { requiredPermissions: ["vault.write"], onHandleRevoked },
    );
    host.register(commandsToken, { list: () => ["one"] });

    const plugin = manifest({
      id: "revocation-test",
      name: "Revocation Test",
      version: "1.0.0",
      entrypoint: "main.js",
      apiVersion: "^1.0.0",
      permissions: [{ id: "vault.write", purpose: "Update notes" }],
    });
    const access = host.createPluginAccess(plugin, { "vault.write": "granted" });
    const vault = access.require(vaultToken, "^1.0.0");
    const cachedWrite = vault.write;
    const commands = access.require(commandsToken, "^1.0.0");
    const resolution = access.resolve(vaultToken, "^1.0.0");
    if (resolution.status !== "available") throw new Error("expected capability");
    const onRevoked = vi.fn();
    resolution.handle.onRevoked(onRevoked);

    expect(vault.read()).toBe("contents");
    await access.revokePermission("vault.write");

    expect(() => vault.read()).toThrow(NexusPluginError);
    expect(() => cachedWrite("next")).toThrowError(
      expect.objectContaining({ diagnostic: expect.objectContaining({ code: "permission-revoked" }) }),
    );
    expect(commands.list()).toEqual(["one"]);
    expect(onRevoked).toHaveBeenCalledOnce();
    expect(onHandleRevoked).toHaveBeenCalledOnce();
  });

  it("wraps frozen owner-bound services without violating Proxy invariants", async () => {
    const token = defineCapabilityToken<
      { readonly label: string; ping(): string },
      "nexus.frozen-owner-bound",
      "1.0.0",
      "application"
    >({
      id: "nexus.frozen-owner-bound",
      version: "1.0.0",
      scope: "application",
    });
    const host = new RuntimeCapabilityRegistry();
    host.registerOwnerBound(token, () => Object.freeze({
      label: "frozen",
      ping: () => "pong",
    }));
    const plugin = manifest({
      id: "frozen-owner-bound-test",
      name: "Frozen Owner Bound Test",
      version: "1.0.0",
      entrypoint: "main.js",
      apiVersion: "^1.0.0",
    });
    const access = host.createPluginAccess(plugin);
    const service = access.require(token);

    expect(service.label).toBe("frozen");
    expect(service.ping()).toBe("pong");
    expect(Object.keys(service)).toEqual(["label", "ping"]);
    const cachedPing = service.ping;

    await access.revokeCapability(token.id);

    expect(() => service.label).toThrow(NexusPluginError);
    expect(() => service.ping()).toThrow(NexusPluginError);
    expect(() => cachedPing()).toThrow(NexusPluginError);
  });

  it("revokes all issued handles when the host capability is withdrawn", async () => {
    const token = defineCapabilityToken<{ ping(): string }, "nexus.network", "2.0.0", "application">({
      id: "nexus.network",
      version: "2.0.0",
      scope: "application",
    });
    const host = new RuntimeCapabilityRegistry();
    const registration = host.register(token, { ping: () => "pong" });
    const plugin = manifest({
      id: "provider-revoke",
      name: "Provider Revoke",
      version: "1.0.0",
      entrypoint: "main.js",
      apiVersion: "^1.0.0",
    });
    const access = host.createPluginAccess(plugin);
    const network = access.require(token);

    await registration.revoke();

    expect(() => network.ping()).toThrowError(
      expect.objectContaining({ diagnostic: expect.objectContaining({ code: "permission-revoked" }) }),
    );
    expect(access.resolve(token).status).toBe("unsupported");
  });
});
