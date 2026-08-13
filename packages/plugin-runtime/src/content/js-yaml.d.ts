declare module "js-yaml" {
  export interface LoadOptions {
    readonly schema?: unknown;
    readonly json?: boolean;
  }

  export interface DumpOptions {
    readonly schema?: unknown;
    readonly noRefs?: boolean;
    readonly lineWidth?: number;
    readonly noCompatMode?: boolean;
  }

  export const JSON_SCHEMA: unknown;
  export function load(input: string, options?: LoadOptions): unknown;
  export function dump(input: unknown, options?: DumpOptions): string;
}
