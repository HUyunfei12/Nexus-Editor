import {
  bindComponentRuntime,
  getComponentRuntimeBridge,
  invokeComponentOnload,
  invokeComponentOnunload,
  NexusPluginError,
} from "@floatboat/nexus-plugin-api";
import type {
  ComponentId,
  ComponentLifecycleState,
  ManagedResource,
  ManagedResourceInput,
  NexusComponent,
  NexusComponentRuntimeBridge,
  NexusDiagnostic,
  PluginIdentity,
  Registration,
  RegistrationId,
  ResourceOwner,
  Subscription,
} from "@floatboat/nexus-plugin-api";
import { DiagnosticBus } from "../diagnostics";
import { PluginLoadError } from "./errors";
import { LifecycleRegistration } from "./registration";

export interface ComponentUnloadResult {
  readonly state: "unloaded" | "failed";
  readonly clean: boolean;
  readonly diagnostics: readonly NexusDiagnostic[];
}

export interface ComponentControllerOptions {
  readonly identity: PluginIdentity;
  readonly diagnostics?: DiagnosticBus;
}

interface CleanupFailure {
  readonly error: unknown;
  readonly controller: ComponentController;
  readonly resourceId?: string;
  readonly kind: "quiesce" | "hook" | "dispose";
}

type CleanupEntry =
  | { readonly kind: "registration"; readonly registration: LifecycleRegistration }
  | { readonly kind: "child"; readonly child: ComponentController };

class LoadTransaction {
  readonly controllers: ComponentController[] = [];
  readonly registrations: LifecycleRegistration[] = [];
  private readonly registrationSet = new Set<LifecycleRegistration>();

  addController(controller: ComponentController): void {
    if (!this.controllers.includes(controller)) this.controllers.push(controller);
    for (const registration of controller.registrationsSnapshot) this.addRegistration(registration);
  }

  addRegistration(registration: LifecycleRegistration): void {
    if (this.registrationSet.has(registration)) return;
    this.registrationSet.add(registration);
    this.registrations.push(registration);
  }
}

const componentControllers = new WeakMap<NexusComponent, ComponentController>();

function componentId(value: string): ComponentId {
  return value as ComponentId;
}

function registrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function createOwnershipError(message: string, identity: PluginIdentity, resourceId?: string): NexusPluginError {
  return new NexusPluginError({
    code: "component-ownership-invalid",
    severity: "error",
    phase: "runtime",
    message,
    plugin: { id: identity.id, version: identity.version },
    ...(resourceId ? { resourceId } : {}),
  });
}

/**
 * Owns one Component state machine. Root controllers are created by
 * ComponentLifecycleRuntime; child controllers are created only through the
 * parent's bridge, preserving a single-owner, acyclic tree.
 */
export class ComponentController implements NexusComponentRuntimeBridge {
  readonly owner: ResourceOwner;
  readonly component: NexusComponent;
  readonly identity: PluginIdentity;
  readonly diagnostics: DiagnosticBus;
  private currentState: ComponentLifecycleState = "constructed";
  private readonly children: ComponentController[] = [];
  private readonly registrations: LifecycleRegistration[] = [];
  private readonly cleanupEntries: CleanupEntry[] = [];
  private parentController: ComponentController | null;
  private childSequence = 0;
  private registrationSequence = 0;
  private transaction: LoadTransaction | null = null;
  private loadPromise?: Promise<void>;
  private unloadPromise?: Promise<ComponentUnloadResult>;
  private terminalFailureResult?: Promise<ComponentUnloadResult>;

  private constructor(
    component: NexusComponent,
    owner: ResourceOwner,
    identity: PluginIdentity,
    diagnostics: DiagnosticBus,
    parent: ComponentController | null,
  ) {
    this.component = component;
    this.owner = owner;
    this.identity = identity;
    this.diagnostics = diagnostics;
    this.parentController = parent;
    bindComponentRuntime(component, this);
    componentControllers.set(component, this);
  }

