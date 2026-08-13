import {
  NexusComponent,
  NexusPluginError,
  type PluginIdentity,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticBus } from "../src/diagnostics";
import { ComponentLifecycleRuntime } from "../src/lifecycle/component-controller";
import { PluginLoadError } from "../src/lifecycle/errors";

function identity(id = "lifecycle-fixture"): PluginIdentity {
  return Object.freeze({
    id: id as PluginIdentity["id"],
    name: "Lifecycle Fixture",
    version: "1.2.3",
    source: Object.freeze({ kind: "development" as const, locator: `fixture:${id}` }),
  });
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("Component lifecycle", () => {
  it("stages resources until the entire component tree has loaded", async () => {
    const gate = deferred();
    const calls: string[] = [];
    class Root extends NexusComponent {
      override async onload() {
        this.register({
          activate: () => {
            calls.push("activate");
          },
          dispose: () => {
            calls.push("dispose");
          },
        });
        calls.push("onload-start");
        await gate.promise;
        calls.push("onload-end");
      }
    }

    const root = new Root();
    const controller = new ComponentLifecycleRuntime().manage(root, identity());
    const loading = controller.load();
    await Promise.resolve();

    expect(root.lifecycleState).toBe("loading");
    expect(calls).toEqual(["onload-start"]);
    gate.resolve();
    await loading;

    expect(root.lifecycleState).toBe("loaded");
    expect(calls).toEqual(["onload-start", "onload-end", "activate"]);
  });

  it("loads children in insertion order and unloads child hooks in reverse order", async () => {
    const calls: string[] = [];
    class LoggedComponent extends NexusComponent {
      constructor(private readonly label: string) {
        super();
      }
      override onload() {
        calls.push(`load:${this.label}`);
      }
      override onunload() {
        calls.push(`unload:${this.label}`);
      }
    }

    const parent = new LoggedComponent("parent");
    const first = new LoggedComponent("first");
    const second = new LoggedComponent("second");
    const controller = new ComponentLifecycleRuntime().manage(parent, identity());
    await parent.addChild(first);
    await parent.addChild(second);
    await controller.load();
    await controller.unload();

    expect(calls).toEqual([
      "load:parent",
      "load:first",
      "load:second",
      "unload:second",
      "unload:first",
      "unload:parent",
    ]);
    expect(first.lifecycleState).toBe("unloaded");
    expect(second.lifecycleState).toBe("unloaded");
  });

  it("cleans resources and child subtrees in reverse acquisition order", async () => {
    const calls: string[] = [];
    const parent = new NexusComponent();
    const child = new NexusComponent();
    const controller = new ComponentLifecycleRuntime().manage(parent, identity());

    parent.register(() => {
      calls.push("resource:a");
    });
    await parent.addChild(child);
    child.register(() => {
      calls.push("resource:child");
    });
    parent.register(async () => {
      await Promise.resolve();
      calls.push("resource:c");
    });

    await controller.load();
    await controller.unload();
    expect(calls).toEqual(["resource:c", "resource:child", "resource:a"]);
  });

  it("loads and unloads children added to an already loaded parent", async () => {
    const child = new NexusComponent();
    const parent = new NexusComponent();
    const controller = new ComponentLifecycleRuntime().manage(parent, identity());
    await controller.load();

    await parent.addChild(child);
    expect(child.lifecycleState).toBe("loaded");
    await parent.removeChild(child);
    expect(child.lifecycleState).toBe("unloaded");
    expect(controller.childControllers).toHaveLength(0);
  });

  it("rejects second owners, self ownership and ownership cycles atomically", async () => {
    const root = new NexusComponent();
    const child = new NexusComponent();
    const other = new NexusComponent();
    const runtime = new ComponentLifecycleRuntime();
    const rootController = runtime.manage(root, identity("owner-one"));
    const otherController = runtime.manage(other, identity("owner-two"));
    await root.addChild(child);

    await expect(root.addChild(root)).rejects.toMatchObject({
      diagnostic: { code: "component-ownership-invalid" },
    });
    await expect(child.addChild(root)).rejects.toMatchObject({
      diagnostic: { code: "component-ownership-invalid" },
    });
    await expect(other.addChild(child)).rejects.toMatchObject({
      diagnostic: { code: "component-ownership-invalid" },
    });

    expect(rootController.childControllers.map((item) => item.component)).toEqual([child]);
    expect(otherController.childControllers).toEqual([]);
  });

  it("supports active disposal and waits for async disposal exactly once", async () => {
    const gate = deferred();
    let disposeCount = 0;
    const component = new NexusComponent();
    const controller = new ComponentLifecycleRuntime().manage(component, identity());
    const registration = component.register(async () => {
      disposeCount += 1;
      await gate.promise;
    });
    await controller.load();

    const first = registration.dispose();
    const second = registration.dispose();
    expect(first).toBe(second);
    expect(disposeCount).toBe(1);
    gate.resolve();
    await first;
    await controller.unload();

    expect(disposeCount).toBe(1);
    expect(registration.state).toBe("disposed");
  });

  it("quiesces DOM callbacks before onunload and clears timers", async () => {
    vi.useFakeTimers();
    try {
      const target = new EventTarget();
      let eventCount = 0;
      let timerCount = 0;
      class Root extends NexusComponent {
        override onload() {
          this.registerDomEvent(target, "ping", () => eventCount++);
          this.registerInterval(window.setInterval(() => timerCount++, 10));
          this.registerTimeout(window.setTimeout(() => timerCount++, 10));
        }
        override onunload() {
          target.dispatchEvent(new Event("ping"));
        }
      }

      const root = new Root();
      const controller = new ComponentLifecycleRuntime().manage(root, identity());
      await controller.load();
      target.dispatchEvent(new Event("ping"));
      expect(eventCount).toBe(1);
      await controller.unload();
      vi.advanceTimersByTime(30);

      expect(eventCount).toBe(1);
      expect(timerCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("immediately disposes late registrations and waits for ones created by onunload", async () => {
    const gate = deferred();
    let disposed = false;
    class Root extends NexusComponent {
      override onunload() {
        this.register(async () => {
          await gate.promise;
          disposed = true;
        });
      }
    }

    const root = new Root();
    const diagnostics = new DiagnosticBus();
    const controller = new ComponentLifecycleRuntime(diagnostics).manage(root, identity());
    await controller.load();
    let completed = false;
    const unloading = controller.unload().then(() => {
      completed = true;
    });
    await Promise.resolve();

    expect(completed).toBe(false);
    expect(diagnostics.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "resource-late-registration" })]),
    );
    gate.resolve();
    await unloading;
    expect(disposed).toBe(true);

    let terminalDisposed = false;
    const registration = root.register(() => {
      terminalDisposed = true;
    });
    await registration.dispose();
    expect(terminalDisposed).toBe(true);
  });

  it("atomically rolls back failures without calling onunload", async () => {
    const calls: string[] = [];
    class Logged extends NexusComponent {
      constructor(private readonly label: string, private readonly fail = false) {
        super();
      }
      override onload() {
        this.register(() => {
          calls.push(`dispose:${this.label}`);
          if (this.fail) throw new Error("cleanup token=rollback-secret");
        });
        calls.push(`load:${this.label}`);
        if (this.fail) throw new Error("load token=rollback-secret");
      }
      override onunload() {
        calls.push(`unload:${this.label}`);
      }
    }

    const root = new Logged("root");
    const first = new Logged("first");
    const failing = new Logged("failing", true);
    const neverLoaded = new Logged("never-loaded");
    const diagnostics = new DiagnosticBus({ sensitiveValues: ["rollback-secret"] });
    const runtime = new ComponentLifecycleRuntime(diagnostics);
    const controller = runtime.manage(root, identity());
    await root.addChild(first);
    await root.addChild(failing);
    await root.addChild(neverLoaded);

    let thrown: unknown;
    try {
      await controller.load();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(PluginLoadError);
    expect(thrown).toMatchObject({ cleanupErrors: [expect.any(Error)] });
    expect(calls).toEqual([
      "load:root",
      "load:first",
      "load:failing",
      "dispose:root",
      "dispose:failing",
      "dispose:first",
    ]);
    expect(calls.some((call) => call.startsWith("unload:"))).toBe(false);
    expect(root.lifecycleState).toBe("failed");
    expect(first.lifecycleState).toBe("failed");
    expect(failing.lifecycleState).toBe("failed");
    expect(neverLoaded.lifecycleState).toBe("failed");
    expect(JSON.stringify(diagnostics.diagnostics)).not.toContain("rollback-secret");
    expect(diagnostics.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(["plugin-load-failed", "lifecycle-cleanup-failed"]),
    );
    await expect(controller.load()).rejects.toBeInstanceOf(NexusPluginError);
  });

  it("shares concurrent unload, continues after cleanup errors, and ends unloaded", async () => {
    const calls: string[] = [];
    class Root extends NexusComponent {
      override onload() {
        this.register(() => {
          calls.push("dispose:first");
          throw new Error("first cleanup failed");
        });
        this.register(() => {
          calls.push("dispose:second");
        });
      }
      override onunload() {
        calls.push("onunload");
        throw new Error("hook cleanup failed");
      }
    }

    const root = new Root();
    const controller = new ComponentLifecycleRuntime().manage(root, identity());
    await controller.load();
    const first = controller.unload();
    const second = controller.unload();
    expect(first).toBe(second);

    const result = await first;
    expect(result).toMatchObject({ state: "unloaded", clean: false });
    expect(root.lifecycleState).toBe("unloaded");
    expect(calls).toEqual(["onunload", "dispose:second", "dispose:first"]);
    expect(result.diagnostics.map((item) => item.code)).toEqual([
      "plugin-unload-failed",
      "lifecycle-cleanup-failed",
      "lifecycle-cleanup-failed",
    ]);
    expect(await controller.unload()).toBe(result);
  });

  it("shares the active unload promise with synchronous reentrant calls", async () => {
    let controller!: ReturnType<ComponentLifecycleRuntime["manage"]>;
    let reentrantUnload!: ReturnType<typeof controller.unload>;
    let unloadCalls = 0;
    class Root extends NexusComponent {
      override onunload() {
        unloadCalls += 1;
        reentrantUnload = controller.unload();
      }
    }

    controller = new ComponentLifecycleRuntime().manage(new Root(), identity());
    await controller.load();
    const unloading = controller.unload();

    expect(reentrantUnload).toBe(unloading);
    await expect(unloading).resolves.toMatchObject({ state: "unloaded", clean: true });
    expect(unloadCalls).toBe(1);
  });
});
