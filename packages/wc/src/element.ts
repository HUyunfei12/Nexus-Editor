import { createEditor } from "@floatboat/nexus-core";

import type { EditorAPI, EditorConfig, NexusPlugin } from "@floatboat/nexus-core";
import type { NexusTheme } from "@floatboat/nexus-core";
import type { Root } from "mdast";

/**
 * Config delivered via instance properties instead of attributes (they are
 * object/fn-typed, so attributes cannot hold them faithfully).
 */
export interface NexusEditorElementConfig {
  /** Plugins to enable; assign before the element is connected to the DOM. */
  plugins?: NexusPlugin[];
  /** Full theme object; assign before mount (config.theme must be an object). */
  theme?: NexusTheme;
  locale?: EditorConfig["locale"];
  tabSize?: number;
  direction?: EditorConfig["direction"];
  indentGuides?: boolean;
  parser?: EditorConfig["parser"];
  parseDelayMs?: number;
  slashMenuLimit?: number;
  multiCursor?: boolean;
  onAssetUpload?: EditorConfig["onAssetUpload"];
  onChange?: EditorConfig["onChange"];
  onFocus?: EditorConfig["onFocus"];
  onBlur?: EditorConfig["onBlur"];
}

export const NEXUS_EDITOR_ELEMENT_NAME = "nexus-editor";

type Listener = (event: Event) => void;

export class NexusEditorElement extends HTMLElement {
  static readonly observedAttributes = [
    "value",
    "initial-value",
    "live-preview",
    "readonly"
  ];

  /** Defaults for non-attribute config that should persist across reconnects. */
  readonly config: NexusEditorElementConfig = {};
  private editor: EditorAPI | null = null;
  private lastEmittedDocument: string | null = null;
  private destroyToken = 0;
  private readonly boundOnChange = (doc: string, ast: Root): void => {
    this.lastEmittedDocument = doc;
    this.config.onChange?.(doc, ast);
    this.dispatchChangeEvent(doc, ast);
  };
  private readonly boundOnFocus = (): void => {
    this.config.onFocus?.();
    this.dispatchCustomEvent("focus");
  };
  private readonly boundOnBlur = (): void => {
    this.config.onBlur?.();
    this.dispatchCustomEvent("blur");
  };

  connectedCallback(): void {
    if (this.editor) return;
    const container = document.createElement("div");
    container.className = "nexus-wc-host";
    this.appendChild(container);

    const instance = createEditor({
      container,
      initialValue: resolveInitialDocument(this.value, this.initialValue),
      livePreview: this.resolveBoolean("live-preview", this.livePreview, false),
      readOnly: this.resolveBoolean("readonly", this.readOnly, false),
      theme: this.config.theme,
      plugins: this.config.plugins,
      locale: this.config.locale,
      tabSize: this.config.tabSize,
      direction: this.config.direction,
      indentGuides: this.config.indentGuides,
      parser: this.config.parser,
      parseDelayMs: this.config.parseDelayMs,
      slashMenuLimit: this.config.slashMenuLimit,
      multiCursor: this.config.multiCursor,
      onAssetUpload: this.config.onAssetUpload,
      onChange: this.boundOnChange,
      onFocus: this.boundOnFocus,
      onBlur: this.boundOnBlur
    });

    this.lastEmittedDocument = this.value ?? this.initialValue ?? null;
    this.editor = instance;
    this.dispatchCustomEvent("ready", { editor: instance });
  }

  disconnectedCallback(): void {
    const token = ++this.destroyToken;
    const instance = this.editor;
    this.editor = null;
    if (!instance) return;
    Promise.resolve().then(() => {
      if (token !== this.destroyToken) return;
      instance.destroy();
      while (this.firstChild) {
        this.removeChild(this.firstChild);
      }
    });
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null
  ): void {
    if (oldValue === newValue) return;
    if (name === "value") {
      this.syncValueFromAttribute(newValue);
    }
  }

  /**
   * Controlled markdown document. The host owns the string; external writes are
   * applied with a silent `setDocument` unless they match the last emitted change.
   * Defaults to `initial-value` on first connect.
   */
  get value(): string {
    return this.getAttribute("value") ?? "";
  }

  set value(next: string | undefined) {
    if (next === undefined) {
      this.removeAttribute("value");
    } else {
      this.setAttribute("value", next);
    }
  }

  /** Initial document shown on first connection (ignored once `value` is set). */
  get initialValue(): string | undefined {
    return this.getAttribute("initial-value") ?? undefined;
  }

  set initialValue(next: string | undefined) {
    if (next === undefined) {
      this.removeAttribute("initial-value");
    } else {
      this.setAttribute("initial-value", next);
    }
  }

  get livePreview(): boolean {
    return this.hasAttribute("live-preview");
  }

  set livePreview(next: boolean) {
    this.toggleAttribute("live-preview", next);
  }

  get readOnly(): boolean {
    return this.hasAttribute("readonly");
  }

  set readOnly(next: boolean) {
    this.toggleAttribute("readonly", next);
  }

  /** The live editor instance, or `null` before first connect / after disconnect. */
  getEditor(): EditorAPI | null {
    return this.editor;
  }

  /** True once the element has created its editor (is connected and mounted). */
  isMounted(): boolean {
    return this.editor !== null;
  }

  private syncValueFromAttribute(next: string | null): void {
    const value = next ?? "";
    // Echo of our own external sync; don't loop.
    if (this.lastEmittedDocument === value) return;
    if (!this.editor) return; // initial render handles pre-mount values
    this.editor.setDocument(value, { silent: true });
    this.lastEmittedDocument = value;
  }

  private resolveBoolean(
    attr: string,
    prop: boolean,
    fallback: boolean
  ): boolean {
    const attrValue = this.getAttribute(attr);
    if (attrValue === null) return prop;
    return attrValue !== "false";
  }

  private dispatchChangeEvent(doc: string, ast: Root): void {
    this.dispatchCustomEvent("change", { document: doc, ast });
  }

  private dispatchCustomEvent<T extends Record<string, unknown>>(
    type: string,
    detail?: T
  ): void {
    this.dispatchEvent(
      new CustomEvent<T>(type, { detail, bubbles: true, composed: true })
    );
  }
}

/** Register `<nexus-editor>` if not already registered; returns it. */
export function defineNexusEditor(
  name = NEXUS_EDITOR_ELEMENT_NAME
): typeof NexusEditorElement {
  if (customElements.get(name)) {
    return customElements.get(name) as typeof NexusEditorElement;
  }
  customElements.define(name, NexusEditorElement);
  return NexusEditorElement;
}

export function resolveInitialDocument(
  value: string | undefined,
  initialValue: string | undefined
): string {
  return value !== undefined ? value : (initialValue ?? "");
}