  static createRoot(component: NexusComponent, options: ComponentControllerOptions): ComponentController {
    return ComponentController.createOwnedRoot(component, options, {
      pluginId: options.identity.id,
      componentId: componentId(`${options.identity.id}/root`),
    });
  }

  static createOwnedRoot(
    component: NexusComponent,
    options: ComponentControllerOptions,
    owner: ResourceOwner,
  ): ComponentController {
    if (getComponentRuntimeBridge(component)) {
      throw createOwnershipError("The root component is already owned by a runtime.", options.identity);
    }
    if (owner.pluginId !== options.identity.id) {
      throw createOwnershipError(
        "The component owner must use the managed plugin identity.",
        options.identity,
        owner.componentId,
      );
    }
    const diagnostics = options.diagnostics ?? new DiagnosticBus();
    return new ComponentController(
      component,
      owner,
      options.identity,
      diagnostics,
      null,
    );
  }

  get state(): ComponentLifecycleState {
    return this.currentState;
  }

  get parent(): ComponentController | null {
    return this.parentController;
  }

  get childControllers(): readonly ComponentController[] {
    return this.children;
  }

  get registrationsSnapshot(): readonly LifecycleRegistration[] {
    return this.registrations;
  }

  load(): Promise<void> {
    if (this.currentState === "unloaded" || this.currentState === "failed" || this.currentState === "unloading") {
      return Promise.reject(this.invalidTransition("load"));
    }
    if (this.loadPromise) return this.loadPromise;
    if (this.currentState !== "constructed") {
      return Promise.reject(this.invalidTransition("load"));
    }
    const transaction = new LoadTransaction();
    this.loadPromise = this.loadRoot(transaction);
    return this.loadPromise;
  }

  unload(): Promise<ComponentUnloadResult> {
    if (this.unloadPromise) return this.unloadPromise;
    if (this.currentState === "failed") return this.failureResult();

    if (this.currentState === "loading" && this.loadPromise) {
      this.unloadPromise = this.loadPromise.then(
        () => this.performUnload(),
        () => this.failureResult(),
      );
      return this.unloadPromise;
    }

    if (this.currentState === "unloaded") {
      this.unloadPromise = Promise.resolve({ state: "unloaded", clean: true, diagnostics: [] });
      return this.unloadPromise;
    }

    let resolveUnload!: (result: ComponentUnloadResult) => void;
    let rejectUnload!: (error: unknown) => void;
    this.unloadPromise = new Promise<ComponentUnloadResult>((resolve, reject) => {
      resolveUnload = resolve;
      rejectUnload = reject;
    });
    void this.performUnload().then(resolveUnload, rejectUnload);
    return this.unloadPromise;
  }

  async addChild(child: NexusComponent): Promise<void> {
    this.assertCanChangeChildren("add");
    if (child === this.component) {
      throw createOwnershipError("A component cannot own itself.", this.identity, this.owner.componentId);
    }
    if (this.isAncestorComponent(child)) {
      throw createOwnershipError("Adding this child would create a component ownership cycle.", this.identity);
    }
    const existing = componentControllers.get(child);
    if (existing) {
      if (existing.parentController === this && this.children.includes(existing)) return;
      throw createOwnershipError("A component can have only one owner.", this.identity, existing.owner.componentId);
    }
    if (getComponentRuntimeBridge(child)) {
      throw createOwnershipError("A component can have only one runtime owner.", this.identity);
    }

    const childController = new ComponentController(
      child,
      {
        pluginId: this.owner.pluginId,
        componentId: componentId(`${this.owner.componentId}/${++this.childSequence}`),
      },
      this.identity,
      this.diagnostics,
      this,
    );
    this.children.push(childController);
    this.cleanupEntries.push({ kind: "child", child: childController });

    if (this.currentState === "loaded") {
      try {
        await childController.load();
      } catch (error) {
        this.detachChildController(childController);
        throw error;
      }
    }
  }

