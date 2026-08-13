import {
  NexusPluginError,
  type CapabilityDescriptor,
  type CapabilityHandle,
  type CapabilityId,
  type CapabilityRegistry,
  type CapabilityRequestContext,
  type CapabilityResolution,
  type CapabilityScope,
  type CapabilityToken,
  type ComponentId,
  type JsonObject,
  type ManagedResource,
  type NexusComponent,
  type NexusDiagnostic,
  type NormalizedPluginManifest,
  type PluginId,
  type RegistrationId,
  type ResourceOwner,
  type SemanticVersion,
  type SemanticVersionRange,
  type Subscription,
} from "@floatboat/nexus-plugin-api";
import { maxSatisfying, valid, validRange } from "semver";

export type PermissionDecision = "granted" | "denied";
export type PermissionDecisions = Readonly<Record<string, PermissionDecision>>;

export interface CapabilityProviderOptions {
  readonly requiredPermissions?: readonly string[];
  readonly context?: CapabilityRequestContext;
  readonly onHandleRevoked?: (context: CapabilityRevocationContext) => void | Promise<void>;
}

export interface OwnerBoundCapabilityContext {
  readonly manifest: NormalizedPluginManifest;
  readonly owner: ResourceOwner;
  registerResource<TResource extends ManagedResource>(resource: TResource): TResource;
}

export type OwnerBoundCapabilityFactory<TService> = (
  context: OwnerBoundCapabilityContext,
) => TService;

export interface CapabilityRevocationContext {
  readonly pluginId: PluginId;
  readonly capabilityId: CapabilityId;
  readonly reason: NexusDiagnostic;
}

export interface CapabilityProviderRegistration {
  readonly descriptor: CapabilityDescriptor;
  readonly revoked: boolean;
  revoke(reason?: string): Promise<void>;
}

interface Provider<TService = unknown> {
  readonly sequence: number;
  readonly descriptor: CapabilityDescriptor;
  readonly service?: TService;
  readonly createService?: OwnerBoundCapabilityFactory<TService>;
  readonly requiredPermissions: readonly string[];
  readonly context?: CapabilityRequestContext;
  readonly onHandleRevoked?: CapabilityProviderOptions["onHandleRevoked"];
  readonly handles: Set<RuntimeCapabilityHandle<TService>>;
  revoked: boolean;
}

function toCapabilityId(id: string): CapabilityId {
  return id as CapabilityId;
}

function capabilityDiagnostic(
  manifest: NormalizedPluginManifest,
  code: NexusDiagnostic["code"],
  message: string,
  id: string,
  requestedVersion: string,
  details?: JsonObject,
): NexusDiagnostic {
  return {
    code,
    severity: "error",
    phase: "validation",
    message,
    plugin: {
      id: manifest.identity.id,
      version: manifest.identity.version,
    },
    capability: {
      id: toCapabilityId(id),
      requestedVersion,
    },
    ...(details === undefined ? {} : { details }),
  };
}

function permissionRevokedDiagnostic(
  manifest: NormalizedPluginManifest,
  provider: Provider,
  reason: string,
): NexusDiagnostic {
  return {
    code: "permission-revoked",
    severity: "error",
    phase: "runtime",
    message: "The capability handle has been revoked and can no longer grant access.",
    plugin: {
      id: manifest.identity.id,
      version: manifest.identity.version,
    },
    capability: {
      id: provider.descriptor.id,
      actualVersion: provider.descriptor.version,
    },
    details: { reason },
  };
}

function sameContext(provider: CapabilityRequestContext | undefined, requested: CapabilityRequestContext): boolean {
  if (!provider) return true;
  for (const key of ["windowId", "workspaceId", "viewId", "editorId"] as const) {
    if (provider[key] !== undefined && provider[key] !== requested[key]) return false;
  }
  return true;
}

function hasRequiredScopeContext(scope: CapabilityScope, context: CapabilityRequestContext): boolean {
  if (scope === "window") return context.windowId !== undefined;
  if (scope === "workspace") return context.workspaceId !== undefined;
  if (scope === "view") return context.viewId !== undefined;
  if (scope === "editor") return context.editorId !== undefined;
  return true;
}

function frozenDescriptor(token: CapabilityToken<unknown>): CapabilityDescriptor {
  if (valid(token.version) === null) {
    throw new TypeError(`Capability ${token.id} must declare a valid semantic version.`);
  }
  return Object.freeze({
    id: toCapabilityId(token.id),
    version: token.version,
    scope: token.scope,
  });
}

