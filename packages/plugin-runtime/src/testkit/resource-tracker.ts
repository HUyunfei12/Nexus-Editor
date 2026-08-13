export type TestResourceKind =
  | "listener"
  | "timer"
  | "registration"
  | "dom"
  | "other";

export interface TestResourceSnapshot {
  readonly id: number;
  readonly kind: TestResourceKind;
  readonly label: string;
}

export interface TrackedTestResource {
  readonly id: number;
  readonly released: boolean;
  release(): void;
}

/** Counts host-visible resources and produces actionable leak failures. */
export class ResourceTracker {
  private readonly active = new Map<number, TestResourceSnapshot>();
  private nextId = 0;

  get size(): number {
    return this.active.size;
  }

  acquire(kind: TestResourceKind, label: string): TrackedTestResource {
    const id = ++this.nextId;
    const snapshot = Object.freeze({ id, kind, label });
    this.active.set(id, snapshot);
    let released = false;
    return {
      id,
      get released() {
        return released;
      },
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(id);
      },
    };
  }

  trackDisposer<T extends () => void | Promise<void>>(
    kind: TestResourceKind,
    label: string,
    disposer: T,
  ): () => Promise<void> {
    const resource = this.acquire(kind, label);
    let promise: Promise<void> | null = null;
    return () => {
      if (promise) return promise;
      promise = Promise.resolve()
        .then(disposer)
        .finally(resource.release);
      return promise;
    };
  }

  snapshot(): readonly TestResourceSnapshot[] {
    return [...this.active.values()].sort((left, right) => left.id - right.id);
  }

  assertNoLeaks(message = "Expected plugin resources to be fully released"): void {
    const leaks = this.snapshot();
    if (leaks.length === 0) return;
    const details = leaks.map((item) => `${item.kind}:${item.label}#${item.id}`).join(", ");
    throw new Error(`${message}: ${details}`);
  }
}