  async removeChild(child: NexusComponent): Promise<void> {
    const childController = componentControllers.get(child);
    if (!childController || childController.parentController !== this || !this.children.includes(childController)) {
      throw createOwnershipError("The component is not a child of this owner.", this.identity);
    }
    await childController.unload();
    this.detachChildController(childController);
  }

  register(input: ManagedResourceInput): Registration {
    const id = registrationId(`${this.owner.componentId}:resource:${++this.registrationSequence}`);
    const registration = new LifecycleRegistration({ id, owner: this.owner, input });

    if (this.isQuiescingOrTerminal()) {
      if (this.currentState === "unloading") {
        this.registrations.push(registration);
        this.cleanupEntries.push({ kind: "registration", registration });
      }
      const diagnostic = this.diagnostics.emit({
        code: "resource-late-registration",
        phase: this.currentState === "failed" ? "rollback" : "unloading",
        message: "A resource was registered after its component stopped accepting resources.",
        identity: this.identity,
        resourceId: id,
        details: { componentId: this.owner.componentId, state: this.currentState },
      });
      void registration.dispose().catch((error) => {
        if (this.currentState === "unloading") return;
        this.diagnostics.emit({
          code: "lifecycle-cleanup-failed",
          phase: this.currentState === "failed" ? "rollback" : "unloading",
          message: "A late-registered resource failed during immediate cleanup.",
          identity: this.identity,
          resourceId: id,
          cause: error,
          details: { lateRegistrationDiagnostic: diagnostic.code },
        });
      });
      return registration;
    }

    this.registrations.push(registration);
    this.cleanupEntries.push({ kind: "registration", registration });
    this.transaction?.addRegistration(registration);
    if (this.currentState === "loaded") {
      void registration.activate().catch(async (error) => {
        this.diagnostics.emit({
          code: "callback-failed",
          phase: "runtime",
          message: "A resource failed to activate after its component was loaded.",
          identity: this.identity,
          resourceId: id,
          cause: error,
        });
        try {
          await registration.dispose();
        } catch (cleanupError) {
          this.reportCleanupFailure({
            controller: this,
            resourceId: id,
            error: cleanupError,
            kind: "dispose",
          });
        }
      });
    }
    return registration;
  }

  registerEvent(subscription: Subscription): Subscription {
    this.register(subscription as ManagedResource);
    return subscription;
  }

