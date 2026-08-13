export interface SenderOwnedWindow {
  readonly webContents: {
    readonly id: number;
  };
  isDestroyed(): boolean;
}

export interface SenderWindowRegistration<
  TWindow extends SenderOwnedWindow,
  TState,
> {
  readonly senderId: number;
  readonly window: TWindow;
  readonly state: TState;
}

/** Tracks host-created windows without treating the primary window as identity. */
export class SenderWindowRegistry<
  TWindow extends SenderOwnedWindow,
  TState,
> {
  private readonly registrations = new Map<
    number,
    SenderWindowRegistration<TWindow, TState>
  >();
  private primarySenderId: number | null = null;

  register(window: TWindow, state: TState): SenderWindowRegistration<TWindow, TState> {
    const senderId = window.webContents.id;
    const existing = this.registrations.get(senderId);
    if (existing) {
      if (existing.window === window) return existing;
      throw new Error(`Sender ${senderId} is already registered to another window.`);
    }

    const registration = Object.freeze({ senderId, window, state });
    this.registrations.set(senderId, registration);
    if (this.primaryWindow === null) this.primarySenderId = senderId;
    return registration;
  }

  registrationForSenderId(
    senderId: number,
  ): SenderWindowRegistration<TWindow, TState> | null {
    const registration = this.registrations.get(senderId);
    if (!registration || registration.window.isDestroyed()) return null;
    return registration;
  }

  windowForSenderId(senderId: number): TWindow | null {
    return this.registrationForSenderId(senderId)?.window ?? null;
  }

  unregister(senderId: number): SenderWindowRegistration<TWindow, TState> | null {
    const registration = this.registrations.get(senderId) ?? null;
    if (!registration) return null;

    this.registrations.delete(senderId);
    if (this.primarySenderId === senderId) {
      this.primarySenderId = this.firstLiveRegistration()?.senderId ?? null;
    }
    return registration;
  }

  get primaryWindow(): TWindow | null {
    if (this.primarySenderId !== null) {
      const current = this.registrationForSenderId(this.primarySenderId);
      if (current) return current.window;
    }

    const replacement = this.firstLiveRegistration();
    this.primarySenderId = replacement?.senderId ?? null;
    return replacement?.window ?? null;
  }

  get liveRegistrations(): readonly SenderWindowRegistration<TWindow, TState>[] {
    return [...this.registrations.values()].filter(
      (registration) => !registration.window.isDestroyed(),
    );
  }

  private firstLiveRegistration(): SenderWindowRegistration<TWindow, TState> | null {
    for (const registration of this.registrations.values()) {
      if (!registration.window.isDestroyed()) return registration;
    }
    return null;
  }
}
