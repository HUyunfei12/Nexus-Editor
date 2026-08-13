import type {
  HotkeyBinding,
  HotkeyModifier,
} from "@floatboat/nexus-plugin-api";

export type HotkeyPlatform = "macos" | "windows" | "linux";

const MODIFIER_ORDER: readonly HotkeyModifier[] = [
  "Mod",
  "Ctrl",
  "Meta",
  "Alt",
  "Shift",
];

const KEY_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  " ": "space",
  arrowdown: "arrowdown",
  arrowleft: "arrowleft",
  arrowright: "arrowright",
  arrowup: "arrowup",
  del: "delete",
  esc: "escape",
  return: "enter",
  spacebar: "space",
});

function canonicalKey(key: string): string {
  const trimmed = key.trim();
  if (key === " ") return "space";
  if (trimmed.length === 0) throw new TypeError("A hotkey must include a key");
  const lowered = trimmed.toLocaleLowerCase("en-US");
  return KEY_ALIASES[lowered] ?? lowered;
}

function canonicalModifiers(
  modifiers: readonly HotkeyModifier[] | undefined,
): readonly HotkeyModifier[] {
  const values = new Set<HotkeyModifier>();
  for (const modifier of modifiers ?? []) {
    if (!MODIFIER_ORDER.includes(modifier)) {
      throw new TypeError(`Unknown hotkey modifier '${String(modifier)}'`);
    }
    values.add(modifier);
  }
  return Object.freeze(MODIFIER_ORDER.filter((modifier) => values.has(modifier)));
}

/** Normalizes user/plugin data without resolving the portable Mod modifier. */
export function normalizeSemanticHotkey(binding: HotkeyBinding): HotkeyBinding {
  return Object.freeze({
    key: canonicalKey(binding.key),
    modifiers: canonicalModifiers(binding.modifiers),
  });
}

export function normalizeHotkeyBinding(
  binding: HotkeyBinding,
  platform: HotkeyPlatform,
): HotkeyBinding {
  const semantic = normalizeSemanticHotkey(binding);
  const resolved = new Set<HotkeyModifier>();
  for (const modifier of semantic.modifiers ?? []) {
    if (modifier === "Mod") {
      resolved.add(platform === "macos" ? "Meta" : "Ctrl");
    } else {
      resolved.add(modifier);
    }
  }
  return Object.freeze({
    key: semantic.key,
    modifiers: Object.freeze(
      MODIFIER_ORDER.filter(
        (modifier) => modifier !== "Mod" && resolved.has(modifier),
      ),
    ),
  });
}

export function hotkeyToString(
  binding: HotkeyBinding,
  platform: HotkeyPlatform,
): string {
  const normalized = normalizeHotkeyBinding(binding, platform);
  return [...(normalized.modifiers ?? []), normalized.key].join("+");
}

export function keyboardEventToHotkey(
  event: KeyboardEvent,
  platform: HotkeyPlatform,
): string {
  const modifiers: HotkeyModifier[] = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.metaKey) modifiers.push("Meta");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  return hotkeyToString({ key: event.key, modifiers }, platform);
}

export function normalizeSemanticHotkeys(
  bindings: readonly HotkeyBinding[] | undefined,
): readonly HotkeyBinding[] {
  const result: HotkeyBinding[] = [];
  const seen = new Set<string>();
  for (const binding of bindings ?? []) {
    const normalized = normalizeSemanticHotkey(binding);
    const key = [...(normalized.modifiers ?? []), normalized.key].join("+");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return Object.freeze(result);
}
