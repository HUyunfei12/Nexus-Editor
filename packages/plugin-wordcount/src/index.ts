export {
  countMarkdown,
  countMarkdownAsync,
  type CjkUnit,
  type ReadingSpeed,
  type WordCountOptions,
  type WordCountStats
} from "./count";

export {
  createWordCountPlugin,
  attachWordCountPlugin,
  type Unsubscribe,
  type WordCountAPI,
  type WordCountPlugin,
  type WordCountPluginOptions,
  type WordCountState
} from "./plugin";

export {
  createStatusBar,
  defaultStatusBarLabels,
  type StatusBarHandle,
  type StatusBarOptions,
  type WordCountLabels
} from "./status-bar";

export {
  WordCountLifecyclePlugin,
  wordCountLifecyclePluginManifest,
  type EditorWordCountListener,
  type EditorWordCountState,
  type WordCountLifecyclePluginOptions,
} from "./runtime-plugin";
