import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import { NexusEditorElement, defineNexusEditor } from "../src/index";

// jsdom cannot "undefine" a custom element, so register a single stable tag
// once and reuse it for every element in this file.
const TAG = `nexus-editor-wc-${Date.now()}`;
let ElementClass: typeof NexusEditorElement;

function mount(): { host: HTMLElement; el: NexusEditorElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  host.innerHTML = `<${TAG}></${TAG}>`;
  const el = host.firstElementChild as NexusEditorElement;
  return { host, el };
}

beforeAll(() => {
  ElementClass = defineNexusEditor(TAG);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("@floatboat/nexus-wc", () => {
  it("registers and mounts a custom element with an editor", () => {
    const { host, el } = mount();
    expect(el).toBeInstanceOf(ElementClass);
    expect(el.isMounted()).toBe(true);
    expect(el.getEditor()).not.toBeNull();
    expect(host.querySelector(".cm-editor")).not.toBeNull();
  });

  it("is idempotent when the same tag is registered twice", () => {
    expect(defineNexusEditor(TAG)).toBe(ElementClass);
  });

  it("seeds the initial document from the value attribute", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    host.innerHTML = `<${TAG} value="# Hello"></${TAG}>`;
    const el = host.firstElementChild as NexusEditorElement;
    expect(el.getEditor()?.getDocument()).toBe("# Hello");
  });

  it("applies external value writes with a silent setDocument", () => {
    const { el } = mount();
    const editor = el.getEditor()!;
    el.value = "external";
    expect(editor.getDocument()).toBe("external");
  });

  it("dispatches a change event on user edits", () => {
    const { el } = mount();
    const listener = vi.fn();
    el.addEventListener("change", listener);
    // Non-silent setDocument routes through onChange -> boundOnChange.
    el.getEditor()!.setDocument("edited");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("does not loop when the controlled value echoes the last change", () => {
    const { el } = mount();
    const editor = el.getEditor()!;
    const setDocument = vi.spyOn(editor, "setDocument");

    // Simulate a user edit: emits document "edited".
    editor.setDocument("edited");

    // Host echoes the same markdown back; it is our own emission, not a re-sync.
    el.value = "edited";
    expect(setDocument).toHaveBeenCalledTimes(1);
  });

  it("frees the editor on disconnect", () => {
    const { host, el } = mount();
    expect(el.isMounted()).toBe(true);
    host.innerHTML = "";
    expect(el.isMounted()).toBe(false);
    expect(el.getEditor()).toBeNull();
  });
});