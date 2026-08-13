import type {
  ContributionRegistration,
  ManagedResource,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import { createEditor } from "@floatboat/nexus-core";
import {
  CommandRegistry,
  EditorHostRegistry,
  LegacyPluginAdapter,
  type LegacyRemarkTransformPort,
  type LegacyWidgetPort,
} from "@floatboat/nexus-plugin-runtime";
import { describe, expect, it } from "vitest";

import {
  countLegacyContributions,
  legacyReferenceFixtures,
} from "../src/legacy-fixtures";

const FIXTURE_MARKDOWN = [
  "# Legacy fixture",
  "",
  "Searchable **markdown** with [[Wiki Link]] and $x + y$.",
  "",
  "| A | B |",
  "| --- | --- |",
  "| 1 | 2 |",
].join("\n");

interface PortTracker {
  readonly active: Set<string>;
  readonly activations: Map<string, number>;
  readonly disposals: Map<string, number>;
}

function increment(values: Map<string, number>, key: string): void {
  values.set(key, (values.get(key) ?? 0) + 1);
}

function trackedRegistration(
  owner: ResourceOwner,
  localId: string,
  tracker: PortTracker,
): RegistrationResult<ContributionRegistration & ManagedResource> {
  const globalId = `${owner.pluginId}:${localId}`;
  let state: RegistrationState = "staged";
  let disposePromise: Promise<void> | null = null;

  const registration: ContributionRegistration & ManagedResource = {
    id: `reference-port:${globalId}` as ContributionRegistration["id"],
    owner,
    localId,
    globalId,
    priority: 0,
    get state() {
      return state;
    },
    get disposed() {
      return state === "disposed";
    },
    activate() {
      if (state !== "staged") return;
      state = "active";
      tracker.active.add(globalId);
      increment(tracker.activations, globalId);
    },
    quiesce() {
      if (state !== "staged" && state !== "active") return;
      state = "quiescing";
      tracker.active.delete(globalId);
    },
    dispose() {
      if (disposePromise) return disposePromise;
      registration.quiesce?.();
      state = "disposed";
      tracker.active.delete(globalId);
      increment(tracker.disposals, globalId);
      disposePromise = Promise.resolve();
      return disposePromise;
    },
  };

  return { ok: true, registration };
}

function createTrackedPorts(tracker: PortTracker): {
  readonly remarkTransforms: LegacyRemarkTransformPort;
  readonly widgets: LegacyWidgetPort;
} {
  return {
    remarkTransforms: {
      registerLegacyTransform: (owner, localId) =>
        trackedRegistration(owner, localId, tracker),
    },
    widgets: {
      registerLegacyWidget: (owner, localId) =>
        trackedRegistration(owner, localId, tracker),
    },
  };
}

describe("legacy reference fixtures", () => {
  it.each(legacyReferenceFixtures)(
    "$id declares the contribution shape produced by its legacy factory",
    (fixture) => {
      expect(countLegacyContributions(fixture.create())).toEqual(fixture.expected);
    },
  );

  it.each(legacyReferenceFixtures)(
    "$id remains loadable through createEditor({ plugins })",
    (fixture) => {
      const container = document.createElement("div");
      document.body.append(container);
      const editor = createEditor({
        container,
        initialValue: FIXTURE_MARKDOWN,
        plugins: [fixture.create()],
      });

      try {
        expect(editor.getDocument()).toBe(FIXTURE_MARKDOWN);
        editor.setDocument(`${FIXTURE_MARKDOWN}\n\nStatic path updated.`);
        expect(editor.getDocument()).toContain("Static path updated.");
      } finally {
        editor.destroy();
        container.remove();
      }
    },
  );

  it.each(legacyReferenceFixtures)(
    "$id activates and releases through LegacyPluginAdapter without residue",
    async (fixture) => {
      const container = document.createElement("div");
      document.body.append(container);
      const editor = createEditor({
        container,
        initialValue: FIXTURE_MARKDOWN,
      });
      const commands = new CommandRegistry();
      const editors = new EditorHostRegistry();
      const attachment = editors.attach({
        editor,
        surface: { kind: "document", root: container },
      });
      const tracker: PortTracker = {
        active: new Set(),
        activations: new Map(),
        disposals: new Map(),
      };
      const ports = createTrackedPorts(tracker);
      const adapter = new LegacyPluginAdapter({ commands, editors, ...ports });
      const owner = adapter.createOwner(fixture.pluginId);
      const trackedContributionCount =
        fixture.expected.remarkPlugins + fixture.expected.widgets;

      try {
        await attachment.ready;

        for (let cycle = 0; cycle < 2; cycle += 1) {
          const adapted = adapter.adapt(owner, fixture.create());
          expect(adapted.ok).toBe(true);
          if (!adapted.ok) throw new Error(adapted.diagnostic.message);

          expect(adapted.registration.state).toBe("staged");
          await adapted.registration.activate();
          expect(adapted.registration.state).toBe("active");
          expect(tracker.active.size).toBe(trackedContributionCount);

          const firstDispose = adapted.registration.dispose();
          const secondDispose = adapted.registration.dispose();
          expect(secondDispose).toBe(firstDispose);
          await firstDispose;

          expect(adapted.registration.disposed).toBe(true);
          expect(tracker.active.size).toBe(0);
          expect(commands.listCommands()).toEqual([]);
        }

        expect(
          [...tracker.activations.values()].reduce((total, count) => total + count, 0),
        ).toBe(trackedContributionCount * 2);
        expect(
          [...tracker.disposals.values()].reduce((total, count) => total + count, 0),
        ).toBe(trackedContributionCount * 2);
      } finally {
        await attachment.detach();
        editor.destroy();
        container.remove();
      }
    },
  );
});
