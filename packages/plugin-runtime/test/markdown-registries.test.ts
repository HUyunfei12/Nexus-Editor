import { history } from "@codemirror/commands";
import type {
  ComponentId,
  ManagedResource,
  PluginId,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import {
  NexusComponent,
} from "@floatboat/nexus-plugin-api";
import {
  createEditor,
  type EditorAPI,
  type EditorContributionRegistration,
  type EditorContributionSink,
  type WidgetDefinition,
} from "@floatboat/nexus-core";
import type { Root } from "mdast";
import { describe, expect, it, vi } from "vitest";

import {
  MarkdownPostProcessorRegistry,
  RemarkTransformRegistry,
  WidgetRegistry,
} from "../src/index";

function owner(pluginId = "markdown-fixture"): ResourceOwner {
  return {
    pluginId: pluginId as PluginId,
    componentId: `${pluginId}/root` as ComponentId,
  };
}

function activate(resource: ManagedResource): Promise<void> {
  return Promise.resolve(resource.activate?.());
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

interface SnapshotInstallPlan {
  readonly ready?: Promise<void>;
  readonly dispose?: () => Promise<void>;
}

class SnapshotSink {
  readonly plans: SnapshotInstallPlan[] = [];
  readonly registrations: EditorContributionRegistration[] = [];
  readonly refresh = vi.fn(async () => undefined);
  private sequence = 0;

  registerExtension(ownerId: string, _extension: unknown): EditorContributionRegistration {
    const plan = this.plans.shift() ?? {};
    let disposed = false;
    let disposal: Promise<void> | null = null;
    const registration: EditorContributionRegistration = {
      id: `snapshot:${++this.sequence}`,
      ownerId,
      get disposed() { return disposed; },
      ready: plan.ready ?? Promise.resolve(),
      dispose: () => {
        if (disposal) return disposal;
        disposed = true;
        disposal = plan.dispose?.() ?? Promise.resolve();
        return disposal;
      },
    };
    this.registrations.push(registration);
    return registration;
  }

  asContributionSink(): EditorContributionSink {
    return this as unknown as EditorContributionSink;
  }
}

function capturedEditor(initialValue: string): {
  readonly editor: EditorAPI;
  readonly container: HTMLElement;
} {
  const container = document.createElement("div");
  document.body.append(container);
  const editor = createEditor({
    container,
    initialValue,
    plugins: [{ name: "history", cmExtensions: [history()] }],
  });
  return { editor, container };
}

describe("Markdown contribution registries", () => {
  it("rolls back Remark snapshots in reverse sink order when a later editor rejects them", async () => {
    const registry = new RemarkTransformRegistry();
    const first = new SnapshotSink();
    const second = new SnapshotSink();
    const firstAttachment = registry.attach(first.asContributionSink());
    const secondAttachment = registry.attach(second.asContributionSink());
    await Promise.all([firstAttachment.ready, secondAttachment.ready]);
    const disposalOrder: string[] = [];
    first.plans.push({ dispose: async () => void disposalOrder.push("first") });
    second.plans.push({
      ready: Promise.reject(new Error("second editor rejected snapshot")),
      dispose: async () => void disposalOrder.push("second"),
    });
    const registered = registry.register(owner(), () => (tree: Root) => tree, { id: "atomic" });
    if (!registered.ok) throw new Error(registered.diagnostic.message);

    await expect(activate(registered.registration)).rejects.toThrow("second editor rejected snapshot");

    expect(disposalOrder).toEqual(["second", "first"]);
    expect(registry.version).toBe(0);
    expect(registered.registration.state).toBe("staged");
    expect(first.registrations[0]?.disposed).toBe(false);
    expect(second.registrations[0]?.disposed).toBe(false);
    await registered.registration.dispose();
    await Promise.all([firstAttachment.dispose(), secondAttachment.dispose()]);
  });

  it("keeps a committed Widget snapshot active when previous snapshot cleanup fails", async () => {
    const diagnostics: Array<{ code: string; message: string }> = [];
    const registry = new WidgetRegistry({
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const sink = new SnapshotSink();
    sink.plans.push({ dispose: () => Promise.reject(new Error("old snapshot cleanup failed")) });
    const attachment = registry.attach(sink.asContributionSink());
    await attachment.ready;
    const registered = registry.register(owner(), {
      nodeType: "custom",
      render: () => document.createElement("span"),
    }, { id: "cleanup" });
    if (!registered.ok) throw new Error(registered.diagnostic.message);

    await expect(activate(registered.registration)).resolves.toBeUndefined();

    expect(registry.version).toBe(1);
    expect(registered.registration.state).toBe("active");
    expect(registry.snapshot.definitions).toHaveLength(1);
    expect(sink.refresh).toHaveBeenCalledOnce();
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "lifecycle-cleanup-failed",
      message: "Previous Widget snapshot cleanup failed",
    }));
    await registered.registration.dispose();
    await attachment.dispose();
  });

  it("keeps the last successful Remark snapshot when staging fails and never edits history", async () => {
    const { editor, container } = capturedEditor("# Heading");
    const originalEditor = editor;
    const registry = new RemarkTransformRegistry();
    const attachment = registry.attach(editor.getContributionSink());
    await attachment.ready;
    editor.dispatchTransaction({
      changes: [{ from: editor.getDocument().length, to: editor.getDocument().length, insert: "!" }],
      origin: ["test"],
      userEvent: "input.type",
    });
    const documentBefore = editor.getDocument();

    const good = registry.register(owner(), () => (tree: Root) => {
      tree.children.push({ type: "paragraph", children: [{ type: "text", value: "dynamic" }] });
      return tree;
    }, { id: "append" });
    if (!good.ok) throw new Error(good.diagnostic.message);
    await activate(good.registration);

    expect(registry.version).toBe(1);
    expect(editor.getAst().children.at(-1)).toMatchObject({
      type: "paragraph",
      children: [{ value: "dynamic" }],
    });
    expect(editor.exportHTML()).toContain("<p>dynamic</p>");
    expect(editor.getDocument()).toBe(documentBefore);
    expect(editor).toBe(originalEditor);

    const broken = registry.register(owner(), () => {
      throw new Error("staging failed");
    }, { id: "broken" });
    if (!broken.ok) throw new Error(broken.diagnostic.message);
    await expect(activate(broken.registration)).rejects.toThrow("staging failed");
    expect(registry.version).toBe(1);
    expect(editor.getDocument()).toBe(documentBefore);
    expect(editor.undo()).toBe(true);
    expect(editor.getDocument()).toBe("# Heading");

    await broken.registration.dispose();
    await good.registration.dispose();
    expect(editor.exportHTML()).not.toContain("<p>dynamic</p>");
    await attachment.dispose();
    editor.destroy();
    container.remove();
  });

  it("updates Widget snapshots at a safe point and destroys removed Widget DOM", async () => {
    const { editor, container } = capturedEditor("widget\n");
    const parser = {
      parse(): Root {
        return {
          type: "root",
          children: [{
            type: "custom",
            value: "widget",
            position: {
              start: { line: 1, column: 1, offset: 0 },
              end: { line: 1, column: 7, offset: 6 },
            },
          } as never],
        };
      },
    };
    editor.destroy();
    container.replaceChildren();
    const dynamicEditor = createEditor({
      container,
      initialValue: "widget\n",
      parser,
    });
    dynamicEditor.setSelection(dynamicEditor.getDocument().length);
    const originalRoot = container.querySelector(".cm-editor");
    const registry = new WidgetRegistry();
    const attachment = registry.attach(dynamicEditor.getContributionSink());
    await attachment.ready;
    const destroy = vi.fn();
    const definition: WidgetDefinition = {
      nodeType: "custom",
      render: () => {
        const element = document.createElement("button");
        element.textContent = "Dynamic widget";
        return element;
      },
      destroy,
    };
    const registered = registry.register(owner(), definition, { id: "preview" });
    if (!registered.ok) throw new Error(registered.diagnostic.message);

    const content = container.querySelector<HTMLElement>(".cm-content")!;
    content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    const activating = activate(registered.registration);
    await nextFrame();
    expect(container.querySelector("[data-nexus-widget]")).toBeNull();
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    await activating;
    // Keep the custom range outside the cursor so the Widget may replace it.
    dynamicEditor.setSelection(dynamicEditor.getDocument().length);
    expect(container.querySelector("[data-nexus-widget]")?.textContent).toBe("Dynamic widget");
    expect(container.querySelector(".cm-editor")).toBe(originalRoot);

    await registered.registration.dispose();
    expect(container.querySelector("[data-nexus-widget]")).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
    expect(dynamicEditor.getDocument()).toBe("widget\n");
    await attachment.dispose();
    dynamicEditor.destroy();
    container.remove();
  });

  it("orders postprocessors and exposes source, frontmatter and section context", async () => {
    const registry = new MarkdownPostProcessorRegistry();
    const resources: ManagedResource[] = [];
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    const calls: string[] = [];
    service.registerPostProcessor((element, context) => {
      calls.push(`second:${context.sourcePath}:${context.frontmatter?.title}`);
      expect(context.getSectionInfo(element)).toEqual({
        lineStart: 2,
        lineEnd: 4,
        sourceStart: 8,
        sourceEnd: 20,
      });
      element.append("second");
    }, { sortOrder: 20 });
    service.registerPostProcessor((element, context) => {
      calls.push(`first:${context.documentId}:${context.generation}`);
      element.append("first");
    }, { sortOrder: -10 });
    for (const resource of resources) await activate(resource);
    const element = document.createElement("section");

    const result = await registry.renderFragment({
      element,
      sourcePath: "Notes/Test.md" as never,
      documentId: "doc-1",
      frontmatter: { title: "Example" },
      getSectionInfo: () => ({ lineStart: 2, lineEnd: 4, sourceStart: 8, sourceEnd: 20 }),
    }).ready;

    expect(result.status).toBe("committed");
    expect(calls[0]).toMatch(/^first:doc-1:/);
    expect(calls[1]).toBe("second:Notes/Test.md:Example");
    expect(element.textContent).toBe("firstsecond");
    await registry.dispose();
  });

  it("prevents stale async results from committing to a replacement generation", async () => {
    const registry = new MarkdownPostProcessorRegistry();
    const resources: ManagedResource[] = [];
    const service = registry.createService(owner(), (resource) => resources.push(resource));
    const gate = deferred();
    service.registerPostProcessor(async (element, context) => {
      const generation = context.generation;
      await gate.promise;
      element.textContent = `old:${generation}`;
    });
    for (const resource of resources) await activate(resource);
    const element = document.createElement("section");
    const first = registry.renderFragment({ element, documentId: "doc" });
    await Promise.resolve();
    const second = registry.renderFragment({ element, documentId: "doc" });
    gate.resolve();

    await expect(first.ready).resolves.toMatchObject({ status: "stale" });
    await expect(second.ready).resolves.toMatchObject({ status: "committed" });
    expect(element.textContent).toBe(`old:${second.generation}`);
    expect(first.signal.aborted).toBe(true);
    await registry.dispose();
  });

  it("falls back to default fenced code rendering after processor disposal", async () => {
    const registry = new MarkdownPostProcessorRegistry();
    const registered = registry.registerCodeBlockProcessor(
      owner(),
      "csv",
      (source, element) => {
        element.textContent = `table:${source}`;
      },
    );
    if (!registered.ok) throw new Error(registered.diagnostic.message);
    await activate(registered.registration);
    const first = document.createElement("div");
    await registry.renderCodeBlock({
      element: first,
      documentId: "doc",
      language: "CSV",
      source: "a,b",
    }).ready;
    expect(first.textContent).toBe("table:a,b");
    expect(first.querySelector("pre")).toBeNull();

    await registered.registration.dispose();
    const fallback = document.createElement("div");
    const result = await registry.renderCodeBlock({
      element: fallback,
      documentId: "doc",
      language: "csv",
      source: "a,b",
    }).ready;
    expect(result.usedCodeBlockProcessor).toBe(false);
    expect(fallback.querySelector("pre > code.language-csv")?.textContent).toBe("a,b");
    await registry.dispose();
  });

  it("reports a code block processor failure and commits only the default rendering", async () => {
    const diagnostics: Array<{ code: string; message: string }> = [];
    const registry = new MarkdownPostProcessorRegistry({
      reportDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    const broken = registry.registerMarkdownCodeBlockProcessor(owner(), "csv", () => {
      throw new Error("CSV render failed");
    }, { sortOrder: -10 });
    const later = registry.registerCodeBlockProcessor(owner("later-plugin"), "csv", (_source, element) => {
      element.append("must not be mixed with fallback");
    }, { sortOrder: 10 });
    if (!broken.ok) throw new Error(broken.diagnostic.message);
    if (!later.ok) throw new Error(later.diagnostic.message);
    await Promise.all([activate(broken.registration), activate(later.registration)]);
    const element = document.createElement("div");

    const result = await registry.renderCodeBlock({
      element,
      documentId: "doc",
      language: "csv",
      source: "a,b",
    }).ready;

    expect(result).toMatchObject({ status: "committed", usedCodeBlockProcessor: false });
    expect(element.querySelector("pre > code.language-csv")?.textContent).toBe("a,b");
    expect(element.textContent).not.toContain("must not be mixed");
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "callback-failed",
      message: "CSV render failed",
    }));
    await Promise.all([broken.registration.dispose(), later.registration.dispose()]);
    await registry.dispose();
  });

  it("cancels an in-flight code block generation when its processor is disposed", async () => {
    const registry = new MarkdownPostProcessorRegistry();
    const gate = deferred();
    const registered = registry.registerCodeBlockProcessor(
      owner(),
      "csv",
      async (source, element) => {
        await gate.promise;
        element.textContent = `late:${source}`;
      },
    );
    if (!registered.ok) throw new Error(registered.diagnostic.message);
    await activate(registered.registration);
    const element = document.createElement("div");
    element.textContent = "current fragment";
    const render = registry.renderCodeBlock({
      element,
      documentId: "doc",
      language: "csv",
      source: "a,b",
    });
    await Promise.resolve();

    await registered.registration.dispose();
    expect(render.signal.aborted).toBe(true);
    expect(element.textContent).toBe("current fragment");
    gate.resolve();
    await expect(render.ready).resolves.toMatchObject({ status: "stale" });
    expect(element.textContent).toBe("current fragment");
    await registry.dispose();
  });

  it("cleans each render child timer and listener exactly once on rerender and detach", async () => {
    vi.useFakeTimers();
    try {
      const registry = new MarkdownPostProcessorRegistry();
      const registered = registry.registerPostProcessor(owner(), (_element, context) => {
        class RenderChild extends NexusComponent {
          override onload(): void {
            this.registerInterval(window.setInterval(() => undefined, 50));
            this.registerDomEvent(window, "fixture", () => undefined);
          }
          override onunload(): void {
            unloads += 1;
          }
        }
        return context.addChild(new RenderChild()).then(() => undefined);
      });
      if (!registered.ok) throw new Error(registered.diagnostic.message);
      await activate(registered.registration);
      let unloads = 0;
      const element = document.createElement("div");
      const first = registry.renderFragment({ element, documentId: "doc" });
      await first.ready;
      const second = registry.renderFragment({ element, documentId: "doc" });
      await second.ready;
      expect(unloads).toBe(1);
      await second.invalidate();
      await second.invalidate();
      expect(unloads).toBe(2);
      expect(vi.getTimerCount()).toBe(0);

      const third = registry.renderFragment({ element, documentId: "doc" });
      await third.ready;
      await registered.registration.dispose();
      expect(third.signal.aborted).toBe(true);
      expect(unloads).toBe(3);
      expect(vi.getTimerCount()).toBe(0);
      await registry.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the previous render child to unload before starting a replacement generation", async () => {
    const registry = new MarkdownPostProcessorRegistry();
    const unloadStarted = deferred();
    const finishUnload = deferred();
    const calls: string[] = [];
    let invocation = 0;
    const registered = registry.registerPostProcessor(owner(), async (_element, context) => {
      invocation += 1;
      calls.push(`processor:${invocation}`);
      if (invocation !== 1) return;
      class SlowRenderChild extends NexusComponent {
        override async onunload(): Promise<void> {
          calls.push("unload:start");
          unloadStarted.resolve();
          await finishUnload.promise;
          calls.push("unload:end");
        }
      }
      await context.addChild(new SlowRenderChild());
    });
    if (!registered.ok) throw new Error(registered.diagnostic.message);
    await activate(registered.registration);
    const element = document.createElement("div");
    await registry.renderFragment({ element, documentId: "doc" }).ready;

    const replacement = registry.renderFragment({ element, documentId: "doc" });
    await unloadStarted.promise;
    expect(calls).toEqual(["processor:1", "unload:start"]);
    finishUnload.resolve();
    await replacement.ready;

    expect(calls).toEqual(["processor:1", "unload:start", "unload:end", "processor:2"]);
    await registered.registration.dispose();
    await registry.dispose();
  });

  it("waits for asynchronous render-child cleanup before processor disposal resolves", async () => {
    const registry = new MarkdownPostProcessorRegistry();
    const unloadStarted = deferred();
    const finishUnload = deferred();
    const registered = registry.registerPostProcessor(owner(), async (_element, context) => {
      class SlowDisposeChild extends NexusComponent {
        override async onunload(): Promise<void> {
          unloadStarted.resolve();
          await finishUnload.promise;
        }
      }
      await context.addChild(new SlowDisposeChild());
    });
    if (!registered.ok) throw new Error(registered.diagnostic.message);
    await activate(registered.registration);
    const element = document.createElement("div");
    await registry.renderFragment({ element, documentId: "doc" }).ready;

    let disposed = false;
    const disposal = registered.registration.dispose().then(() => {
      disposed = true;
    });
    await unloadStarted.promise;
    expect(disposed).toBe(false);
    finishUnload.resolve();
    await disposal;

    expect(disposed).toBe(true);
    await registry.dispose();
  });
});
