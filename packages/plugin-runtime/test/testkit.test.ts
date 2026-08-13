import { describe, expect, it, vi } from "vitest";

import {
  FixtureEntrypointResolver,
  ResourceTracker,
  VirtualClock,
  VirtualVault,
  VirtualWorkspace,
  createRuntimeTestkit,
} from "../src/testkit";

describe("runtime testkit", () => {
  it("runs deterministic timers and exposes pending resource state", () => {
    const clock = new VirtualClock();
    const calls: string[] = [];
    const interval = clock.setInterval(() => calls.push(`interval:${clock.now}`), 5);
    clock.setTimeout(() => calls.push(`timeout:${clock.now}`), 8);

    clock.tick(10);
    expect(calls).toEqual(["interval:5", "timeout:8", "interval:10"]);
    expect(clock.pendingCount).toBe(1);
    clock.clearInterval(interval);
    expect(clock.pendingCount).toBe(0);
  });

  it("reports exact leaked resources and supports idempotent async disposers", async () => {
    const tracker = new ResourceTracker();
    const listener = tracker.acquire("listener", "workspace-change");
    expect(() => tracker.assertNoLeaks()).toThrow("listener:workspace-change#1");
    listener.release();
    listener.release();
    const dispose = vi.fn(async () => undefined);
    const tracked = tracker.trackDisposer("registration", "command", dispose);

    await Promise.all([tracked(), tracked()]);
    expect(dispose).toHaveBeenCalledOnce();
    expect(() => tracker.assertNoLeaks()).not.toThrow();
  });

  it("keeps virtual vault data isolated and rejects path traversal", () => {
    const vault = new VirtualVault({ "notes/start.md": "hello" });
    const bytes = vault.readBinary("notes/start.md");
    bytes[0] = 0;
    expect(vault.read("notes/start.md")).toBe("hello");
    const moved = vault.rename("notes/start.md", "archive/start.md");
    expect(moved.path).toBe("archive/start.md");
    expect(vault.has("notes/start.md")).toBe(false);
    expect(() => vault.write("../outside.md", "bad")).toThrow("escapes");
  });

  it("models independent focused leaf and multi-window state", () => {
    const workspace = new VirtualWorkspace(document);
    const firstWindow = workspace.createWindow(document, "one");
    const secondWindow = workspace.createWindow(document, "two");
    const events: string[] = [];
    workspace.subscribe((event) => events.push(event.type));
    const first = workspace.createLeaf({ windowId: firstWindow.id, filePath: "a.md" });
    workspace.createLeaf({ windowId: secondWindow.id, filePath: "a.md" });
    workspace.focusLeaf(first.id);

    expect(workspace.getLeaves()).toHaveLength(2);
    expect(workspace.getFocusedLeaf()).toBe(first);
    expect(events).toEqual(["leaf-opened", "leaf-opened", "focused-leaf-changed"]);
  });

  it("loads only explicitly registered fixture modules", async () => {
    const resolver = new FixtureEntrypointResolver();
    const moduleNamespace = { default: class Fixture {} };
    resolver.register("fixture:sample", "./main.js", moduleNamespace);
    const request = {
      manifest: {} as never,
      source: { kind: "development" as const, locator: "fixture:sample" },
      entrypoint: "./main.js",
    };

    await expect(resolver.loadEntrypoint(request)).resolves.toBe(moduleNamespace);
    await expect(resolver.loadEntrypoint({ ...request, entrypoint: "./missing.js" })).rejects.toThrow(
      "Unknown plugin fixture",
    );
  });

  it("constructs the shared testkit with memory capabilities, DOM, vault and diagnostics", () => {
    const testkit = createRuntimeTestkit({ vaultFiles: { "readme.md": "fixture" } });
    expect(testkit.vault.read("readme.md")).toBe("fixture");
    expect(testkit.workspace.getLeaves()).toEqual([]);
    expect(testkit.capabilities.listProviders({})).toEqual([]);
    expect(testkit.diagnostics.diagnostics).toEqual([]);
  });
});
