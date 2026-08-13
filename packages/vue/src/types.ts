import type {
  EditorAPI,
  EditorConfig
} from "@floatboat/nexus-core";
import type { HTMLAttributes, Ref, ShallowRef } from "vue";

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
      readonly runtime: EditorRuntimeBinding;
    }
  | {
      readonly kind: "owned";
      readonly createRuntime: () => OwnedEditorRuntimeBinding;
    };

export type UseEditorConfig = Omit<EditorConfig, "container"> & {
  /** Called once after the editor is created on first mount. */
  onReady?: (editor: EditorAPI) => void;
  /**
   * Controlled markdown document (use with `v-model`). When provided, the
   * parent owns the string; external updates use silent `setDocument`.
   */
  modelValue?: string;
  /** Explicit plugin runtime ownership; omitted keeps standalone editor behavior. */
  runtime?: EditorRuntimeOwnership;
};

/** DOM attrs that share names with EditorConfig callbacks are omitted from container passthrough. */
type EditorContainerAttributes = Omit<
  HTMLAttributes,
  "children" | "ref" | "onChange" | "onFocus" | "onBlur"
>;

export type EditorProps = UseEditorConfig & EditorContainerAttributes;

export interface UseEditorResult {
  containerRef: Ref<HTMLDivElement | null>;
  editor: ShallowRef<EditorAPI | null>;
}
