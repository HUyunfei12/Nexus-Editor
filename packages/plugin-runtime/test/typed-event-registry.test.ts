import type {
  CancelableEventLike,
  ComponentId,
  ManagedResource,
  NexusDiagnostic,
  PluginId,
  ResourceOwner,
  Subscription,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import {
  CancelableEventRegistry,
  TypedEventRegistry,
} from "../src/events/typed-event-registry";

interface TestEvents {
  readonly changed: { readonly value: number };
  readonly ready: { readonly id: string };
}

interface CancelableEvents {
  readonly paste: CancelableEventLike & { readonly value: string };
}

function owner(pluginId: string): ResourceOwner {
  return {
    pluginId: pluginId as PluginId,
    componentId: `${pluginId}/root` as ComponentId,
  };
}

function activate(resources: readonly ManagedResource[]): void {
  for (const resource of resources) resource.activate?.();
}

class FakeCancelable implements CancelableEventLike {
  defaultPrevented = false;

  constructor(readonly value: string) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

describe("TypedEventRegistry", () => {
  it("keeps staged handlers hidden and dispatches by priority then stable order", () => {
    const resources: ManagedResource[] = [];
    const registry = new TypedEventRegistry<TestEvents>({
      serviceId: "test.events",
      events: { changed: null, ready: null },
    });
    const first = registry.createEvents(owner("first"), (resource) => resources.push(resource));
    const second = registry.createEvents(owner("second"), (resource) => resources.push(resource));
    const calls: string[] = [];
    first.on("changed", () => calls.push("normal-first"));
    second.on("changed", () => calls.push("high"), { priority: 100 });
    first.on("changed", () => calls.push("normal-second"));
    second.on("changed", () => calls.push("low"), { priority: -10 });

    registry.emit("changed", { value: 1 });
    expect(calls).toEqual([]);
    activate(resources);
    registry.emit("changed", { value: 2 });
    registry.emit("changed", { value: 3 });
    expect(calls).toEqual([
      "high",
      "normal-first",
      "normal-second",
      "low",
      "high",
      "normal-first",
      "normal-second",
      "low",
    ]);
  });

  it("uses a dispatch snapshot while honoring disposal before a handler turn", async () => {
    const resources: ManagedResource[] = [];
    const registry = new TypedEventRegistry<TestEvents>({
      serviceId: "test.events",
      events: { changed: null, ready: null },
    });
    const events = registry.createEvents(owner("sample"), (resource) => resources.push(resource));
    const calls: string[] = [];
    let later!: Subscription;
    events.on(
      "changed",
      () => {
        calls.push("first");
        events.on("changed", () => calls.push("new"));
        void later.dispose();
      },
      { priority: 10 },
    );
    later = events.on("changed", () => calls.push("disposed-before-turn"));
    activate(resources);

    registry.emit("changed", { value: 1 });
    expect(calls).toEqual(["first"]);
    resources.at(-1)?.activate?.();
    registry.emit("changed", { value: 2 });
    expect(calls).toEqual(["first", "first", "new"]);
    await later.dispose();
    await later.dispose();
  });

  it("queues same-channel reentry in FIFO order without recursive handler entry", () => {
    const resources: ManagedResource[] = [];
    const registry = new TypedEventRegistry<TestEvents>({
      serviceId: "test.events",
      events: { changed: null, ready: null },
    });
    const events = registry.createEvents(owner("sample"), (resource) => resources.push(resource));
    const calls: string[] = [];
    let depth = 0;
    let maximumDepth = 0;
    events.on("changed", ({ value }) => {
      depth += 1;
      maximumDepth = Math.max(maximumDepth, depth);
      calls.push(`first:${value}`);
      if (value === 1) {
        registry.emit("changed", { value: 2 });
        registry.emit("changed", { value: 3 });
      }
      depth -= 1;
    });
    events.on("changed", ({ value }) => calls.push(`second:${value}`));
    activate(resources);

    registry.emit("changed", { value: 1 });
    expect(calls).toEqual([
      "first:1",
      "second:1",
      "first:2",
      "second:2",
      "first:3",
      "second:3",
    ]);
    expect(maximumDepth).toBe(1);
  });

  it("bounds reentry, attributes it to the source owner and leaves other channels usable", () => {
    const resources: ManagedResource[] = [];
    const diagnostics: NexusDiagnostic[] = [];
    const registry = new TypedEventRegistry<TestEvents>({
      serviceId: "test.events",
      events: { changed: null, ready: null },
      dispatchBudget: 3,
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const events = registry.createEvents(owner("looping-plugin"), (resource) =>
      resources.push(resource),
    );
    let ready = 0;
    events.on("changed", ({ value }) => registry.emit("changed", { value: value + 1 }));
    events.on("ready", () => {
      ready += 1;
    });
    activate(resources);

    registry.emit("changed", { value: 1 });
    expect(diagnostics).toMatchObject([
      {
        code: "event-dispatch-budget-exceeded",
        plugin: { id: "looping-plugin" },
        details: { eventName: "changed", budget: 3, dropped: 1 },
      },
    ]);
    registry.emit("ready", { id: "still-works" });
    expect(ready).toBe(1);
  });

  it("ignores notification return values and isolates sync and async failures", async () => {
    const resources: ManagedResource[] = [];
    const diagnostics: NexusDiagnostic[] = [];
    const registry = new TypedEventRegistry<TestEvents>({
      serviceId: "test.events",
      events: { changed: null, ready: null },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const events = registry.createEvents(owner("sample"), (resource) => resources.push(resource));
    const survivor = vi.fn();
    events.on("changed", (() => false) as never, { priority: 30 });
    events.on("changed", () => {
      throw new Error("sync failed");
    }, { priority: 20 });
    events.on("changed", (() => Promise.reject(new Error("async failed"))) as never, {
      priority: 10,
    });
    events.on("changed", survivor);
    activate(resources);

    expect(() => registry.emit("changed", { value: 1 })).not.toThrow();
    expect(survivor).toHaveBeenCalledOnce();
    await Promise.resolve();
    await Promise.resolve();
    expect(diagnostics.map((item) => item.code)).toEqual([
      "callback-failed",
      "callback-failed",
    ]);
  });

  it("rejects unknown channels and invalid payloads with contract diagnostics", () => {
    const diagnostics: NexusDiagnostic[] = [];
    const registry = new TypedEventRegistry<TestEvents>({
      serviceId: "test.events",
      events: {
        changed: (payload): payload is TestEvents["changed"] =>
          typeof payload === "object" &&
          payload !== null &&
          "value" in payload &&
          typeof payload.value === "number",
        ready: null,
      },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const result = registry.subscribe(
      owner("sample"),
      "missing" as keyof TestEvents,
      vi.fn(),
    );
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "event-unknown" } });
    registry.emit("changed", { value: "invalid" } as never);
    expect(diagnostics).toMatchObject([
      { code: "event-unknown", details: { serviceId: "test.events", eventName: "missing" } },
      { code: "event-unknown", resourceId: "test.events:changed" },
    ]);
  });
});

describe("CancelableEventRegistry", () => {
  it("broadcasts synchronously after preventDefault and only returns the final sync state", async () => {
    const resources: ManagedResource[] = [];
    const registry = new CancelableEventRegistry<CancelableEvents>({
      serviceId: "editor.dom",
      events: { paste: null },
    });
    const events = registry.createEvents(owner("sample"), (resource) => resources.push(resource));
    const observations: boolean[] = [];
    events.on("paste", (event) => event.preventDefault(), { priority: 10 });
    events.on("paste", (event) => observations.push(event.defaultPrevented));
    activate(resources);

    const event = new FakeCancelable("payload");
    expect(registry.dispatch("paste", event)).toEqual({
      defaultPrevented: true,
      diagnostics: [],
    });
    expect(observations).toEqual([true]);

    const lateResources: ManagedResource[] = [];
    const lateRegistry = new CancelableEventRegistry<CancelableEvents>({
      serviceId: "editor.dom.late",
      events: { paste: null },
    });
    lateRegistry
      .createEvents(owner("late"), (resource) => lateResources.push(resource))
      .on("paste", (lateEvent) => void Promise.resolve().then(() => lateEvent.preventDefault()));
    activate(lateResources);
    const late = new FakeCancelable("late");
    expect(lateRegistry.dispatch("paste", late).defaultPrevented).toBe(false);
    await Promise.resolve();
    expect(late.defaultPrevented).toBe(true);
  });

  it("does not treat return values, promises or exceptions as cancellation", async () => {
    const resources: ManagedResource[] = [];
    const diagnostics: NexusDiagnostic[] = [];
    const registry = new CancelableEventRegistry<CancelableEvents>({
      serviceId: "editor.dom",
      events: { paste: null },
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const events = registry.createEvents(owner("sample"), (resource) => resources.push(resource));
    const survivor = vi.fn();
    events.on("paste", (() => true) as never, { priority: 30 });
    events.on("paste", (() => Promise.resolve(false)) as never, { priority: 20 });
    events.on("paste", () => {
      throw new Error("failed before cancellation");
    }, { priority: 10 });
    events.on("paste", survivor);
    activate(resources);

    const result = registry.dispatch("paste", new FakeCancelable("payload"));
    expect(result.defaultPrevented).toBe(false);
    expect(result.diagnostics).toMatchObject([{ code: "callback-failed" }]);
    expect(survivor).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(diagnostics).toMatchObject([{ code: "callback-failed" }]);
  });
});
