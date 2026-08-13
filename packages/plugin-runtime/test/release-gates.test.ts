import type {
  ComponentId,
  ManagedResource,
  PluginId,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import {
  NexusPluginBase,
  type AuthorPluginManifest,
  type NormalizedPluginManifest,
} from "@floatboat/nexus-plugin-api";
import { createEditor, type EditorAPI } from "@floatboat/nexus-core";
import type { Root } from "mdast";
import { describe, expect, it } from "vitest";
import releaseBaseline from "./fixtures/release-baseline.json";

import { RuntimeCapabilityRegistry } from "../src/capability";
import { PluginCompatibilityValidator } from "../src/compatibility";
import {
  HostControlledPluginEntrypointLoader,
  TrustedPluginPackageLoader,
  type TrustedPluginPackageCandidate,
} from "../src/loader";
import { RemarkTransformRegistry } from "../src/markdown/remark-transform-registry";
import { WidgetRegistry } from "../src/markdown/widget-registry";
import { PluginManager } from "../src/plugin-manager";
import { ResourceTracker } from "../src/testkit/resource-tracker";

const CYCLES = releaseBaseline.pluginLifecycle.cycles;
const EDITOR_COUNT = releaseBaseline.dynamicReconfiguration.editors;
const RECONFIGURATIONS = releaseBaseline.dynamicReconfiguration.cycles;
const RECONFIGURATION_BASELINE_MS = releaseBaseline.dynamicReconfiguration.maximumElapsedMs;

const manifest: AuthorPluginManifest = {
  id: "release-gate-fixture",
  name: "Release Gate Fixture",
  version: "1.0.0",
  entrypoint: "main.js",
  apiVersion: "^1.0.0",
};

function owner(): ResourceOwner {
  return {
    pluginId: "release-gate-fixture" as PluginId,
    componentId: "release-gate-fixture/root" as ComponentId,
  };
}

function trackedResource(
  tracker: ResourceTracker,
  kind: "listener" | "timer" | "registration" | "dom",
  label: string,
  hooks: { activate?: () => void; dispose?: () => void } = {},
): ManagedResource {
  let active: ReturnType<ResourceTracker["acquire"]> | null = null;
  return {
    activate() {
      active = tracker.acquire(kind, label);
      hooks.activate?.();
    },
    quiesce() {
      active?.release();
      active = null;
    },
    dispose() {
      hooks.dispose?.();
      active?.release();
      active = null;
    },
  };
}

function createManager(Plugin: typeof NexusPluginBase) {
  const resolver = {
    async loadEntrypoint(_request: { readonly manifest: NormalizedPluginManifest }) {
      return { default: Plugin };
    },
  };
  const capabilities = new RuntimeCapabilityRegistry();
  const validator = new PluginCompatibilityValidator({
    hostId: "release-gate-host",
    hostVersion: "1.0.0",
    apiVersion: "1.0.0",
    platform: "web",
    capabilities,
  });
  const loader = new TrustedPluginPackageLoader({
    validator,
    entrypoints: new HostControlledPluginEntrypointLoader(resolver),
  });
  return new PluginManager({
    host: {
      id: "release-gate-host",
      name: "Release Gate Host",
      version: "1.0.0",
      platform: "web",
    },
    apiVersion: "1.0.0",
    loader,
  });
}

function createEditors(count: number): Array<{ editor: EditorAPI; container: HTMLElement }> {
  return Array.from({ length: count }, (_, index) => {
    const container = document.createElement("div");
    document.body.append(container);
    return {
      editor: createEditor({ container, initialValue: `# Editor ${index}\n\nbody` }),
      container,
    };
  });
}

describe("plugin platform release gates", () => {
  it("returns listener, timer, registry, and DOM counts to zero over repeated enable cycles", async () => {
    const tracker = new ResourceTracker();
    const host = new EventTarget();
    const mount = document.createElement("div");
    document.body.append(mount);

    class TrackedPlugin extends NexusPluginBase {
      override onload() {
        const listener = () => undefined;
        this.register(trackedResource(tracker, "listener", "host:change", {
          activate: () => host.addEventListener("change", listener),
          dispose: () => host.removeEventListener("change", listener),
        }));
        const timerId = window.setInterval(() => undefined, 60_000);
        this.register(trackedResource(tracker, "timer", "interval:refresh", {
          dispose: () => window.clearInterval(timerId),
        }));
        this.register(trackedResource(tracker, "registration", "command:refresh"));
        const element = document.createElement("button");
        this.register(trackedResource(tracker, "dom", "toolbar:refresh", {
          activate: () => mount.append(element),
          dispose: () => element.remove(),
        }));
      }
    }

    const manager = createManager(TrackedPlugin);
    const candidate: TrustedPluginPackageCandidate = {
      authorManifest: manifest,
      host: { source: { kind: "development", locator: "fixture:release-gate" } },
    };
    expect(manager.discover(candidate).ok).toBe(true);

    for (let cycle = 0; cycle < CYCLES; cycle += 1) {
      await expect(manager.enable(manifest.id)).resolves.toMatchObject({ ok: true });
      expect(tracker.snapshot().map(({ kind }) => kind).sort()).toEqual([
        "dom",
        "listener",
        "registration",
        "timer",
      ]);
      expect(mount.childElementCount).toBe(1);

      await expect(manager.disable(manifest.id)).resolves.toMatchObject({ clean: true });
      tracker.assertNoLeaks(`Cycle ${cycle + 1} leaked plugin resources`);
      expect(tracker.size).toBe(releaseBaseline.pluginLifecycle.expectedAfterDisable);
      expect(mount.childElementCount).toBe(0);
    }

    mount.remove();
  });

  it("keeps multi-editor CM6 and Markdown reconfiguration within the recorded baseline", async () => {
    const fixtures = createEditors(EDITOR_COUNT);
    const remark = new RemarkTransformRegistry();
    const widgets = new WidgetRegistry();
    const attachments = fixtures.flatMap(({ editor }) => [
      remark.attach(editor.getContributionSink()),
      widgets.attach(editor.getContributionSink()),
    ]);
    await Promise.all(attachments.map(({ ready }) => ready));
    const extensions = fixtures.map(({ editor }, index) =>
      editor.getContributionSink().registerExtension(
        `performance-owner-${index}`,
        [],
      ),
    );
    await Promise.all(extensions.map(({ ready }) => ready));

    const startedAt = performance.now();
    for (let cycle = 0; cycle < RECONFIGURATIONS; cycle += 1) {
      const transform = remark.register(owner(), () => (tree: Root) => tree, {
        id: `transform-${cycle}`,
      });
      const widget = widgets.register(owner(), {
        nodeType: `release-gate-${cycle}`,
        render: () => document.createElement("span"),
      }, { id: `widget-${cycle}` });
      if (!transform.ok || !widget.ok) throw new Error("Release gate registration failed");
      await transform.registration.activate?.();
      await widget.registration.activate?.();
      await widget.registration.dispose();
      await transform.registration.dispose();
    }
    const elapsedMs = performance.now() - startedAt;

    expect(remark.snapshot.transform({ type: "root", children: [] })).toEqual({
      type: "root",
      children: [],
    });
    expect(widgets.snapshot.definitions).toHaveLength(0);
    expect(elapsedMs).toBeLessThan(RECONFIGURATION_BASELINE_MS);

    await Promise.all(extensions.map((registration) => registration.dispose()));
    await Promise.all(attachments.map((attachment) => attachment.dispose()));
    for (const { editor, container } of fixtures) {
      editor.destroy();
      container.remove();
    }
  }, 15_000);
});