function createSubscription(
  owner: ResourceOwner,
  eventName: string,
  registrationId: string,
  disposeCallback: () => void,
): Subscription {
  let disposed = false;
  return Object.freeze({
    id: registrationId as RegistrationId,
    owner,
    eventName,
    get state() {
      return disposed ? "disposed" as const : "active" as const;
    },
    get disposed() {
      return disposed;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposeCallback();
    },
  });
}

class RuntimeCapabilityHandle<TService> implements CapabilityHandle<TService> {
  readonly version: SemanticVersion;
  readonly scope: CapabilityScope;
  readonly grantedPermissions: readonly string[];
  readonly service: TService;

  private active = true;
  private reason: NexusDiagnostic | undefined;
  private subscriptionSequence = 0;
  private readonly subscriptions = new Map<number, (reason: NexusDiagnostic) => void>();
  private readonly pendingResources = new Set<ManagedResource>();
  private readonly managedResources = new Set<ManagedResource>();
  private ownerComponent: NexusComponent | null = null;

  constructor(
    readonly manifest: NormalizedPluginManifest,
    readonly provider: Provider<TService>,
  ) {
    this.version = provider.descriptor.version;
    this.scope = provider.descriptor.scope;
    this.grantedPermissions = provider.requiredPermissions;
    const rawService = provider.createService
      ? provider.createService(Object.freeze({
          manifest,
          owner: Object.freeze({
            pluginId: manifest.identity.id,
            componentId: `${manifest.identity.id}/root` as ComponentId,
          }),
          registerResource: <TResource extends ManagedResource>(resource: TResource): TResource => {
            this.registerOwnedResource(resource);
            return resource;
          },
        }))
      : provider.service;
    if ((typeof rawService !== "object" || rawService === null) && typeof rawService !== "function") {
      throw new TypeError(`Capability ${provider.descriptor.id} service factory returned an invalid service.`);
    }
    this.service = this.createRevocableService(rawService);
  }

  get revoked(): boolean {
    return !this.active;
  }

  assertAvailable(): TService {
    this.assertActive();
    return this.service;
  }

  onRevoked(handler: (reason: NexusDiagnostic) => void): Subscription {
    const id = ++this.subscriptionSequence;
    const owner: ResourceOwner = Object.freeze({
      pluginId: this.manifest.identity.id,
      componentId: `${this.manifest.identity.id}:capability-handle` as ComponentId,
    });
    if (!this.active && this.reason) {
      try {
        handler(this.reason);
      } catch {
        // A late observer cannot change or roll back revocation.
      }
      return createSubscription(owner, "revoked", `capability-revoked:${id}`, () => {});
    }
    this.subscriptions.set(id, handler);
    return createSubscription(owner, "revoked", `capability-revoked:${id}`, () => {
      this.subscriptions.delete(id);
    });
  }

  async revoke(reason: NexusDiagnostic): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.reason = reason;
    this.provider.handles.delete(this);

    const subscriptions = [...this.subscriptions.values()];
    this.subscriptions.clear();
    for (const handler of subscriptions) {
      try {
        handler(reason);
      } catch {
        // A revocation observer cannot keep a capability alive or block cleanup.
      }
    }
    const resources = [...this.managedResources, ...this.pendingResources].reverse();
    this.managedResources.clear();
    this.pendingResources.clear();
    const cleanupErrors: unknown[] = [];
    for (const resource of resources) {
      try {
        resource.quiesce?.();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const resource of resources) {
      try {
        await resource.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await this.provider.onHandleRevoked?.({
        pluginId: this.manifest.identity.id,
        capabilityId: this.provider.descriptor.id,
        reason,
      });
    } catch {
      // The provider cleanup boundary owns reporting; all other handles must still revoke.
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `Capability ${this.provider.descriptor.id} resource cleanup failed.`);
    }
  }

  bindOwner(component: NexusComponent): void {
    if (this.ownerComponent) return;
    this.ownerComponent = component;
    for (const resource of [...this.pendingResources]) {
      this.pendingResources.delete(resource);
      this.managedResources.add(component.register(resource) as ManagedResource);
    }
  }

