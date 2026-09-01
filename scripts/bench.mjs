#!/usr/bin/env node
/**
 * Core performance benchmark — real-browser (Chromium via Playwright).
 *
 * Serves the e2e harness, loads it once, then times the operations that
 * dominate notebook-scale editing through `window.__nexus`:
 *   setDocument:1k  replace whole doc with a ~1k-line markdown table
 *   edit:100        100 incremental edits (repeat setDocument over a 1k table)
 *   exportHTML:1k   render built HTML of the 1k-line doc
 *
 * Default: prints a table. Pass `--json` for machine output. With
 * `--budget scripts/bench-budgets.json` it fails (exit != 0) when any metric
 * exceeds its budget — the CI quality gate.
 *
 * Run `pnpm bench:core` (spins up the vite server itself).
 */
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const BASE = readFlag("--base") ?? "http://localhost:5183";
const BUDGET_PATH = readFlag("--budget");

function readFlag(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : null;
}

function loadBudgets() {
  if (!BUDGET_PATH || !existsSync(BUDGET_PATH)) return null;
  return JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const budgets = loadBudgets();
  const server = spawn(
    process.platform === "win32" ? "cmd" : "pnpm",
    process.platform === "win32" ? ["/c", "pnpm e2e:serve"] : ["e2e:serve"],
    { stdio: "ignore" }
  );
  try {
    await sleep(4000);
    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForSelector(".nexus-table-wrapper");

    const makeDoc = (lines) =>
      Array.from({ length: lines }, (_, i) => `| r${i} | value ${i} |`).join("\n");
    const doc1k = makeDoc(1000);

    const metrics = {};

    metrics["setDocument:1k"] = await page.evaluate((doc) => {
      const t = performance.now();
      window.__nexus.setDocument(doc);
      return performance.now() - t;
    }, doc1k);

    metrics["exportHTML:1k"] = await page.evaluate(() => {
      const t = performance.now();
      window.__nexus.exportHTML();
      return performance.now() - t;
    });

    metrics["edit:100"] = await page.evaluate((doc) => {
      const t = performance.now();
      for (let i = 0; i < 100; i++) {
        window.__nexus.setDocument(doc.replace("value " + i, "v" + i));
      }
      return performance.now() - t;
    }, doc1k);

    await browser.close();

    if (budgets) applyBudget(metrics, budgets);

    if (process.argv.includes("--json")) {
      process.stdout.write(JSON.stringify(metrics, null, 2) + "\n");
    } else {
      console.log("core benchmark (ms) — real Chromium run");
      for (const [k, v] of Object.entries(metrics)) {
        console.log(`  ${k.padEnd(18)} ${v.toFixed(1)}`);
      }
    }
  } finally {
    server.kill();
  }
}

function applyBudget(metrics, budgets) {
  let failed = false;
  for (const [key, budget] of Object.entries(budgets)) {
    if (typeof metrics[key] !== "number") continue;
    if (metrics[key] > budget) {
      failed = true;
      console.error(`[budget] ${key} ${metrics[key].toFixed(1)}ms exceeds ${budget}ms`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});