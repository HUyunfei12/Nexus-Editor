export type VirtualTimerKind = "timeout" | "interval";

export interface VirtualTimerSnapshot {
  readonly id: number;
  readonly kind: VirtualTimerKind;
  readonly dueAt: number;
  readonly intervalMs: number | null;
}

interface VirtualTimer {
  readonly id: number;
  readonly kind: VirtualTimerKind;
  readonly callback: () => void;
  dueAt: number;
  readonly intervalMs: number | null;
  cancelled: boolean;
}

/** Deterministic timer scheduler used by plugin lifecycle tests. */
export class VirtualClock {
  private readonly timers = new Map<number, VirtualTimer>();
  private nextId = 0;
  private currentTime = 0;

  get now(): number {
    return this.currentTime;
  }

  get pendingCount(): number {
    return this.timers.size;
  }

  setTimeout(callback: () => void, delayMs = 0): number {
    return this.schedule("timeout", callback, delayMs, null);
  }

  clearTimeout(id: number): void {
    this.cancel(id);
  }

  setInterval(callback: () => void, intervalMs: number): number {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError("Virtual interval must be a positive finite number");
    }
    return this.schedule("interval", callback, intervalMs, intervalMs);
  }

  clearInterval(id: number): void {
    this.cancel(id);
  }

  tick(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new RangeError("Virtual clock duration must be a non-negative finite number");
    }
    const target = this.currentTime + durationMs;
    let executions = 0;
    while (true) {
      const next = this.nextDue(target);
      if (!next) break;
      if (++executions > 100_000) {
        throw new Error("Virtual clock execution budget exceeded");
      }
      this.currentTime = next.dueAt;
      if (next.kind === "timeout") this.timers.delete(next.id);
      try {
        next.callback();
      } finally {
        if (
          next.kind === "interval" &&
          !next.cancelled &&
          this.timers.get(next.id) === next
        ) {
          next.dueAt += next.intervalMs!;
        }
      }
    }
    this.currentTime = target;
  }

  runAll(maxExecutions = 10_000): void {
    let executions = 0;
    while (this.timers.size > 0) {
      const next = this.nextDue(Number.POSITIVE_INFINITY);
      if (!next) return;
      if (++executions > maxExecutions) {
        throw new Error("Virtual clock did not become idle within the execution budget");
      }
      this.tick(next.dueAt - this.currentTime);
      if (next.kind === "interval" && this.timers.has(next.id)) {
        throw new Error("Virtual clock cannot runAll while an interval remains active");
      }
    }
  }

  snapshot(): readonly VirtualTimerSnapshot[] {
    return [...this.timers.values()]
      .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)
      .map((timer) => Object.freeze({
        id: timer.id,
        kind: timer.kind,
        dueAt: timer.dueAt,
        intervalMs: timer.intervalMs,
      }));
  }

  private schedule(
    kind: VirtualTimerKind,
    callback: () => void,
    delayMs: number,
    intervalMs: number | null,
  ): number {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new RangeError("Virtual timer delay must be a non-negative finite number");
    }
    const id = ++this.nextId;
    this.timers.set(id, {
      id,
      kind,
      callback,
      dueAt: this.currentTime + delayMs,
      intervalMs,
      cancelled: false,
    });
    return id;
  }

  private cancel(id: number): void {
    const timer = this.timers.get(id);
    if (!timer) return;
    timer.cancelled = true;
    this.timers.delete(id);
  }

  private nextDue(target: number): VirtualTimer | undefined {
    let next: VirtualTimer | undefined;
    for (const timer of this.timers.values()) {
      if (timer.cancelled || timer.dueAt > target) continue;
      if (!next || timer.dueAt < next.dueAt || (timer.dueAt === next.dueAt && timer.id < next.id)) {
        next = timer;
      }
    }
    return next;
  }
}