  private registerOwnedResource(resource: ManagedResource): void {
    if (!resource || typeof resource.dispose !== "function") {
      throw new TypeError(`Capability ${this.provider.descriptor.id} registered an invalid managed resource.`);
    }
    if (!this.active) {
      void Promise.resolve(resource.dispose());
      throw new NexusPluginError(
        this.reason ?? permissionRevokedDiagnostic(this.manifest, this.provider, "revoked"),
      );
    }
    if (this.pendingResources.has(resource)) return;
    if (this.ownerComponent) {
      this.managedResources.add(this.ownerComponent.register(resource) as ManagedResource);
    } else {
      this.pendingResources.add(resource);
    }
  }

  private assertActive(): void {
    if (!this.active) {
      throw new NexusPluginError(
        this.reason ?? permissionRevokedDiagnostic(this.manifest, this.provider, "unknown"),
      );
    }
  }

  private createRevocableService(service: TService): TService {
    if ((typeof service !== "object" || service === null) && typeof service !== "function") {
      return service;
    }

    const methodCache = new Map<PropertyKey, { original: Function; wrapped: Function }>();
    const assertActive = () => this.assertActive();
    const source = service as object;
    // A frozen service cannot be the Proxy target: returning revocation-aware
    // method wrappers for its non-configurable properties violates Proxy
    // invariants. Object services use an extensible facade while all reads
    // continue to resolve against the real service.
    const target = typeof service === "function"
      ? source
      : Object.create(Reflect.getPrototypeOf(source)) as object;
    const wrapMethod = (property: PropertyKey, value: Function): Function => {
      const cached = methodCache.get(property);
      if (cached !== undefined && cached.original === value) return cached.wrapped;
      const wrapped = (...args: unknown[]) => {
        assertActive();
        return Reflect.apply(value, source, args);
      };
      methodCache.set(property, { original: value, wrapped });
      return wrapped;
    };
    return new Proxy(target, {
      get: (_target, property) => {
        assertActive();
        const value = Reflect.get(source, property, source);
        if (typeof value !== "function") return value;
        return wrapMethod(property, value);
      },
      set() {
        assertActive();
        return false;
      },
      defineProperty() {
        assertActive();
        return false;
      },
      deleteProperty() {
        assertActive();
        return false;
      },
      getPrototypeOf() {
        assertActive();
        return Reflect.getPrototypeOf(source);
      },
      has(_target, property) {
        assertActive();
        return Reflect.has(source, property);
      },
      ownKeys() {
        assertActive();
        return Reflect.ownKeys(source);
      },
      getOwnPropertyDescriptor(_target, property) {
        assertActive();
        const descriptor = Reflect.getOwnPropertyDescriptor(source, property);
        if (!descriptor || typeof service === "function") return descriptor;
        if ("value" in descriptor) {
          return {
            ...descriptor,
            configurable: true,
            value: typeof descriptor.value === "function"
              ? wrapMethod(property, descriptor.value)
              : descriptor.value,
          };
        }
        return {
          configurable: true,
          enumerable: descriptor.enumerable,
          get: descriptor.get
            ? () => {
                assertActive();
                const value = Reflect.apply(descriptor.get!, source, []);
                return typeof value === "function" ? wrapMethod(property, value) : value;
              }
            : undefined,
          set: undefined,
        };
      },
      apply(_target, thisArgument, argumentsList) {
        assertActive();
        return Reflect.apply(source as Function, thisArgument, argumentsList);
      },
      construct(_target, argumentsList, newTarget) {
        assertActive();
        return Reflect.construct(source as Function, argumentsList, newTarget);
      },
    }) as TService;
  }
}

export class PluginCapabilityAccess implements CapabilityRegistry {
  private readonly permissionDecisions = new Map<string, PermissionDecision>();
  private readonly handles = new Set<RuntimeCapabilityHandle<unknown>>();
  private readonly resolutionCache = new Map<string, CapabilityResolution<unknown>>();
  private ownerComponent: NexusComponent | null = null;
  private disposed = false;

  constructor(
    readonly manifest: NormalizedPluginManifest,
    private readonly host: RuntimeCapabilityRegistry,
    decisions: PermissionDecisions = {},
  ) {
    for (const [permission, decision] of Object.entries(decisions)) {
      this.permissionDecisions.set(permission, decision);
    }
  }

  has<TService>(
    token: CapabilityToken<TService>,
    versionRange: SemanticVersionRange = token.version,
    context: CapabilityRequestContext = {},
  ): boolean {
    return this.resolve(token, versionRange, context).status === "available";
  }

