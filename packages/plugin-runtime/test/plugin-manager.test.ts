import {
  NexusPluginBase,
  defineCapabilityToken,
  type AuthorPluginManifest,
  type NexusApp,
  type NexusDiagnostic,
  type NexusPluginConstructor,
  type NormalizedPluginManifest,
  type PluginIdentity,
  type PluginPlatform,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import { RuntimeCapabilityRegistry } from "../src/capability";
import { PluginCompatibilityValidator } from "../src/compatibility";
import { DiagnosticBus } from "../src/diagnostics";
import {
  HostControlledPluginEntrypointLoader,
  TrustedPluginPackageLoader,
  type LoadedTrustedPlugin,
  type TrustedPluginLoadResult,
  type TrustedPluginPackageCandidate,
} from "../src/loader";
import { normalizeAuthorManifest, PluginIdentityRegistry } from "../src/manifest";
import { PluginManager, type PluginPackageLoader } from "../src/plugin-manager";

const manifest: AuthorPluginManifest = {
  id: "manager-fixture",
  name: "Manager Fixture",
  version: "1.0.0",
  entrypoint: "main.js",
  apiVersion: "^1.0.0",
};

function candidate(overrides: Partial<AuthorPluginManifest> = {}): TrustedPluginPackageCandidate {
  const authorManifest = { ...manifest, ...overrides };
  return {
    authorManifest,
    host: {
      source: { kind: "development", locator: `fixture:${authorManifest.id}` },
    },
  };
}

function createTrustedLoader(
  plugins: Readonly<Record<string, NexusPluginConstructor>>,
  options: { readonly apiVersion?: string; readonly platform?: PluginPlatform } = {},
) {
  const resolver = {
    loadEntrypoint: vi.fn(async (request: { readonly manifest: NormalizedPluginManifest }) => ({
      default: plugins[request.manifest.identity.id],
    })),
  };
  const validator = new PluginCompatibilityValidator({
    hostId: "test-host",
    hostVersion: "5.0.0",
    apiVersion: options.apiVersion ?? "1.5.0",
    platform: options.platform ?? "headless",
    capabilities: new RuntimeCapabilityRegistry(),
  });
  return {
    resolver,
    loader: new TrustedPluginPackageLoader({
      validator,
      entrypoints: new HostControlledPluginEntrypointLoader(resolver),
    }),
  };
}

function createManager(loader: PluginPackageLoader, diagnostics = new DiagnosticBus()) {
  return new PluginManager({
    host: { id: "test-host", name: "Test Host", version: "5.0.0", platform: "headless" },
    apiVersion: "1.5.0",
    loader,
    diagnostics,
  });
}

function normalizeForTest(input: TrustedPluginPackageCandidate): NormalizedPluginManifest {
  const result = normalizeAuthorManifest(input.authorManifest, input.host);
  if (!result.ok) throw new Error("Fixture manifest did not normalize.");
  return result.manifest;
}

function loadedResult(
  input: TrustedPluginPackageCandidate,
  Plugin: NexusPluginConstructor,
  releases: {
    readonly capabilityAccess?: () => void | Promise<void>;
    readonly identityReservation?: () => void;
  } = {},
): LoadedTrustedPlugin {
  const normalized = normalizeForTest(input);
  const identities = new PluginIdentityRegistry();
  const reservation = identities.reserve(normalized);
  if (!reservation.ok) throw new Error("Fixture identity reservation failed.");
  return {
    ok: true,
    manifest: normalized,
    Plugin,
    capabilityAccess: {
      has: () => false,
      resolve: () => {
        throw new Error("not used");
      },
      get: () => undefined,
      require: () => {
        throw new Error("not used");
      },
      list: () => [],
      dispose: async () => releases.capabilityAccess?.(),
    } as unknown as LoadedTrustedPlugin["capabilityAccess"],
    identityReservation: {
      ...reservation.reservation,
      release: () => {
        releases.identityReservation?.();
        reservation.reservation.release();
      },
    },
    diagnostics: [],
  };
}

describe("PluginManager", () => {
  it("discovers without executing an entrypoint and rejects duplicate normalized ids", () => {
    class Plugin extends NexusPluginBase {}
    const { loader, resolver } = createTrustedLoader({ "manager-fixture": Plugin });
    const manager = createManager(loader);

    const discovered = manager.discover(candidate());
    expect(discovered).toMatchObject({ ok: true, plugin: { state: "discovered" } });
    expect(resolver.loadEntrypoint).not.toHaveBeenCalled();
    const duplicate = manager.discover(candidate({ id: " MANAGER-FIXTURE " }));
    expect(duplicate).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "plugin-id-conflict" })],
    });
    expect(manager.list()).toHaveLength(1);
  });

  it("rejects incompatible plugins before entry execution and isolates other plugins", async () => {
    class Healthy extends NexusPluginBase {}
    const { loader, resolver } = createTrustedLoader({ "healthy-plugin": Healthy });
    const manager = createManager(loader);
    manager.discover(candidate({ id: "incompatible-plugin", apiVersion: "^9.0.0" }));
    manager.discover(candidate({ id: "healthy-plugin" }));

    const results = await manager.enableAll();
    expect(results[0]).toMatchObject({ ok: false, state: "incompatible" });
    expect(results[1]).toMatchObject({ ok: true, state: "enabled" });
    expect(resolver.loadEntrypoint).toHaveBeenCalledTimes(1);
    expect(manager.get("incompatible-plugin")?.instance).toBeNull();
  });

  it("exposes only the NexusApp facade and diagnoses internal host capabilities as unsupported", async () => {
    const internalTokens = [
      defineCapabilityToken<object, "nexus.electron-ipc-renderer", "1.0.0", "application">({
        id: "nexus.electron-ipc-renderer",
        version: "1.0.0",
        scope: "application",
      }),
      defineCapabilityToken<object, "nexus.node-fs", "1.0.0", "application">({
        id: "nexus.node-fs",
        version: "1.0.0",
        scope: "application",
      }),
      defineCapabilityToken<object, "nexus.internal-manager", "1.0.0", "application">({
        id: "nexus.internal-manager",
        version: "1.0.0",
        scope: "application",
      }),
    ] as const;
    let appKeys: string[] = [];
    let leakedProperties: boolean[] = [];
    let resolutions: ReturnType<NexusApp["capabilities"]["resolve"]>[] = [];
    class Plugin extends NexusPluginBase {
      override onload(): void {
        const app = this.app as NexusApp & Record<string, unknown>;
        appKeys = Object.keys(app).sort();
        leakedProperties = ["ipcRenderer", "fs", "manager"].map((key) => key in app);
        resolutions = internalTokens.map((token) => this.app.capabilities.resolve(token));
      }
    }
    const { loader } = createTrustedLoader({ "manager-fixture": Plugin });
    const manager = createManager(loader);
    manager.discover(candidate());

    await expect(manager.enable("manager-fixture")).resolves.toMatchObject({ ok: true });
    expect(appKeys).toEqual(["apiVersion", "capabilities", "diagnostics", "host"]);
    expect(leakedProperties).toEqual([false, false, false]);
    expect(resolutions).toEqual(internalTokens.map((token) => expect.objectContaining({
      status: "unsupported",
      requestedId: token.id,
      diagnostic: expect.objectContaining({ code: "capability-unsupported" }),
    })));
  });

  it("does not expose a plugin until staged resources activate", async () => {
    let manager!: PluginManager;
    const observations: Array<boolean | string> = [];
    class Plugin extends NexusPluginBase {
      override onload() {
        this.register({
          activate: () => {
            observations.push(manager.getEnabled(this.identity.id) !== undefined);
          },
          dispose: () => undefined,
        });
      }
    }
    const { loader } = createTrustedLoader({ "manager-fixture": Plugin });
    manager = createManager(loader);
    manager.discover(candidate());

    const result = await manager.enable("manager-fixture");
    observations.push(manager.get("manager-fixture")?.state ?? "missing");

    expect(result.ok).toBe(true);
    expect(observations).toEqual([false, "enabled"]);
  });

  it("serializes disable requested during loading", async () => {
    let finishLoad!: () => void;
    class Plugin extends NexusPluginBase {
      static unloadCalls = 0;
      override onload() {
        return new Promise<void>((resolve) => {
          finishLoad = resolve;
        });
      }
      override onunload() {
        Plugin.unloadCalls += 1;
      }
    }
    const { loader } = createTrustedLoader({ "manager-fixture": Plugin });
    const manager = createManager(loader);
    manager.discover(candidate());
    const enabling = manager.enable("manager-fixture");
    await vi.waitFor(() => expect(manager.get("manager-fixture")?.state).toBe("loading"));

    const disabling = manager.disable("manager-fixture");
    finishLoad();
    await enabling;
    const result = await disabling;

    expect(result).toMatchObject({ state: "disabled", clean: true });
    expect(Plugin.unloadCalls).toBe(1);
    expect(manager.get("manager-fixture")).toMatchObject({ state: "disabled", instance: null });
  });

  it("shares repeated disable results and creates a new instance on re-enable", async () => {
    const instances: Plugin[] = [];
    class Plugin extends NexusPluginBase {
      constructor(app: NexusApp, pluginManifest: NormalizedPluginManifest) {
        super(app, pluginManifest);
        instances.push(this);
      }
    }
    const { loader } = createTrustedLoader({ "manager-fixture": Plugin });
    const manager = createManager(loader);
    manager.discover(candidate());
    await manager.enable("manager-fixture");

    const first = manager.disable("manager-fixture");
    const second = manager.disable("manager-fixture");
    expect(first).toBe(second);
    const firstResult = await first;
    expect(await manager.disable("manager-fixture")).toBe(firstResult);

    await manager.enable("manager-fixture");
    expect(instances).toHaveLength(2);
    expect(instances[1]).not.toBe(instances[0]);
  });

  it("releases capability access and identity reservation on normal disable", async () => {
    const capabilityAccess = vi.fn();
    const identityReservation = vi.fn();
    class Plugin extends NexusPluginBase {}
    const fixture = candidate();
    const loader: PluginPackageLoader = {
      load: vi.fn(async () => loadedResult(fixture, Plugin, { capabilityAccess, identityReservation })),
    };
    const manager = createManager(loader);
    manager.discover(fixture);
    await manager.enable("manager-fixture");

    const result = await manager.disable("manager-fixture");

    expect(result).toMatchObject({ state: "disabled", clean: true });
    expect(capabilityAccess).toHaveBeenCalledTimes(1);
    expect(identityReservation).toHaveBeenCalledTimes(1);
  });

  it("releases loader-owned handles after load failure without calling onunload", async () => {
    const capabilityAccess = vi.fn();
    const identityReservation = vi.fn();
    class Failing extends NexusPluginBase {
      static unloadCalls = 0;
      override onload() {
        throw new Error("load failed");
      }
      override onunload() {
        Failing.unloadCalls += 1;
      }
    }
    const fixture = candidate();
    const loader: PluginPackageLoader = {
      load: vi.fn(async () => loadedResult(fixture, Failing, { capabilityAccess, identityReservation })),
    };
    const manager = createManager(loader);
    manager.discover(fixture);

    const result = await manager.enable("manager-fixture");
    expect(result).toMatchObject({ ok: false, state: "failed" });
    expect(Failing.unloadCalls).toBe(0);
    expect(capabilityAccess).toHaveBeenCalledTimes(1);
    expect(identityReservation).toHaveBeenCalledTimes(1);
    expect(manager.get("manager-fixture")?.instance).toBeNull();
  });

  it("isolates enableAll failures and reports sanitized diagnostics", async () => {
    const diagnostics = new DiagnosticBus({ sensitiveValues: ["manager-secret"] });
    class Healthy extends NexusPluginBase {}
    const healthyCandidate = candidate({ id: "healthy-plugin" });
    const brokenCandidate = candidate({ id: "broken-plugin" });
    const loader: PluginPackageLoader = {
      load: vi.fn(async (input): Promise<TrustedPluginLoadResult> => {
        const id = (input.authorManifest as AuthorPluginManifest).id;
        if (id === "broken-plugin") throw new Error("Bearer manager-secret at /Users/alice/vault");
        return loadedResult(healthyCandidate, Healthy);
      }),
    };
    const manager = createManager(loader, diagnostics);
    manager.discover(brokenCandidate);
    manager.discover(healthyCandidate);

    const results = await manager.enableAll();
    expect(results.map((result) => result.ok)).toEqual([false, true]);
    const serialized = JSON.stringify(diagnostics.diagnostics);
    expect(serialized).not.toContain("manager-secret");
    expect(serialized).not.toContain("/Users/alice/vault");
    expect(diagnostics.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "plugin-load-failed",
          plugin: expect.objectContaining({ id: "broken-plugin" }),
        }),
      ]),
    );
  });
});
