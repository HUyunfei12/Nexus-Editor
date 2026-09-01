import type { SlashCommandDef } from "@floatboat/nexus-core";
import { describe, expect, it } from "vitest";

import { createDefaultPreset } from "../src/index";

describe("@floatboat/nexus-preset-bundle", () => {
  it("defaults to gfm + history + search in stable order", () => {
    const preset = createDefaultPreset();
    expect(preset.map((p) => p.name)).toEqual([
      "preset-gfm",
      "plugin-history",
      "plugin-search"
    ]);
  });

  it("turns off every default unit", () => {
    const preset = createDefaultPreset({
      gfm: false,
      history: false,
      search: false
    });
    expect(preset).toEqual([]);
  });

  it("adds opt-in toolbar, math, vim and word-count units", () => {
    const preset = createDefaultPreset({
      toolbar: true,
      math: true,
      vim: true,
      wordCount: true
    });
    const names = preset.map((p) => p.name);
    expect(names).toContain("plugin-toolbar");
    expect(names).toContain("plugin-math");
    expect(names).toContain("plugin-vim");
    expect(names).toContain("plugin-wordcount");
  });

  it("creates a slash plugin from the provided commands", () => {
    const commands: SlashCommandDef[] = [
      { id: "h1", title: "Heading 1", run: () => true },
      { id: "bold", title: "Bold", run: () => true }
    ];
    const preset = createDefaultPreset({ slash: commands });
    const slash = preset.find((p) => p.name === "plugin-slash");
    expect(slash).toBeDefined();
  });

  it("forwards search options object instead of replacing it", () => {
    const preset = createDefaultPreset({ search: { top: false, caseSensitive: true } });
    expect(preset.find((p) => p.name === "plugin-search")).toBeDefined();
  });
});