  resolve<TService>(
    token: CapabilityToken<TService>,
    versionRange: SemanticVersionRange = token.version,
    context: CapabilityRequestContext = {},
  ): CapabilityResolution<TService> {
    return this.resolveById<TService>(token.id, versionRange, token.scope, context);
  }

  resolveById<TService = unknown>(
    id: string,
    versionRange: SemanticVersionRange,
    scope?: CapabilityScope,
    context: CapabilityRequestContext = {},
  ): CapabilityResolution<TService> {
    const cacheKey = JSON.stringify([
      id,
      versionRange,
      scope ?? null,
      context.windowId ?? null,
      context.workspaceId ?? null,
      context.viewId ?? null,
      context.editorId ?? null,
    ]);
    const cached = this.resolutionCache.get(cacheKey);
    if (cached !== undefined) return cached as CapabilityResolution<TService>;

    const remember = <T>(resolution: CapabilityResolution<T>): CapabilityResolution<T> => {
      this.resolutionCache.set(cacheKey, resolution as CapabilityResolution<unknown>);
      return resolution;
    };
    if (this.disposed) {
      return remember(this.unsupported(id, versionRange, "Plugin capability access has been disposed."));
    }
    if (validRange(versionRange) === null) {
      return remember(this.versionMismatch(id, versionRange, []));
    }

    const candidates = this.host.findProviders(id, scope, context);
    if (candidates.length === 0) {
      return remember(this.unsupported(id, versionRange, `Capability ${id} is not provided in this context.`));
    }
    const matchingVersion = maxSatisfying(
      candidates.map((candidate) => candidate.descriptor.version),
      versionRange,
    );
    if (!matchingVersion) {
      return remember(this.versionMismatch(id, versionRange, candidates.map((candidate) => candidate.descriptor.version)));
    }
    const provider = candidates.find((candidate) => candidate.descriptor.version === matchingVersion);
    if (!provider) return remember(this.unsupported(id, versionRange, `Capability ${id} is unavailable.`));

    const declaredPermissions = new Set(this.manifest.permissions.map((permission) => permission.id));
    const deniedPermissions = provider.requiredPermissions.filter(
      (permission) => !declaredPermissions.has(permission) || this.permissionDecisions.get(permission) !== "granted",
    );
    if (deniedPermissions.length > 0) {
      const diagnostic = capabilityDiagnostic(
        this.manifest,
        "capability-permission-denied",
        `Capability ${id} exists, but required permission was not granted.`,
        id,
        versionRange,
        { deniedPermissions: [...deniedPermissions] },
      );
      return remember({
        status: "permission-denied",
        requestedId: toCapabilityId(id),
        requestedVersion: versionRange,
        deniedPermissions: Object.freeze([...deniedPermissions]),
        diagnostic,
      });
    }

    const handle = new RuntimeCapabilityHandle<TService>(this.manifest, provider as Provider<TService>);
    if (this.ownerComponent) handle.bindOwner(this.ownerComponent);
    provider.handles.add(handle);
    this.handles.add(handle as RuntimeCapabilityHandle<unknown>);
    return remember({
      status: "available",
      descriptor: provider.descriptor,
      handle,
    });
  }

  get<TService>(
    token: CapabilityToken<TService>,
    versionRange: SemanticVersionRange = token.version,
    context: CapabilityRequestContext = {},
  ): TService | undefined {
    const resolution = this.resolve(token, versionRange, context);
    return resolution.status === "available" ? resolution.handle.service : undefined;
  }

  require<TService>(
    token: CapabilityToken<TService>,
    versionRange: SemanticVersionRange = token.version,
    context: CapabilityRequestContext = {},
  ): TService {
    const resolution = this.resolve(token, versionRange, context);
    if (resolution.status === "available") return resolution.handle.service;
    throw new NexusPluginError(resolution.diagnostic);
  }

  list(context: CapabilityRequestContext = {}): readonly CapabilityDescriptor[] {
    if (this.disposed) return Object.freeze([]);
    return Object.freeze(this.host.listProviders(context).map((provider) => provider.descriptor));
  }

