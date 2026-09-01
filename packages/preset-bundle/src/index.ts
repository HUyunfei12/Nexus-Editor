import type { NexusPlugin, SlashCommandDef } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import type { SearchPluginOptions } from "@floatboat/nexus-plugin-search";
import { createSlashPlugin } from "@floatboat/nexus-plugin-slash";
import { createToolbarPlugin } from "@floatboat/nexus-plugin-toolbar";
import { createMathPlugin } from "@floatboat/nexus-plugin-math";
import { createVimPlugin } from "@floatboat/nexus-plugin-vim";
import { createWordCountPlugin } from "@floatboat/nexus-plugin-wordcount";
import type { WordCountPluginOptions } from "@floatboat/nexus-plugin-wordcount";

export interface PresetBundleOptions {
  /** GitHub-Flavored Markdown (tables, strikethrough, gfm autolinks). Default: true. */
  gfm?: boolean;
  /** Fast cursor history / redo. Default: true. */
  history?: boolean;
  /** CodeMirror search panel (Ctrl+F). Default: true. */
  search?: boolean | SearchPluginOptions;
  /** Toolbar shortcuts (bold/italic/…) + color decoration. Default: false. */
  toolbar?: boolean;
  /** Slash menu with the given commands. Default: off (requires a command list). */
  slash?: SlashCommandDef[];
  /** KaTeX math rendering. Default: false (adds KaTeX to the bundle). */
  math?: boolean;
  /** Vim bindings. Default: false. */
  vim?: boolean;
  /** Word/reading-time count. Default: false. */
  wordCount?: boolean | WordCountPluginOptions;
}

/**
 * Assemble an ordered set of Nexus plugins from individual units. Enabled by
 * default are the safe, dependency-light units (gfm, history, search); heavier
 * or opinionated units (math, vim, wordCount, toolbar, slash) are opt-in so the
 * curated default stays small.
 */
export function createDefaultPreset(options: PresetBundleOptions = {}): NexusPlugin[] {
  const plugins: NexusPlugin[] = [];

  if (options.gfm !== false) {
    plugins.push(createGfmPreset());
  }
  if (options.history !== false) {
    plugins.push(createHistoryPlugin());
  }
  if (options.search !== false) {
    plugins.push(
      createSearchPlugin(
        options.search === true || options.search === undefined ? {} : options.search
      )
    );
  }
  if (options.toolbar) {
    plugins.push(createToolbarPlugin());
  }
  if (options.slash) {
    plugins.push(createSlashPlugin(options.slash));
  }
  if (options.math) {
    plugins.push(createMathPlugin());
  }
  if (options.vim) {
    plugins.push(createVimPlugin());
  }
  if (options.wordCount) {
    plugins.push(
      createWordCountPlugin(
        options.wordCount === true ? {} : options.wordCount
      )
    );
  }

  return plugins;
}

/**
 * Alias mirroring `createGfmPreset` for consumers who want GFM alone through this
 * package's surface (keeps imports to one package).
 */
export { createGfmPreset } from "@floatboat/nexus-preset-gfm";

export type { SearchPluginOptions } from "@floatboat/nexus-plugin-search";
export type { WordCountPluginOptions } from "@floatboat/nexus-plugin-wordcount";