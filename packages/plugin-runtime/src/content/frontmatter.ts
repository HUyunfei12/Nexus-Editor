import { JSON_SCHEMA, dump, load } from "js-yaml";
import type { JsonObject, JsonValue, MutableJsonObject } from "@floatboat/nexus-plugin-api";

const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export interface ParsedFrontmatterDocument {
  readonly frontmatter: MutableJsonObject;
  readonly body: string;
  readonly hasFrontmatter: boolean;
  readonly newline: "\n" | "\r\n";
}

function validateJsonValue(value: unknown, seen: WeakSet<object>): asserts value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Frontmatter numbers must be finite");
    return;
  }
  if (typeof value !== "object") {
    throw new TypeError(`Frontmatter contains non-JSON value '${typeof value}'`);
  }
  if (seen.has(value)) throw new TypeError("Frontmatter must not contain cycles");
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) validateJsonValue(item, seen);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Frontmatter objects must use a plain object prototype");
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new TypeError(`Frontmatter key '${key}' is not allowed`);
    }
    validateJsonValue(item, seen);
  }
}

export function cloneFrontmatter(value: unknown): MutableJsonObject {
  if (value === null || value === undefined) return {};
  validateJsonValue(value, new WeakSet<object>());
  if (Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Frontmatter root must be a mapping");
  }
  return JSON.parse(JSON.stringify(value)) as MutableJsonObject;
}

export function freezeFrontmatter(value: unknown): JsonObject | null {
  if (value === null || value === undefined) return null;
  const cloned = cloneFrontmatter(value);
  return deepFreezeJson(cloned) as JsonObject;
}

function deepFreezeJson(value: JsonValue): JsonValue {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      for (const item of value) deepFreezeJson(item);
    } else {
      for (const item of Object.values(value)) deepFreezeJson(item);
    }
    Object.freeze(value);
  }
  return value;
}

export function parseFrontmatterDocument(source: string): ParsedFrontmatterDocument {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const match = /^(?:\uFEFF)?---(?:\r?\n)([\s\S]*?)(?:\r?\n)---(?:\r?\n|$)/.exec(source);
  if (!match) {
    return { frontmatter: {}, body: source, hasFrontmatter: false, newline };
  }
  const parsed = match[1].trim().length === 0
    ? {}
    : load(match[1], { schema: JSON_SCHEMA, json: true });
  return {
    frontmatter: cloneFrontmatter(parsed),
    body: source.slice(match[0].length),
    hasFrontmatter: true,
    newline,
  };
}

export function serializeFrontmatterDocument(
  frontmatter: MutableJsonObject,
  body: string,
  newline: "\n" | "\r\n" = "\n",
): string {
  const snapshot = cloneFrontmatter(frontmatter);
  const yaml = dump(snapshot, {
    schema: JSON_SCHEMA,
    noRefs: true,
    lineWidth: -1,
    noCompatMode: true,
  }).replace(/\n$/, "").replace(/\n/g, newline);
  return `---${newline}${yaml}${newline}---${newline}${body}`;
}
