import type {
  ContributionRegistration,
  ManagedResource,
  RegistrationResult,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import { createEditor, type NexusPlugin } from "@floatboat/nexus-core";
import { describe, expect, it, vi } from "vitest";

import { CommandRegistry } from "../src/commands/command-registry";
import { EditorHostRegistry } from "../src/editor-host-registry";
import {
  LegacyPluginAdapter,
  type LegacyRemarkTransformPort,
  type LegacyWidgetPort,
} from "../src/legacy-adapter";

function immediate(owner: ResourceOwner, id: string, events: string[]) {
  let state = "staged" as "staged" | "active" | "quiescing" | "disposed";
  const resource: ContributionRegistration & ManagedResource = {
    id: id as never,
    owner,
    localId: id,
    globalId: `${owner.pluginId}:${id}`,
    priority: 0,
    get state() { return state; },
    get disposed() { return state === "disposed"; },
    activate() { state = "active"; events.push(`activate:${id}`); },
    quiesce() { if (state !== "disposed") state = "quiescing"; },
    async dispose() { state = "disposed"; events.push(`dispose:${id}`); },
  };
  return { ok: true, registration: resource } satisfies RegistrationResult<typeof resource>;
}

describe("LegacyPluginAdapter", () => {
  it("keeps the existing createEditor({ plugins }) static path source-compatible", () => {
    const container = document.createElement("div");
    const action = vi.fn();
    const editor = createEditor({
      container,
      initialValue: "old",
      plugins: [{
        name: "unchanged-legacy",
        commands: [{ id: "replace", run: (api) => { action(); api.setDocument("new"); } }],
      }],
    });
    expect(editor.runCommand("replace")).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect(editor.getDocument()).toBe("new");
    editor.destroy();
  });

  it("stages every legacy contribution under one owner and removes them together", async () => {
    const commands = new CommandRegistry();
    const editors = new EditorHostRegistry();
    const events: string[] = [];
    const remarkTransforms: LegacyRemarkTransformPort = {
      registerLegacyTransform: (owner, id) => immediate(owner, id, events),
    };
    const widgets: LegacyWidgetPort = {
      registerLegacyWidget: (owner, id) => immediate(owner, id, events),
    };
    const adapter = new LegacyPluginAdapter({ commands, editors, remarkTransforms, widgets });
    const owner = adapter.createOwner("legacy.example");
    const container = document.createElement("div");
    document.body.append(container);
    const editor = createEditor({ container, initialValue: "hello" });
    const attached = editors.attach({
      editor,
      surface: { kind: "document", root: container },
    });
    await attached.ready;
    const ran = vi.fn();
    const pasted = vi.fn(() => true);
    const plugin: NexusPlugin = {
      name: "Legacy Example",
      commands: [{ id: "run", label: "Run", hotkey: "Mod-r", run: ran }],
      shortcuts: [{ key: "Ctrl-k", run: ran }],
      handlers: { paste: pasted },
      cmExtensions: [[]],
      remarkPlugins: [(() => undefined) as never],
      widgets: [{ nodeType: "custom", render: () => document.createElement("span") }],
    };
    const result = adapter.adapt(owner, plugin);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(commands.listCommands()).toEqual([]);
    expect(editor.getContributionSink().isInteractionActive()).toBe(false);

    await result.registration.activate();
    expect(commands.listCommands().map((item) => item.id)).toEqual([
      "legacy.example:run",
      "legacy.example:legacy-shortcut-1",
    ]);
    expect(result.registration.state).toBe("active");
    expect(events).toEqual(["activate:legacy-remark-1", "activate:legacy-widget-1"]);
    await commands.executeCommand("legacy.example:run", {
      trigger: "api",
      editor: attached.context,
    });
    expect(ran).toHaveBeenCalledOnce();
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    container.querySelector(".cm-content")?.dispatchEvent(paste);
    expect(pasted).toHaveBeenCalledOnce();
    expect(paste.defaultPrevented).toBe(true);

    await result.registration.dispose();
    await result.registration.dispose();
    expect(commands.listCommands()).toEqual([]);
    expect(result.registration.disposed).toBe(true);
    expect(events.slice(-2)).toEqual(["dispose:legacy-widget-1", "dispose:legacy-remark-1"]);
    await attached.detach();
    editor.destroy();
    container.remove();
  });

  it("rejects unavailable dynamic fields before publishing any supported field", () => {
    const commands = new CommandRegistry();
    const adapter = new LegacyPluginAdapter({
      commands,
      editors: new EditorHostRegistry(),
    });
    const result = adapter.adapt(adapter.createOwner("legacy.blocked"), {
      name: "Blocked",
      commands: [{ id: "must-not-publish", run: vi.fn() }],
      remarkPlugins: [(() => undefined) as never],
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: "legacy-contribution-unsupported",
        message: expect.stringContaining("remarkPlugins"),
      },
    });
    expect(commands.listCommands()).toEqual([]);
  });

  it("rolls back prior staged reservations when a later contribution conflicts", async () => {
    const commands = new CommandRegistry();
    const adapter = new LegacyPluginAdapter({ commands, editors: new EditorHostRegistry() });
    const owner = adapter.createOwner("legacy.conflict");
    const result = adapter.adapt(owner, {
      name: "Conflict",
      commands: [
        { id: "same", run: vi.fn() },
        { id: "same", run: vi.fn() },
      ],
    });
    expect(result).toMatchObject({ ok: false, diagnostic: { code: "command-conflict" } });
    await Promise.resolve();
    expect(commands.listCommands()).toEqual([]);
    const retried = adapter.adapt(owner, {
      name: "Retry",
      commands: [{ id: "same", run: vi.fn() }],
    });
    expect(retried.ok).toBe(true);
  });
});
