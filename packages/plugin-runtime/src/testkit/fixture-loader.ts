import type { HostEntrypointLoadRequest, HostPluginEntrypointResolver } from "../loader";

export class FixtureEntrypointResolver implements HostPluginEntrypointResolver {
  private readonly fixtures = new Map<string, unknown>();
  readonly requests: HostEntrypointLoadRequest[] = [];

  register(locator: string, entrypoint: string, moduleNamespace: unknown): () => void {
    const key = this.key(locator, entrypoint);
    if (this.fixtures.has(key)) throw new Error(`Plugin fixture '${key}' is already registered`);
    this.fixtures.set(key, moduleNamespace);
    return () => this.fixtures.delete(key);
  }

  async loadEntrypoint(request: HostEntrypointLoadRequest): Promise<unknown> {
    this.requests.push(request);
    const key = this.key(request.source.locator, request.entrypoint);
    if (!this.fixtures.has(key)) throw new RangeError(`Unknown plugin fixture '${key}'`);
    return this.fixtures.get(key);
  }

  private key(locator: string, entrypoint: string): string {
    return `${locator}\0${entrypoint}`;
  }
}
