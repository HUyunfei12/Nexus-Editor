import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, "harness"),
  base: "./",
  server: {
    port: 5183,
    strictPort: true
  },
  resolve: {
    alias: {
      "@floatboat/nexus-core": path.resolve(__dirname, "../packages/core/src/index.ts"),
      "@floatboat/nexus-plugin-api": path.resolve(__dirname, "../packages/plugin-api/src/index.ts"),
      "@floatboat/nexus-plugin-runtime": path.resolve(__dirname, "../packages/plugin-runtime/src/index.ts"),
      "@floatboat/nexus-preset-gfm": path.resolve(__dirname, "../packages/preset-gfm/src/index.ts"),
      "@floatboat/nexus-plugin-history": path.resolve(__dirname, "../packages/plugin-history/src/index.ts"),
      "@floatboat/nexus-plugin-search": path.resolve(__dirname, "../packages/plugin-search/src/index.ts"),
      "@floatboat/nexus-plugin-toolbar": path.resolve(__dirname, "../packages/plugin-toolbar/src/index.ts"),
      "@floatboat/nexus-plugin-wordcount": path.resolve(__dirname, "../packages/plugin-wordcount/src/index.ts")
    }
  }
});