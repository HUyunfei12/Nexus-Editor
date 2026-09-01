import { createEditor, darkTheme, lightTheme } from "@floatboat/nexus-core";
import { createGfmPreset } from "@floatboat/nexus-preset-gfm";
import { createHistoryPlugin } from "@floatboat/nexus-plugin-history";
import { createSearchPlugin } from "@floatboat/nexus-plugin-search";
import { createToolbarPlugin } from "@floatboat/nexus-plugin-toolbar";
import { createWordCountPlugin } from "@floatboat/nexus-plugin-wordcount";

const editor = createEditor({
  container: document.getElementById("editor")!,
  initialValue: "| Name | Status |\n| --- | --- |\n| Alpha | Todo |\n| Beta | Done |",
  livePreview: true,
  theme: lightTheme,
  plugins: [
    createGfmPreset(),
    createHistoryPlugin(),
    createSearchPlugin(),
    createToolbarPlugin(),
    createWordCountPlugin()
  ]
});

const readout = document.getElementById("readout")!;
const syncReadout = () => {
  readout.textContent = editor.getDocument();
};
syncReadout();
editor.on("change", syncReadout);

function baseFontColor(): string {
  const el = document.querySelector(".cm-content");
  return el ? getComputedStyle(el).color : "";
}

declare global {
  interface Window {
    __nexus: {
      getDocument(): string;
      setDocument(md: string): void;
      exportHTML(): string;
      setTheme(kind: "light" | "dark"): void;
      fontColor(): string;
      tableCount(): number;
    };
  }
}

const dark = darkTheme;
const light = lightTheme;

(window as unknown as { __nexus: Window["__nexus"] }).__nexus = {
  getDocument: () => editor.getDocument(),
  setDocument: (md: string) => editor.setDocument(md),
  exportHTML: () => editor.exportHTML(),
  setTheme: (kind) => {
    editor.setTheme(kind === "dark" ? dark : light);
  },
  fontColor: baseFontColor,
  tableCount: () => document.querySelectorAll(".nexus-table-wrapper").length
};