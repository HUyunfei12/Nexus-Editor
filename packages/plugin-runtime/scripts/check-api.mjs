import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const declarationPath = new URL("../dist/index.d.ts", import.meta.url);
const runtimePath = new URL("../dist/index.js", import.meta.url);
const snapshotPath = new URL("../api/public-exports.json", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

async function readUtf8(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing ${fileURLToPath(path)}. Build the package and refresh its API snapshot.`);
    }
    throw error;
  }
}

function collectExports(declaration) {
  const names = new Set();
  const declarationPattern = /export\s+(?:declare\s+)?(?:abstract\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of declaration.matchAll(declarationPattern)) names.add(match[1]);
  const exportPattern = /export\s*\{([\s\S]*?)\}\s*(?:from\s*['"][^'"]+['"])?\s*;/g;
  for (const match of declaration.matchAll(exportPattern)) {
    for (const rawSpecifier of match[1].split(",")) {
      const specifier = rawSpecifier.trim().replace(/^type\s+/, "");
      if (specifier.length === 0) continue;
      const alias = specifier.match(/\s+as\s+([^\s]+)$/)?.[1];
      names.add(alias ?? specifier.split(/\s+/)[0]);
    }
  }
  return [...names].sort();
}

function collectModuleSpecifiers(declaration) {
  return [...declaration.matchAll(/(?:\bfrom\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .sort();
}

const writeSnapshot = process.argv.includes("--write");
const [declaration, runtime, packageJson] = await Promise.all([
  readUtf8(declarationPath),
  readUtf8(runtimePath),
  readUtf8(packagePath),
]);
const actualExports = collectExports(declaration);

const expectedExports = writeSnapshot ? actualExports : JSON.parse(await readUtf8(snapshotPath));

if (!writeSnapshot && JSON.stringify(actualExports) !== JSON.stringify(expectedExports)) {
  throw new Error(
    `Public API snapshot changed.\nExpected: ${JSON.stringify(expectedExports)}\nActual: ${JSON.stringify(actualExports)}`,
  );
}

const packageMetadata = JSON.parse(packageJson);
const allowedModules = new Set([
  ...Object.keys(packageMetadata.dependencies ?? {}),
  ...Object.keys(packageMetadata.peerDependencies ?? {}),
]);
for (const dependency of [...allowedModules]) {
  if (dependency.startsWith("@types/")) allowedModules.add(dependency.slice("@types/".length));
}
const forbiddenModules = collectModuleSpecifiers(declaration).filter((specifier) => {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) {
    return true;
  }
  return !allowedModules.has(specifier);
});
if (forbiddenModules.length > 0) {
  throw new Error(
    `Public declarations contain undeclared or non-browser module references: ${forbiddenModules.join(", ")}`,
  );
}

if (/\b(?:NodeJS|Electron)\s*\.|\b(?:Buffer|BufferEncoding)(?:<|\b)|node:|\bimport\s*\(\s*['"](?:electron|node:)/.test(declaration)) {
  throw new Error("Public declarations leak Node.js or Electron types.");
}

if (/\brequire\s*\(\s*['"]|\bprocess\s*(?:\.|\[)|\bglobalThis\s*\.\s*process\b|\bBuffer\b|(?:from\s*|import\s*\()\s*['"]node:|from\s*['"](?:electron|fs|path|child_process)['"]/.test(runtime)) {
  throw new Error("The browser runtime bundle contains Node.js or Electron references.");
}

if (writeSnapshot) {
  await writeFile(snapshotPath, `${JSON.stringify(actualExports, null, 2)}\n`, "utf8");
  console.log(`Updated ${fileURLToPath(snapshotPath)} (${actualExports.length} exports).`);
}
