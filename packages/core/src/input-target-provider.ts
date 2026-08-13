import type { EditorInputTarget } from "./types";

export const EDITOR_INPUT_TARGET_PROVIDER = Symbol("nexus.editorInputTargetProvider");

export interface EditorInputTargetProvider {
  resolveInputTarget(eventTarget: HTMLElement): EditorInputTarget | null;
}

export type InputTargetProviderElement = HTMLElement & {
  [EDITOR_INPUT_TARGET_PROVIDER]?: EditorInputTargetProvider;
};

export function findProvidedInputTarget(
  eventTarget: HTMLElement,
  editorRoot: HTMLElement,
): EditorInputTarget | null {
  let current: HTMLElement | null = eventTarget;
  while (current && editorRoot.contains(current)) {
    const provider = (current as InputTargetProviderElement)[EDITOR_INPUT_TARGET_PROVIDER];
    const target = provider?.resolveInputTarget(eventTarget) ?? null;
    if (target) return target;
    if (current === editorRoot) break;
    current = current.parentElement;
  }
  return null;
}

export function setInputTargetProvider(
  element: HTMLElement,
  provider: EditorInputTargetProvider,
): () => void {
  const target = element as InputTargetProviderElement;
  target[EDITOR_INPUT_TARGET_PROVIDER] = provider;
  return () => {
    if (target[EDITOR_INPUT_TARGET_PROVIDER] === provider) {
      delete target[EDITOR_INPUT_TARGET_PROVIDER];
    }
  };
}