  /** Host-runtime hook used after construction and before plugin onload. */
  bindOwner(component: NexusComponent): void {
    if (this.disposed) throw new Error("Cannot bind disposed plugin capability access.");
    if (this.ownerComponent && this.ownerComponent !== component) {
      throw new Error("Plugin capability access is already bound to another component.");
    }
    this.ownerComponent = component;
    for (const handle of this.handles) handle.bindOwner(component);
  }

  async revokePermission(permission: string, reason = "permission-revoked"): Promise<void> {
    this.permissionDecisions.set(permission, "denied");
    this.resolutionCache.clear();
    const handles = [...this.handles].filter((handle) => handle.provider.requiredPermissions.includes(permission));
    await Promise.all(handles.map((handle) => handle.revoke(
      permissionRevokedDiagnostic(this.manifest, handle.provider, reason),
    )));
    for (const handle of handles) this.handles.delete(handle);
  }

  async revokeCapability(id: string, reason = "capability-revoked"): Promise<void> {
    this.resolutionCache.clear();
    const handles = [...this.handles].filter((handle) => handle.provider.descriptor.id === id);
    await Promise.all(handles.map((handle) => handle.revoke(
      permissionRevokedDiagnostic(this.manifest, handle.provider, reason),
    )));
    for (const handle of handles) this.handles.delete(handle);
  }

  async revokeProvider(provider: Provider, reason = "capability-provider-revoked"): Promise<void> {
    this.resolutionCache.clear();
    const handles = [...this.handles].filter((handle) => handle.provider === provider);
    await Promise.all(handles.map((handle) => handle.revoke(
      permissionRevokedDiagnostic(this.manifest, handle.provider, reason),
    )));
    for (const handle of handles) this.handles.delete(handle);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.resolutionCache.clear();
    const handles = [...this.handles];
    await Promise.all(handles.map((handle) => handle.revoke(
      permissionRevokedDiagnostic(this.manifest, handle.provider, "plugin-access-disposed"),
    )));
    this.handles.clear();
    this.host.releasePluginAccess(this);
  }

  private unsupported(id: string, range: string, message: string): CapabilityResolution<never> {
    return {
      status: "unsupported",
      requestedId: toCapabilityId(id),
      requestedVersion: range,
      diagnostic: capabilityDiagnostic(
        this.manifest,
        "capability-unsupported",
        message,
        id,
        range,
      ),
    };
  }

  private versionMismatch(
    id: string,
    range: string,
    availableVersions: readonly SemanticVersion[],
  ): CapabilityResolution<never> {
    return {
      status: "version-mismatch",
      requestedId: toCapabilityId(id),
      requestedVersion: range,
      availableVersions: Object.freeze([...availableVersions]),
      diagnostic: capabilityDiagnostic(
        this.manifest,
        "capability-version-mismatch",
        `Capability ${id} does not provide a version matching ${range}.`,
        id,
        range,
        { availableVersions: [...availableVersions] },
      ),
    };
  }
}

export class RuntimeCapabilityRegistry {
  private readonly providersById = new Map<string, Provider[]>();
  private readonly accesses = new Set<PluginCapabilityAccess>();
  private sequence = 0;

  register<TService>(
    token: CapabilityToken<TService>,
    service: TService,
    options: CapabilityProviderOptions = {},
  ): CapabilityProviderRegistration {
    if ((typeof service !== "object" || service === null) && typeof service !== "function") {
      throw new TypeError(`Capability ${token.id} service must be an object or function so access can be revoked.`);
    }
    const descriptor = frozenDescriptor(token);
    if (!hasRequiredScopeContext(descriptor.scope, options.context ?? {})) {
      throw new TypeError(`Capability ${token.id} requires context for scope ${descriptor.scope}.`);
    }
    const providers = this.providersById.get(token.id) ?? [];
    if (providers.some((provider) =>
      !provider.revoked &&
      provider.descriptor.version === descriptor.version &&
      provider.descriptor.scope === descriptor.scope &&
      sameContext(provider.context, options.context ?? {}) &&
      sameContext(options.context, provider.context ?? {})
    )) {
      throw new NexusPluginError({
        code: "registration-conflict",
        severity: "error",
        phase: "runtime",
        message: `Capability ${token.id}@${token.version} is already registered for this scope.`,
        capability: {
          id: descriptor.id,
          actualVersion: descriptor.version,
        },
      });
    }

    const provider: Provider<TService> = {
      sequence: ++this.sequence,
      descriptor,
      service,
      requiredPermissions: Object.freeze([...new Set(options.requiredPermissions ?? [])]),
      ...(options.context === undefined ? {} : { context: Object.freeze({ ...options.context }) }),
      ...(options.onHandleRevoked === undefined ? {} : { onHandleRevoked: options.onHandleRevoked }),
      handles: new Set(),
      revoked: false,
    };
    return this.addProvider(token, provider, options);
  }

