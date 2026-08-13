import { describe, expect, it } from "vitest";
import { SenderWindowRegistry } from "../electron/window-registry";

interface FakeWindow {
  readonly webContents: { readonly id: number };
  destroyed: boolean;
  isDestroyed(): boolean;
}

function fakeWindow(senderId: number): FakeWindow {
  return {
    webContents: { id: senderId },
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
  };
}

describe("SenderWindowRegistry", () => {
  it("owns two simultaneous window contexts with independent session and shutdown state", () => {
    interface WindowState {
      session: { partition: string };
      shutdownInProgress: boolean;
    }
    const registry = new SenderWindowRegistry<FakeWindow, WindowState>();
    const first = fakeWindow(11);
    const second = fakeWindow(22);

    const firstRegistration = registry.register(first, {
      session: { partition: "nexus-window-first" },
      shutdownInProgress: false,
    });
    const secondRegistration = registry.register(second, {
      session: { partition: "nexus-window-second" },
      shutdownInProgress: false,
    });
    firstRegistration.state.shutdownInProgress = true;

    expect(registry.primaryWindow).toBe(first);
    expect(registry.windowForSenderId(first.webContents.id)).toBe(first);
    expect(registry.windowForSenderId(second.webContents.id)).toBe(second);
    expect(firstRegistration.state.session).not.toBe(secondRegistration.state.session);
    expect(secondRegistration.state.shutdownInProgress).toBe(false);
    expect(registry.liveRegistrations.map(({ senderId }) => senderId)).toEqual([11, 22]);
  });

  it("removes only the requested sender and promotes a surviving primary window", () => {
    const registry = new SenderWindowRegistry<FakeWindow, { label: string }>();
    const first = fakeWindow(11);
    const second = fakeWindow(22);
    registry.register(first, { label: "first" });
    registry.register(second, { label: "second" });

    expect(registry.unregister(first.webContents.id)?.state.label).toBe("first");
    expect(registry.windowForSenderId(first.webContents.id)).toBeNull();
    expect(registry.windowForSenderId(second.webContents.id)).toBe(second);
    expect(registry.primaryWindow).toBe(second);
  });

  it("does not return destroyed windows or let them displace a live primary", () => {
    const registry = new SenderWindowRegistry<FakeWindow, undefined>();
    const first = fakeWindow(11);
    const second = fakeWindow(22);
    registry.register(first, undefined);
    registry.register(second, undefined);
    first.destroyed = true;

    expect(registry.windowForSenderId(first.webContents.id)).toBeNull();
    expect(registry.primaryWindow).toBe(second);
    expect(registry.liveRegistrations).toHaveLength(1);
  });
});
