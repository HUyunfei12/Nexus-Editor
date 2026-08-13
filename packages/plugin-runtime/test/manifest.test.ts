import { describe, expect, it } from "vitest";

import {
  PluginIdentityRegistry,
  normalizeAuthorManifest,
  normalizePluginId,
} from "../src/manifest";

const source = {
  kind: "local-trusted" as const,
  locator: "plugins/sample-plugin",
};

describe("plugin manifest normalization", () => {
  it("separates author fields from immutable host metadata", () => {
    const input = {
      id: "  Sample-Plugin  ",
      name: " Sample Plugin ",
      version: "1.2.3",
      entrypoint: "src//main.js",
      apiVersion: "^1.0.0",
      requiredCapabilities: [{ id: "nexus.commands", version: "^1.0.0" }],
      extensions: { sample: { enabled: true } },
      futureFlag: { mode: "strict" },
      host: { source: { locator: "forged" } },
    };

    const result = normalizeAuthorManifest(input, {
      source,
      installLocation: { scheme: "host", locator: "install:sample-plugin" },
      digest: { algorithm: "sha256", value: "abc123" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.manifest.identity.id).toBe("sample-plugin");
    expect(result.manifest.identity.name).toBe("Sample Plugin");
    expect(result.manifest.entrypoint).toBe("./src/main.js");
    expect(result.manifest.host.source).toEqual(source);
    expect(result.manifest.host.installLocation?.locator).toBe("install:sample-plugin");
    expect(result.manifest.unknownFields).toEqual({
      futureFlag: { mode: "strict" },
      host: { source: { locator: "forged" } },
    });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "manifest-unknown-field",
      "manifest-unknown-field",
    ]);

    input.extensions.sample.enabled = false;
    input.futureFlag.mode = "changed";
    expect(result.manifest.extensions.sample).toEqual({ enabled: true });
    expect(result.manifest.unknownFields.futureFlag).toEqual({ mode: "strict" });
    expect(Object.isFrozen(result.manifest)).toBe(true);
    expect(Object.isFrozen(result.manifest.host)).toBe(true);
    expect(Object.isFrozen(result.manifest.extensions.sample)).toBe(true);
  });

  it("rejects malformed ids, entrypoint traversal, invalid ranges, and duplicate capabilities", () => {
    const result = normalizeAuthorManifest(
      {
        id: "bad_plugin",
        name: "Bad Plugin",
        version: "not-semver",
        entrypoint: "../main.js",
        apiVersion: "not-a-range",
        requiredCapabilities: [
          { id: "nexus.commands", version: "^1.0.0" },
          { id: "nexus.commands", version: "^1.0.0" },
        ],
      },
      { source },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(5);
    expect(result.diagnostics.every((diagnostic) => diagnostic.code === "manifest-invalid" || diagnostic.code === "plugin-id-invalid")).toBe(true);
  });

  it("normalizes only safe canonical id differences", () => {
    expect(normalizePluginId("  MY-Plugin  ")).toBe("my-plugin");
    expect(() => normalizePluginId("my_plugin")).toThrow();
    expect(() => normalizePluginId("-my-plugin")).toThrow();
    expect(() => normalizePluginId("my--plugin")).toThrow();
  });

  it("reports normalized id conflicts with both host-controlled sources", () => {
    const registry = new PluginIdentityRegistry();
    const first = normalizeAuthorManifest(
      {
        id: "Sample-Plugin",
        name: "One",
        version: "1.0.0",
        entrypoint: "main.js",
        apiVersion: "^1.0.0",
      },
      { source: { kind: "bundled", locator: "bundle:one" } },
    );
    const second = normalizeAuthorManifest(
      {
        id: "sample-plugin",
        name: "Two",
        version: "2.0.0",
        entrypoint: "main.js",
        apiVersion: "^1.0.0",
      },
      { source: { kind: "local-trusted", locator: "local:two" } },
    );

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const reservation = registry.reserve(first.manifest);
    const conflict = registry.reserve(second.manifest);

    expect(reservation.ok).toBe(true);
    expect(conflict.ok).toBe(false);
    if (conflict.ok) return;
    expect(conflict.diagnostic.code).toBe("plugin-id-conflict");
    expect(conflict.diagnostic.details).toMatchObject({
      existingSource: "bundle:one",
      conflictingSource: "local:two",
    });
  });
});