  registerDomEvent<TEvent extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: TEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): Registration {
    const eventListener: EventListener = (event) => listener(event as TEvent);
    let attached = false;
    return this.register({
      activate: () => {
        if (attached) return;
        target.addEventListener(type, eventListener, options);
        attached = true;
      },
      quiesce: () => {
        if (!attached) return;
        target.removeEventListener(type, eventListener, options);
        attached = false;
      },
      dispose: () => {
        if (!attached) return;
        target.removeEventListener(type, eventListener, options);
        attached = false;
      },
    });
  }

  registerInterval(id: number): Registration {
    return this.register(() => clearInterval(id));
  }

  registerTimeout(id: number): Registration {
    return this.register(() => clearTimeout(id));
  }

  private async loadRoot(transaction: LoadTransaction): Promise<void> {
    try {
      await this.loadInto(transaction);
      for (const registration of transaction.registrations) {
        await registration.activate();
      }
      for (const controller of transaction.controllers) {
        controller.transaction = null;
        controller.currentState = "loaded";
      }
    } catch (error) {
      await this.rollbackLoad(transaction, error);
    }
  }

  private async loadInto(transaction: LoadTransaction): Promise<void> {
    if (this.currentState !== "constructed") throw this.invalidTransition("load");
    this.currentState = "loading";
    this.transaction = transaction;
    transaction.addController(this);

    await invokeComponentOnload(this.component);

    // Children added during onload remain staged until the hook completes, so
    // existing and new children are loaded exactly once in insertion order.
    for (let index = 0; index < this.children.length; index += 1) {
      const child = this.children[index]!;
      await child.loadInto(transaction);
    }
  }

  private async rollbackLoad(transaction: LoadTransaction, loadError: unknown): Promise<never> {
    const rollbackControllers = this.collectTreeControllers();
    for (const controller of rollbackControllers) {
      controller.currentState = "failed";
      controller.transaction = null;
    }

    const cleanupFailures: CleanupFailure[] = [];
    this.quiesceTree(cleanupFailures);
    await this.disposeLedger(cleanupFailures);

    const diagnostics: NexusDiagnostic[] = [
      this.diagnostics.emit({
        code: "plugin-load-failed",
        phase: "loading",
        message: "The plugin failed to load and its staged resources were rolled back.",
        identity: this.identity,
        resourceId: this.owner.componentId,
        cause: loadError,
        details: { componentPath: this.failingComponentPath(transaction) },
      }),
    ];
    for (const failure of cleanupFailures) diagnostics.push(this.reportCleanupFailure(failure, "rollback"));

    const result: ComponentUnloadResult = {
      state: "failed",
      clean: cleanupFailures.length === 0,
      diagnostics,
    };
    this.terminalFailureResult = Promise.resolve(result);
    throw new PluginLoadError(
      `Plugin ${this.identity.id} failed to load.`,
      loadError,
      cleanupFailures.map((failure) => failure.error),
      diagnostics,
    );
  }

  private async performUnload(): Promise<ComponentUnloadResult> {
    if (this.currentState === "failed") return this.failureResult();
    if (this.currentState !== "constructed" && this.currentState !== "loaded") {
      throw this.invalidTransition("unload");
    }

    const failures: CleanupFailure[] = [];
    const loadedControllers = new Set<ComponentController>();
    this.captureLoadedAndMarkUnloading(loadedControllers);
    this.quiesceTree(failures);
    await this.runUnloadHooks(loadedControllers, failures);
    await this.disposeLedger(failures);
    this.markTreeUnloaded();

    const diagnostics = failures.map((failure) => this.reportCleanupFailure(failure, "unloading"));
    if (failures.length > 0) {
      diagnostics.unshift(
        this.diagnostics.emit({
          code: "plugin-unload-failed",
          phase: "unloading",
          message: "The plugin was unloaded, but one or more cleanup operations failed.",
          identity: this.identity,
          resourceId: this.owner.componentId,
          details: { cleanupErrorCount: failures.length },
        }),
      );
    }
    return { state: "unloaded", clean: failures.length === 0, diagnostics };
  }

  private captureLoadedAndMarkUnloading(loaded: Set<ComponentController>): void {
    if (this.currentState === "loaded") loaded.add(this);
    this.currentState = "unloading";
    for (const child of this.children) child.captureLoadedAndMarkUnloading(loaded);
  }

  private quiesceTree(failures: CleanupFailure[]): void {
    for (const registration of this.registrations) {
      try {
        registration.quiesce();
      } catch (error) {
        failures.push({ controller: this, resourceId: registration.id, error, kind: "quiesce" });
      }
    }
    for (const child of this.children) child.quiesceTree(failures);
  }

  private async runUnloadHooks(
    loadedControllers: ReadonlySet<ComponentController>,
    failures: CleanupFailure[],
  ): Promise<void> {
    for (let index = this.children.length - 1; index >= 0; index -= 1) {
      await this.children[index]!.runUnloadHooks(loadedControllers, failures);
    }

    if (loadedControllers.has(this)) {
      try {
        await invokeComponentOnunload(this.component);
      } catch (error) {
        failures.push({ controller: this, error, kind: "hook" });
      }
    }
  }

  private async disposeLedger(failures: CleanupFailure[]): Promise<void> {
    for (let index = this.cleanupEntries.length - 1; index >= 0; index -= 1) {
      const entry = this.cleanupEntries[index]!;
      if (entry.kind === "child") {
        await entry.child.disposeLedger(failures);
        continue;
      }
      try {
        await entry.registration.dispose();
      } catch (error) {
        failures.push({
          controller: this,
          resourceId: entry.registration.id,
          error,
          kind: "dispose",
        });
      }
    }
  }

  private markTreeUnloaded(): void {
    this.currentState = "unloaded";
    this.transaction = null;
    for (const child of this.children) child.markTreeUnloaded();
  }

  private failureResult(): Promise<ComponentUnloadResult> {
    if (!this.terminalFailureResult) {
      this.terminalFailureResult = Promise.resolve({ state: "failed", clean: true, diagnostics: [] });
    }
    return this.terminalFailureResult;
  }

  private detachChildController(child: ComponentController): void {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    const cleanupIndex = this.cleanupEntries.findIndex(
      (entry) => entry.kind === "child" && entry.child === child,
    );
    if (cleanupIndex >= 0) this.cleanupEntries.splice(cleanupIndex, 1);
    child.parentController = null;
  }

  private isAncestorComponent(candidate: NexusComponent): boolean {
    let controller: ComponentController | null = this;
    while (controller) {
      if (controller.component === candidate) return true;
      controller = controller.parentController;
    }
    return false;
  }

  private assertCanChangeChildren(operation: "add" | "remove"): void {
    if (this.isQuiescingOrTerminal()) {
      throw createOwnershipError(
        `Cannot ${operation} a child while the owner is ${this.currentState}.`,
        this.identity,
        this.owner.componentId,
      );
    }
  }

  private isQuiescingOrTerminal(): boolean {
    return this.currentState === "unloading" || this.currentState === "unloaded" || this.currentState === "failed";
  }

  private invalidTransition(operation: string): NexusPluginError {
    const diagnostic = this.diagnostics.emit({
      code: "lifecycle-invalid-transition",
      phase: "runtime",
      message: `Cannot ${operation} a component in state ${this.currentState}.`,
      identity: this.identity,
      resourceId: this.owner.componentId,
      details: { operation, state: this.currentState },
    });
    return new NexusPluginError(diagnostic);
  }

  private reportCleanupFailure(
    failure: CleanupFailure,
    phase: "rollback" | "unloading" = "unloading",
  ): NexusDiagnostic {
    return this.diagnostics.emit({
      code: "lifecycle-cleanup-failed",
      phase,
      message: `A component ${failure.kind} cleanup operation failed.`,
      identity: this.identity,
      resourceId: failure.resourceId ?? failure.controller.owner.componentId,
      cause: failure.error,
      details: {
        componentId: failure.controller.owner.componentId,
        cleanupKind: failure.kind,
      },
    });
  }

  private findController(id: ComponentId): ComponentController | undefined {
    if (this.owner.componentId === id) return this;
    for (const child of this.children) {
      const result = child.findController(id);
      if (result) return result;
    }
    return undefined;
  }

  private collectTreeControllers(result: ComponentController[] = []): ComponentController[] {
    result.push(this);
    for (const child of this.children) child.collectTreeControllers(result);
    return result;
  }

  private failingComponentPath(transaction: LoadTransaction): string {
    const lastStarted = transaction.controllers.at(-1);
    return lastStarted?.owner.componentId ?? this.owner.componentId;
  }
}

export class ComponentLifecycleRuntime {
  readonly diagnostics: DiagnosticBus;

  constructor(diagnostics = new DiagnosticBus()) {
    this.diagnostics = diagnostics;
  }

  manage(component: NexusComponent, identity: PluginIdentity): ComponentController {
    return ComponentController.createRoot(component, { identity, diagnostics: this.diagnostics });
  }

  manageOwned(
    component: NexusComponent,
    identity: PluginIdentity,
    owner: ResourceOwner,
  ): ComponentController {
    return ComponentController.createOwnedRoot(
      component,
      { identity, diagnostics: this.diagnostics },
      owner,
    );
  }

  get(component: NexusComponent): ComponentController | undefined {
    return componentControllers.get(component);
  }
}
