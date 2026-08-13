import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, RefObject } from "react";

export interface EditorRuntimeAttachment {
  readonly ready?: Promise<void>;
  detach(): void | Promise<void>;
}

/** Minimal structural bridge implemented by a host-owned plugin runtime adapter. */
export interface EditorRuntimeBinding {
  attachEditor(editor: EditorAPI, root: HTMLElement): EditorRuntimeAttachment;
}

export interface OwnedEditorRuntimeBinding extends EditorRuntimeBinding {
  dispose(): void | Promise<void>;
}

export type EditorRuntimeOwnership =
  | {
      readonly kind: "borrowed";
      /** Application-owned runtime. The wrapper only attaches and detaches this editor. */
      readonly runtime: EditorRuntimeBinding;
    }
  | {
      readonly kind: "owned";
      /** Creates a wrapper-owned runtime that is disposed after editor detach. */
      readonly createRuntime: () => OwnedEditorRuntimeBinding;
    };

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /** Called once after the editor is created on first mount. */
  onReady?: (editor: EditorAPI) => void;
  /**
   * Controlled markdown document. When provided, the parent owns the string and
   * should update it from `onChange`. External updates are applied with a silent
   * `setDocument` to avoid feedback loops.
   */
  value?: string;
  /** Explicit plugin runtime ownership; omitted keeps standalone editor behavior. */
  runtime?: EditorRuntimeOwnership;
};

/** DOM attrs that share names with EditorConfig callbacks are omitted from container passthrough. */
type EditorContainerAttributes = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children" | "ref" | "onChange" | "onFocus" | "onBlur"
>;

export type EditorProps = UseEditorConfig & EditorContainerAttributes;

export interface UseEditorResult {
  containerRef: RefObject<HTMLDivElement | null>;
  editor: EditorAPI | null;
}
