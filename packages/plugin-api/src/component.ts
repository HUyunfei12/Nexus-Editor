import type { NexusApp } from "./app";
import type { NexusDiagnostic } from "./diagnostics";
import { NexusPluginError } from "./diagnostics";
import type { PluginIdentity, NormalizedPluginManifest } from "./manifest";
import type { Disposer, Registration, ResourceOwner, Subscription } from "./ownership";

export type ComponentLifecycleState =
  | "constructed"
  | "loading"
  | "loaded"
  | "unloading"
  | "unloaded"
  | "failed";

export interface ManagedResource {
  activate?(): void | Promise<void>;
  quiesce?(): void;
  dispose(): void | Promise<void>;
}

export type ManagedResourceInput = Disposer | ManagedResource;

export interface NexusComponentRuntimeBridge {
  readonly owner: ResourceOwner;
  readonly state: ComponentLifecycleState;
  addChild(child: NexusComponent): Promise<void>;
  removeChild(child: NexusComponent): Promise<void>;
  register(resource: ManagedResourceInput): Registration;
  registerEvent(subscription: Subscription): Subscription;
  registerDomEvent<TEvent extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: TEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): Registration;
  registerInterval(id: number): Registration;
  registerTimeout(id: number): Registration;
}

const componentRuntimeBridges = new WeakMap<NexusComponent, NexusComponentRuntimeBridge>();

function unboundDiagnostic(): NexusDiagnostic {
  return {
    code: "component-runtime-not-bound",
    severity: "error",
    phase: "runtime",
    message: "The component is not bound to a Nexus plugin runtime.",
  };
}

/**
 * Base class for plugin-owned resources. Runtime-controlled load/unload entry
 * points are deliberately absent; plugins only override lifecycle hooks.
 */
export class NexusComponent {
  get lifecycleState(): ComponentLifecycleState {
    return componentRuntimeBridges.get(this)?.state ?? "constructed";
  }

  get owner(): ResourceOwner | undefined {
    return componentRuntimeBridges.get(this)?.owner;
  }

  onload(): void | Promise<void> {}

  onunload(): void | Promise<void> {}

  addChild<TChild extends NexusComponent>(child: TChild): Promise<TChild> {
    return this.runtime().addChild(child).then(() => child);
  }

  async removeChild<TChild extends NexusComponent>(child: TChild): Promise<TChild> {
    await this.runtime().removeChild(child);
    return child;
  }

  register(resource: ManagedResourceInput): Registration {
    return this.runtime().register(resource);
  }

  registerEvent<TSubscription extends Subscription>(subscription: TSubscription): TSubscription {
    return this.runtime().registerEvent(subscription) as TSubscription;
  }

  registerDomEvent<TEvent extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: TEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): Registration {
    return this.runtime().registerDomEvent(target, type, listener, options);
  }

  registerInterval(id: number): Registration {
    return this.runtime().registerInterval(id);
  }

  registerTimeout(id: number): Registration {
    return this.runtime().registerTimeout(id);
  }

  private runtime(): NexusComponentRuntimeBridge {
    const runtime = componentRuntimeBridges.get(this);
    if (!runtime) {
      throw new NexusPluginError(unboundDiagnostic());
    }
    return runtime;
  }
}

export class NexusPluginBase extends NexusComponent {
  readonly app!: NexusApp;
  readonly manifest!: NormalizedPluginManifest;
  readonly identity!: PluginIdentity;

  constructor(app: NexusApp, manifest: NormalizedPluginManifest) {
    super();
    Object.defineProperties(this, {
      app: { configurable: false, enumerable: true, value: app, writable: false },
      manifest: { configurable: false, enumerable: true, value: manifest, writable: false },
      identity: {
        configurable: false,
        enumerable: true,
        value: manifest.identity,
        writable: false,
      },
    });
  }
}

/** Runtime integration point. A component instance can be bound exactly once. */
export function bindComponentRuntime(
  component: NexusComponent,
  bridge: NexusComponentRuntimeBridge,
): void {
  if (componentRuntimeBridges.has(component)) {
    throw new NexusPluginError({
      code: "component-runtime-already-bound",
      severity: "error",
      phase: "runtime",
      message: "The component is already bound to a Nexus plugin runtime.",
    });
  }
  componentRuntimeBridges.set(component, bridge);
}

export function getComponentRuntimeBridge(
  component: NexusComponent,
): NexusComponentRuntimeBridge | undefined {
  return componentRuntimeBridges.get(component);
}

export function invokeComponentOnload(component: NexusComponent): void | Promise<void> {
  return component.onload();
}

export function invokeComponentOnunload(component: NexusComponent): void | Promise<void> {
  return component.onunload();
}
