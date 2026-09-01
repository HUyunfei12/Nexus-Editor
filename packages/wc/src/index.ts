export {
  NexusEditorElement,
  NEXUS_EDITOR_ELEMENT_NAME,
  defineNexusEditor,
  resolveInitialDocument,
  type NexusEditorElementConfig
} from "./element";

export type { EditorAPI } from "@floatboat/nexus-core";
export type { NexusTheme } from "@floatboat/nexus-core";
export type { NexusPlugin } from "@floatboat/nexus-core";

/**
 * Convenience: register the custom element (idempotent) and return the class.
 * Calling it is optional — importing the package does not auto-register, so
 * side-effects stay explicit for tree-shaking.
 */
export { defineNexusEditor as registerNexusEditor } from "./element";