  registerOwnerBound<TService>(
    token: CapabilityToken<TService>,
    createService: OwnerBoundCapabilityFactory<TService>,
    options: CapabilityProviderOptions = {},
  ): CapabilityProviderRegistration {
    if (typeof createService !== "function") {
      throw new TypeError(`Capability ${token.id} owner-bound service factory must be a function.`);
    }
    const descriptor = frozenDescriptor(token);
    const provider: Provider<TService> = {
      sequence: ++this.sequence,
      descriptor,
      createService,
      requiredPermissions: Object.freeze([...new Set(options.requiredPermissions ?? [])]),
      ...(options.context === undefined ? {} : { context: Object.freeze({ ...options.context }) }),
      ...(options.onHandleRevoked === undefined ? {} : { onHandleRevoked: options.onHandleRevoked }),
      handles: new Set(),
      revoked: false,
    };
    return this.addProvider(token, provider, options);
  }

  private addProvider<TService>(
    token: CapabilityToken<TService>,
    provider: Provider<TService>,
    options: CapabilityProviderOptions,
  ): CapabilityProviderRegistration {
    const descriptor = provider.descriptor;
    if (!hasRequiredScopeContext(descriptor.scope, options.context ?? {})) {
      throw new TypeError(`Capability ${token.id} requires context for scope ${descriptor.scope}.`);
    }
    const providers = this.providersById.get(token.id) ?? [];
    if (providers.some((candidate) =>
      !candidate.revoked &&
      candidate.descriptor.version === descriptor.version &&
      candidate.descriptor.scope === descriptor.scope &&
      sameContext(candidate.context, options.context ?? {}) &&
      sameContext(options.context, candidate.context ?? {})
    )) {
      throw new NexusPluginError({
        code: "registration-conflict",
        severity: "error",
        phase: "runtime",
        message: `Capability ${token.id}@${token.version} is already registered for this scope.`,
        capability: {
          id: descriptor.id,
          actualVersion: descriptor.version,
        },
      });
    }
    providers.push(provider as Provider);
    this.providersById.set(token.id, providers);

    let revokePromise: Promise<void> | undefined;
    return Object.freeze({
      descriptor,
      get revoked() {
        return provider.revoked;
      },
      revoke: (reason = "host-capability-withdrawn") => {
        if (revokePromise) return revokePromise;
        provider.revoked = true;
        const current = this.providersById.get(token.id);
        if (current) {
          const index = current.indexOf(provider as Provider);
          if (index >= 0) current.splice(index, 1);
          if (current.length === 0) this.providersById.delete(token.id);
        }
        revokePromise = Promise.all(
          [...this.accesses].map((access) => access.revokeProvider(provider as Provider, reason)),
        ).then(() => undefined);
        return revokePromise;
      },
    });
  }

  createPluginAccess(
    manifest: NormalizedPluginManifest,
    decisions: PermissionDecisions = {},
  ): PluginCapabilityAccess {
    const access = new PluginCapabilityAccess(manifest, this, decisions);
    this.accesses.add(access);
    return access;
  }

  releasePluginAccess(access: PluginCapabilityAccess): void {
    this.accesses.delete(access);
  }

  findProviders(
    id: string,
    scope: CapabilityScope | undefined,
    context: CapabilityRequestContext,
  ): Provider[] {
    return (this.providersById.get(id) ?? [])
      .filter((provider) =>
        !provider.revoked &&
        (scope === undefined || provider.descriptor.scope === scope) &&
        hasRequiredScopeContext(provider.descriptor.scope, context) &&
        sameContext(provider.context, context)
      )
      .sort((left, right) => right.sequence - left.sequence);
  }

  listProviders(context: CapabilityRequestContext): Provider[] {
    return [...this.providersById.values()]
      .flat()
      .filter((provider) =>
        !provider.revoked &&
        hasRequiredScopeContext(provider.descriptor.scope, context) &&
        sameContext(provider.context, context)
      )
      .sort((left, right) => left.sequence - right.sequence);
  }
}
