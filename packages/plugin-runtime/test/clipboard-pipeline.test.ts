import type {
  ComponentId,
  EditorContext,
  EditorId,
  PluginId,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import { describe, expect, it, vi } from "vitest";

import {
  ClipboardPipeline,
  normalizeClipboardPayload,
  readClipboardPayload,
} from "../src/clipboard-pipeline";

function owner(id: string): ResourceOwner {
  return {
    pluginId: id as PluginId,
    componentId: `${id}:root` as ComponentId,
  };
}

function editorContext(surface: "document" | "table" = "document"): EditorContext {
  const root = document.createElement("div");
  return {
    editorId: "editor:1" as EditorId,
    editor: {} as EditorContext["editor"],
    contributions: {} as EditorContext["contributions"],
    file: null,
    sourcePath: null,
    view: null,
    leaf: null,
    window: null,
    surface: { kind: surface, root },
  };
}

function filterContext(
  operation: "paste" | "drop" | "copy" | "cut",
  editor = editorContext(),
) {
  const event = new Event(operation, { cancelable: true }) as ClipboardEvent;
  return {
    direction: operation === "paste" || operation === "drop" ? "incoming" as const : "outgoing" as const,
    operation,
    editor,
    target: null,
    event,
  };
}

describe("ClipboardPipeline", () => {
  it("reads plain text, HTML, files, and custom MIME data without flattening", () => {
    const file = new File(["image"], "image.png", { type: "image/png" });
    const data = {
      types: ["text/plain", "text/html", "application/x-nexus", "Files"],
      getData: (type: string) => ({
        "text/plain": "hello",
        "text/html": "<b>hello</b>",
        "application/x-nexus": "opaque",
      })[type] ?? "",
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
    } as unknown as DataTransfer;

    const payload = readClipboardPayload(data);
    expect(payload).toMatchObject({
      text: "hello",
      html: "<b>hello</b>",
      files: [file],
    });
    expect(payload.items).toEqual(expect.arrayContaining([
      { kind: "string", type: "application/x-nexus", value: "opaque" },
      { kind: "file", type: "image/png", file },
    ]));
  });

  it("keeps untouched HTML, custom MIME, and files when only text changes", async () => {
    const pipeline = new ClipboardPipeline();
    const file = new File(["image"], "image.png", { type: "image/png" });
    const payload = normalizeClipboardPayload({
      text: "before",
      html: "<b>before</b>",
      files: [file],
      items: [{ kind: "string", type: "application/x-nexus", value: "opaque" }],
    });
    const low = pipeline.registerFilter(owner("low"), "paste", () => ({ action: "pass" }));
    const high = pipeline.registerFilter(owner("high"), "paste", (current) => ({
      action: "replace",
      payload: { ...current, text: "after" },
    }), { priority: 10 });
    expect(low.ok && high.ok).toBe(true);
    if (!low.ok || !high.ok) return;
    await low.registration.activate?.();
    await high.registration.activate?.();

    const result = pipeline.runFilters("paste", payload, filterContext("paste"));
    expect(result.action).toBe("replace");
    expect(result.payload.text).toBe("after");
    expect(result.payload.html).toBe("<b>before</b>");
    expect(result.payload.files).toEqual([file]);
    expect(result.payload.items).toContainEqual({
      kind: "string",
      type: "application/x-nexus",
      value: "opaque",
    });
    expect(result.payload.items).toContainEqual({
      kind: "string",
      type: "text/plain",
      value: "after",
    });
  });

  it("uses priority then registration order and isolates invalid async filters", async () => {
    const diagnostics: string[] = [];
    const pipeline = new ClipboardPipeline({
      reportDiagnostic: (item) => diagnostics.push(item.message),
    });
    const seen: string[] = [];
    const registrations = [
      pipeline.registerFilter(owner("first"), "paste", () => {
        seen.push("first");
        return { action: "pass" };
      }),
      pipeline.registerFilter(owner("async"), "paste", (() => Promise.resolve({ action: "reject" })) as never, { priority: 20 }),
      pipeline.registerFilter(owner("high"), "paste", () => {
        seen.push("high");
        return { action: "pass" };
      }, { priority: 10 }),
    ];
    for (const result of registrations) {
      if (result.ok) await result.registration.activate?.();
    }

    pipeline.runFilters("paste", { text: "x", html: null, files: [], items: [] }, filterContext("paste"));
    expect(seen).toEqual(["high", "first"]);
    expect(diagnostics).toContain("Clipboard filters must return synchronously");
  });

  it("does not delete a cut source when browser writing is denied", async () => {
    const deleteSource = vi.fn();
    const pipeline = new ClipboardPipeline({
      writer: {
        write: vi.fn().mockResolvedValue({ status: "permission-denied" }),
      },
    });
    const context = filterContext("cut");
    const result = await pipeline.transferOutgoing(
      "cut",
      { text: "selected", html: null, files: [], items: [] },
      context,
      { deleteSource },
    );

    expect(result.status).toBe("permission-denied");
    expect(deleteSource).not.toHaveBeenCalled();
  });

  it("deletes a cut source exactly once only after a successful write", async () => {
    const events: string[] = [];
    const pipeline = new ClipboardPipeline({
      writer: {
        async write() {
          events.push("written");
          return { status: "written" };
        },
      },
    });
    const result = await pipeline.transferOutgoing(
      "cut",
      { text: "selected", html: null, files: [], items: [] },
      filterContext("cut"),
      { deleteSource: () => events.push("deleted") },
    );

    expect(result.status).toBe("written");
    expect(events).toEqual(["written", "deleted"]);
  });

  it("reports unsupported event formats before mutating or deleting", async () => {
    const pipeline = new ClipboardPipeline();
    const file = new File(["x"], "x.bin", { type: "application/octet-stream" });
    const clearData = vi.fn();
    const event = new Event("cut", { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, "clipboardData", {
      value: { clearData, setData: vi.fn(), items: {} },
    });
    const deleteSource = vi.fn();

    const result = await pipeline.transferOutgoing(
      "cut",
      { text: null, html: null, files: [file], items: [] },
      { ...filterContext("cut"), event },
      { event, deleteSource },
    );
    expect(result.status).toBe("format-unsupported");
    expect(clearData).not.toHaveBeenCalled();
    expect(deleteSource).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
