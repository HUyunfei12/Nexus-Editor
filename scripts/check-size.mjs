// Bundle-size budget check for the packaged library entry points.
// Run `pnpm build` first, then `node scripts/check-size.mjs`.
//
// Budgets are in bytes (raw, uncompressed dist file). Raise a budget only with
// a deliberate, reviewed reason — the goal is to catch accidental bloat (new
// deps, non-tree-shaken code pulled into an entry).
//
// Usage:
//   node scripts/check-size.mjs            # check all entries
//   node scripts/check-size.mjs --write    # print & write current sizes as new budgets
//   node scripts/check-size.mjs --report   # only print sizes, never fail

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// name -> budget bytes. Keep in sync with packages/*/package.json `files`.
const DEFAULT_BUDGETS = {
  "packages/core/dist/index.js": 1250_000,
  "packages/react/dist/index.js": 350_000,
  "packages/vue/dist/index.js": 350_000,
  "packages/preset-gfm/dist/index.js": 250_000,
};

const BUDGET_FILE = path.join(__dirname, "bundle-budgets.json");

function loadBudgets() {
  if (fs.existsSync(BUDGET_FILE)) {
    return JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
  }
  return { ...DEFAULT_BUDGETS };
}

function sizeOf(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.statSync(abs).size;
}

const budgets = loadBudgets();
const write = process.argv.includes("--write");
const reportOnly = process.argv.includes("--report");

let failed = false;
const lines = [];
for (const rel of Object.keys(budgets)) {
  const size = sizeOf(rel);
  const budget = budgets[rel];
  const label = size === null ? "MISSING" : `${(size / 1000).toFixed(1)} kB`;
  const line = `${rel.padEnd(40)} ${label.padStart(12)}  budget ${(budget / 1000).toFixed(1)} kB`;
  lines.push(line);
  if (size === null) {
    failed = true;
    continue;
  }
  if (!reportOnly && size > budget) {
    failed = true;
    lines.push("  ^ exceeds budget! Shrink deps, split subpath exports, or raise the budget deliberately.");
  }
}

console.log(lines.join("\n"));

if (write) {
  const next = {};
  for (const rel of Object.keys(budgets)) {
    next[rel] = sizeOf(rel) ?? budgets[rel];
  }
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(next, null, 2) + "\n");
  console.log("\nWrote bundle-budgets.json");
}

if (failed && !reportOnly && !write) {
  console.error("\nBundle budget exceeded.");
  process.exit(1);
}