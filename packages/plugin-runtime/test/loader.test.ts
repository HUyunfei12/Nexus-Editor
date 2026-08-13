import {
  NexusPluginBase,
  defineCapabilityToken,
  type AuthorPluginManifest,
  type PluginPlatform,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import { RuntimeCapabilityRegistry } from "../src/capability";
import { PluginCompatibilityValidator } from "../src/compatibility";
import {
  HostControlledPluginEntrypointLoader,
  TrustedPluginPackageLoader,
} from "../src/loader";

const compatibleManifest: AuthorPluginManifest = {
  id: "compatible-plugin",
  name: "Compatible Plugin",
  version: "1.0.0",
  entrypoint: "main.js",
  apiVersion: "^1.0.0",
};

class CompatiblePlugin extends NexusPluginBase {}

function createLoader(options: {
  loadEntrypoint: (request: unknown) => Promise<unknown>;
  capabilities?: RuntimeCapabilityRegistry;
  permissionDecisions?: Readonly<Record<string, "granted" | "denied">>;
  hostVersion?: string;
  apiVersion?: string;
  platform?: PluginPlatform;
}) {
  const validator = new PluginCompatibilityValidator({
    hostId: "test-host",
    hostVersion: options.hostVersion ?? "3.4.0",
    apiVersion: options.apiVersion ?? "1.5.0",
    platform: options.platform ?? "desktop",
    capabilities: options.capabilities ?? new RuntimeCapabilityRegistry(),
    permissionDecisions: () => options.permissionDecisions ?? {},
  });
  const resolver = { loadEntrypoint: vi.fn(options.loadEntrypoint) };
  const entrypoints = new HostControlledPluginEntrypointLoader(resolver);
  return {
    resolver,
    loader: new TrustedPluginPackageLoader({ validator, entrypoints }),
  };
}

function candidate(authorManifest: unknown) {
  return {
    authorManifest,
    host: {
      source: { kind: "local-trusted" as const, locator: `fixture:${String((authorManifest as { id?: unknown }).id)}` },
      installLocation: { scheme: "host" as const, locator: "fixture-install" },
    },
  };
}

describe("trusted plugin package loading", () => {
  it("rejects API-incompatible plugins before invoking the host entrypoint resolver", async () => {
    const { loader, resolver } = createLoader({
      loadEntrypoint: async () => ({ default: CompatiblePlugin }),
    });

    const result = await loader.load(candidate({ ...compatibleManifest, apiVersion: "^2.0.0" }));

    expect(result.ok).toBe(false);
    expect(resolver.loadEntrypoint).not.toHaveBeenCalled();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "api-version-mismatch" })]),
    );
  });

  it("rejects a missing required capability before entry execution but records optional degradation", async () => {
    const commands = defineCapabilityToken<object, "nexus.commands", "1.0.0", "application">({
      id: "nexus.commands",
      version: "1.0.0",
      scope: "application",
    });
    const capabilities = new RuntimeCapabilityRegistry();
    capabilities.register(commands, {});
    const { loader, resolver } = createLoader({
      capabilities,
      loadEntrypoint: async () => ({ default: CompatiblePlugin }),
    });

    const requiredResult = await loader.load(candidate({
      ...compatibleManifest,
      id: "missing-required",
      requiredCapabilities: [{ id: "nexus.workspace", version: "^1.0.0" }],
    }));
    expect(requiredResult.ok).toBe(false);
    expect(resolver.loadEntrypoint).not.toHaveBeenCalled();

    const optionalResult = await loader.load(candidate({
      ...compatibleManifest,
      id: "missing-optional",
      requiredCapabilities: [{ id: "nexus.commands", version: "^1.0.0" }],
      optionalCapabilities: [{ id: "nexus.ui", version: "^1.0.0" }],
    }));
    expect(optionalResult.ok).toBe(true);
    expect(resolver.loadEntrypoint).toHaveBeenCalledOnce();
    if (!optionalResult.ok) return;
    expect(optionalResult.manifest.host.resolvedCapabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "nexus.ui", required: false, resolution: expect.objectContaining({ status: "unsupported" }) }),
      ]),
    );
  });

  it("keeps host/API compatibility independent from platform and capability preflight", async () => {
    const workspace = defineCapabilityToken<object, "nexus.workspace-fixture", "1.0.0", "application">({
      id: "nexus.workspace-fixture",
      version: "1.0.0",
      scope: "application",
    });
    const capabilities = new RuntimeCapabilityRegistry();
    capabilities.register(workspace, {});
    const upgraded = createLoader({
      hostVersion: "9.0.0",
      apiVersion: "1.5.0",
      platform: "desktop",
      capabilities,
      loadEntrypoint: async () => ({ default: CompatiblePlugin }),
    });
    const authorManifest = {
      ...compatibleManifest,
      id: "host-upgrade-compatible",
      hostVersion: ">=3.0.0",
      platforms: ["desktop"],
      requiredCapabilities: [{ id: workspace.id, version: "^1.0.0" }],
    } satisfies AuthorPluginManifest;

    const compatible = await upgraded.loader.load(candidate(authorManifest));
    expect(compatible.ok).toBe(true);
    expect(upgraded.resolver.loadEntrypoint).toHaveBeenCalledOnce();

    const wrongPlatform = createLoader({
      hostVersion: "9.0.0",
      platform: "headless",
      capabilities,
      loadEntrypoint: async () => ({ default: CompatiblePlugin }),
    });
    const platformResult = await wrongPlatform.loader.load(candidate(authorManifest));
    expect(platformResult.ok).toBe(false);
    expect(platformResult.diagnostics.map((item) => item.code)).toContain("platform-unsupported");
    expect(platformResult.diagnostics.map((item) => item.code)).not.toContain("capability-unsupported");
    expect(wrongPlatform.resolver.loadEntrypoint).not.toHaveBeenCalled();

    const missingCapability = createLoader({
      hostVersion: "9.0.0",
      platform: "desktop",
      loadEntrypoint: async () => ({ default: CompatiblePlugin }),
    });
    const capabilityResult = await missingCapability.loader.load(candidate(authorManifest));
    expect(capabilityResult.ok).toBe(false);
    expect(capabilityResult.diagnostics.map((item) => item.code)).toContain("capability-unsupported");
    expect(capabilityResult.diagnostics.map((item) => item.code)).not.toContain("platform-unsupported");
    expect(missingCapability.resolver.loadEntrypoint).not.toHaveBeenCalled();
  });

  it("accepts only a default Nexus plugin constructor", async () => {
    const invalid = createLoader({ loadEntrypoint: async () => ({ default: () => ({}) }) });
    const invalidResult = await invalid.loader.load(candidate(compatibleManifest));
    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "plugin-entrypoint-invalid" })]),
    );

    const valid = createLoader({ loadEntrypoint: async () => ({ default: CompatiblePlugin }) });
    const validResult = await valid.loader.load(candidate({ ...compatibleManifest, id: "valid-entrypoint" }));
    expect(validResult.ok).toBe(true);
    if (!validResult.ok) return;
    expect(validResult.Plugin).toBe(CompatiblePlugin);
  });

  it("isolates resolver failures so another plugin can still load", async () => {
    const { loader } = createLoader({
      loadEntrypoint: async (request) => {
        const manifest = (request as { manifest: { identity: { id: string } } }).manifest;
        if (manifest.identity.id === "broken-plugin") throw new Error("private host path /secret/plugin.js");
        return { default: CompatiblePlugin };
      },
    });

    const results = await loader.loadMany([
      candidate({ ...compatibleManifest, id: "broken-plugin" }),
      candidate({ ...compatibleManifest, id: "healthy-plugin" }),
    ]);

    expect(results[0].ok).toBe(false);
    expect(results[0].diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "plugin-entrypoint-load-failed",
          cause: { name: "Error", message: "Plugin entrypoint loading failed." },
        }),
      ]),
    );
    expect(results[1].ok).toBe(true);
  });

  it("emits stable diagnostics for unknown, deprecated, and unsupported API declarations", async () => {
    const validator = new PluginCompatibilityValidator({
      hostId: "test-host",
      hostVersion: "3.4.0",
      apiVersion: "1.5.0",
      platform: "desktop",
      capabilities: new RuntimeCapabilityRegistry(),
      apiPolicies: {
        "legacy.events": { status: "deprecated", replacement: "nexus.events", removedIn: "2.0.0" },
        "obsidian.window-app": { status: "unsupported" },
      },
    });
    const resolver = { loadEntrypoint: vi.fn(async () => ({ default: CompatiblePlugin })) };
    const loader = new TrustedPluginPackageLoader({
      validator,
      entrypoints: new HostControlledPluginEntrypointLoader(resolver),
    });

    const result = await loader.load(candidate({
      ...compatibleManifest,
      experimentalFutureField: true,
      deprecatedApis: [
        { id: "legacy.events", replacement: "nexus.events" },
        { id: "obsidian.window-app" },
      ],
    }));

    expect(result.ok).toBe(false);
    expect(resolver.loadEntrypoint).not.toHaveBeenCalled();
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["manifest-unknown-field", "api-deprecated", "api-unsupported"]),
    );
  });
});
