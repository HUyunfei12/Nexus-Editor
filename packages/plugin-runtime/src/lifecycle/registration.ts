import type {
  ManagedResource,
  ManagedResourceInput,
  Registration,
  RegistrationId,
  RegistrationState,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";

function isPromiseLike(value: unknown): value is PromiseLike<void> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function normalizeResource(input: ManagedResourceInput): ManagedResource {
  return typeof input === "function" ? { dispose: input } : input;
}

export interface LifecycleRegistrationOptions {
  readonly id: RegistrationId;
  readonly owner: ResourceOwner;
  readonly input: ManagedResourceInput;
  readonly onActivationError?: (error: unknown) => void;
}

/** Runtime-owned state wrapper around every plugin resource. */
export class LifecycleRegistration implements Registration, ManagedResource {
  readonly id: RegistrationId;
  readonly owner: ResourceOwner;
  readonly resource: ManagedResource;
  private currentState: RegistrationState = "staged";
  private activationPromise?: Promise<void>;
  private disposePromise?: Promise<void>;
  private activationSettled = false;
  private quiesced = false;

  constructor(private readonly options: LifecycleRegistrationOptions) {
    this.id = options.id;
    this.owner = options.owner;
    this.resource = normalizeResource(options.input);
  }

  get state(): RegistrationState {
    return this.currentState;
  }

  get disposed(): boolean {
    return this.currentState === "disposed";
  }

  activate(): Promise<void> {
    if (this.currentState === "active" || this.currentState === "quiescing" || this.disposed) {
      return this.activationPromise ?? Promise.resolve();
    }
    if (this.activationPromise) return this.activationPromise;

    try {
      const result = this.resource.activate?.();
      if (!isPromiseLike(result)) {
        if (this.currentState === "staged") this.currentState = "active";
        this.activationSettled = true;
        this.activationPromise = Promise.resolve();
      } else {
        this.activationPromise = Promise.resolve(result).then(
          () => {
            this.activationSettled = true;
            if (this.currentState === "staged") this.currentState = "active";
          },
          (error) => {
            this.activationSettled = true;
            throw error;
          },
        );
      }
    } catch (error) {
      this.activationSettled = true;
      this.activationPromise = Promise.reject(error);
    }

    this.activationPromise = this.activationPromise.catch((error) => {
      this.options.onActivationError?.(error);
      throw error;
    });
    return this.activationPromise;
  }

  quiesce(): void {
    if (this.quiesced || this.disposed) return;
    this.quiesced = true;
    this.currentState = "quiescing";
    this.resource.quiesce?.();
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    try {
      this.quiesce();
    } catch (error) {
      // The resource still has to receive dispose after a quiesce failure.
      this.disposePromise = this.disposeAfterActivation().then(
        () => Promise.reject(error),
        (disposeError) => Promise.reject(new AggregateError([error, disposeError], "Resource cleanup failed.")),
      );
      return this.disposePromise;
    }

    this.disposePromise = this.disposeAfterActivation();
    return this.disposePromise;
  }

  private disposeAfterActivation(): Promise<void> {
    const disposeResource = (): Promise<void> => {
      try {
        const result = this.resource.dispose();
        if (!isPromiseLike(result)) {
          this.currentState = "disposed";
          return Promise.resolve();
        }
        return Promise.resolve(result).then(
          () => {
            this.currentState = "disposed";
          },
          (error) => {
            this.currentState = "disposed";
            throw error;
          },
        );
      } catch (error) {
        this.currentState = "disposed";
        return Promise.reject(error);
      }
    };

    if (this.activationSettled || !this.activationPromise) return disposeResource();
    return this.activationPromise.then(disposeResource, disposeResource);
  }
}
