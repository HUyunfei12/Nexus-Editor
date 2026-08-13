import {
  NexusComponent,
  type ComponentId,
  type JsonObject,
  type ManagedResource,
  type Menu,
  type ModalController,
  type NexusView,
  type PluginId,
  type PluginIdentity,
  type Registration,
  type ResourceOwner,
  type ViewId,
  type WindowContext,
} from "@floatboat/nexus-plugin-api";
import {
  ComponentLifecycleRuntime,
  RuntimeUiHost,
  RuntimeWorkspace,
  RuntimeWorkspaceLeaf,
  createWindowContext,
} from "@floatboat/nexus-plugin-runtime";

declare global {
  interface Window {
    __nexusMultiWindowSmoke?: {
      prepare(role: "primary" | "secondary"): Promise<Record<string, unknown>>;
      verifyAfterPrimaryClosed(): Promise<Record<string, unknown>>;
      cleanup(): Promise<Record<string, unknown>>;
    };
  }
}

const owner: ResourceOwner = Object.freeze({
  pluginId: "smoke-plugin" as PluginId,
  componentId: "smoke-plugin/root" as ComponentId,
});

const identity: PluginIdentity = Object.freeze({
  id: owner.pluginId,
  name: "Multi-window smoke plugin",
  version: "1.0.0",
  source: Object.freeze({ kind: "development", locator: "electron-smoke" }),
});

class SmokeView extends NexusComponent implements NexusView {
  readonly id = "smoke-view:secondary" as ViewId;
  readonly type = "smoke-plugin:secondary-view";
  readonly containerEl: HTMLElement;
  private state: JsonObject = {};
  private ephemeralState: JsonObject = {};
  openCount = 0;
  closeCount = 0;
  unloadCount = 0;
  readonly windowChanges: Array<{
    readonly previousId: string;
    readonly currentId: string;
    readonly previousRegistrationDisposed: boolean;
    readonly leafOwnerDocumentMatchesCurrent: boolean;
    readonly viewOwnerDocumentMatchesCurrent: boolean;
  }> = [];
  readonly windowEvents: string[] = [];
  private readonly windowEventRegistrations: Registration[] = [];

  constructor(readonly leaf: RuntimeWorkspaceLeaf) {
    super();
    this.containerEl = leaf.window.ownerDocument.createElement("article");
    this.containerEl.dataset.smokeView = "secondary";
    this.containerEl.tabIndex = -1;
  }

  get window() { return this.leaf.window; }
  getState(): JsonObject { return { ...this.state }; }
  setState(state: JsonObject): void { this.state = { ...state }; }
  getEphemeralState(): JsonObject { return { ...this.ephemeralState }; }
  setEphemeralState(state: JsonObject): void { this.ephemeralState = { ...state }; }
  override onload(): void { this.bindWindowEvent(this.window); }
  onOpen(): void { this.openCount += 1; }
  onClose(): void { this.closeCount += 1; }
  onunload(): void { this.unloadCount += 1; }

  async onWindowContextChanged(previous: WindowContext, current: WindowContext): Promise<void> {
    const previousRegistration = this.windowEventRegistrations.at(-1);
    await previousRegistration?.dispose();
    this.bindWindowEvent(current);
    this.windowChanges.push({
      previousId: previous.id,
      currentId: current.id,
      previousRegistrationDisposed: previousRegistration?.disposed ?? false,
      leafOwnerDocumentMatchesCurrent: this.leaf.containerEl.ownerDocument === current.ownerDocument,
      viewOwnerDocumentMatchesCurrent: this.containerEl.ownerDocument === current.ownerDocument,
    });
  }

  private bindWindowEvent(context: WindowContext): void {
    this.windowEventRegistrations.push(this.registerDomEvent(
      context.ownerWindow,
      "nexus-smoke-window-context",
      () => this.windowEvents.push(context.id),
    ));
  }
}

let role: "primary" | "secondary" | null = null;
let primaryMarker: HTMLElement | null = null;
let rootController: ReturnType<ComponentLifecycleRuntime["manage"]> | null = null;
let workspace: RuntimeWorkspace | null = null;
let leaf: RuntimeWorkspaceLeaf | null = null;
let view: SmokeView | null = null;
let menu: Menu | null = null;
let modal: ModalController | null = null;
let menuSource: HTMLButtonElement | null = null;
let statusContainer: HTMLElement | null = null;
let sourceContext: WindowContext | null = null;
let popupContext: WindowContext | null = null;
let popupWindow: Window | null = null;
let resources: ManagedResource[] = [];

type WindowWithEventConstructors = Window & {
  readonly Event: typeof Event;
  readonly MouseEvent: typeof MouseEvent;
};

function windowSnapshot(expectedRole: "primary" | "secondary"): Record<string, unknown> {
  return {
    role: expectedRole,
    title: document.title,
    location: location.href,
    documentReadyState: document.readyState,
    ownerWindowMatches: document.defaultView === window,
    markerRole: document.documentElement.dataset.smokeRole ?? null,
  };
}

async function preparePrimary(): Promise<Record<string, unknown>> {
  document.documentElement.dataset.smokeRole = "primary";
  document.title = "Nexus smoke primary";
  primaryMarker = document.createElement("div");
  primaryMarker.dataset.primaryMarker = "true";
  document.body.append(primaryMarker);
  primaryMarker.tabIndex = 0;
  primaryMarker.focus();
  return {
    ...windowSnapshot("primary"),
    primaryMarkerConnected: primaryMarker.isConnected,
    primaryFocused: document.activeElement === primaryMarker,
  };
}

function dispatchWindowContextEvent(context: WindowContext): void {
  const eventWindow = context.ownerWindow as WindowWithEventConstructors;
  context.ownerWindow.dispatchEvent(new eventWindow.Event("nexus-smoke-window-context"));
}

async function openSameOriginPopup(): Promise<Window> {
  const popup = window.open(
    "about:blank",
    "nexus-smoke-popup",
    "popup,width=420,height=300",
  );
  if (!popup) throw new Error("Electron denied the secondary renderer popup");

  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    if (popup.closed) throw new Error("Electron popup closed before its Document was ready");
    try {
      if (popup.document.body && popup.document.defaultView === popup) return popup;
    } catch {
      // The WindowProxy may not expose the inherited origin until navigation commits.
    }
    await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for same-origin popup Document access");
}

async function prepareSecondary(): Promise<Record<string, unknown>> {
  document.documentElement.dataset.smokeRole = "secondary";
  document.title = "Nexus smoke secondary";
  sourceContext = createWindowContext("secondary", document);
  workspace = new RuntimeWorkspace(document, { supportedContainers: ["root", "tab", "window"] });
  const runtimeWindow = workspace.createWindow(document, "secondary");
  leaf = workspace.createLeaf({ windowId: runtimeWindow.id, id: "secondary-leaf" });

  popupWindow = await openSameOriginPopup();
  const popupDocument = popupWindow.document;
  popupDocument.documentElement.dataset.smokeRole = "popup";
  popupDocument.title = "Nexus smoke popup";
  popupContext = createWindowContext("popup", popupDocument);
  const popupRuntimeWindow = workspace.createWindow(popupDocument, "popup");

  statusContainer = popupDocument.createElement("nav");
  statusContainer.dataset.smokeStatus = "popup";
  popupDocument.body.append(statusContainer);
  const ui = new RuntimeUiHost({
    defaultWindow: popupContext,
    slots: {
      "status-bar": {
        window: popupContext,
        containerEl: statusContainer,
        actionContext: {
          window: popupContext,
          leaf,
          view: null,
          editor: null,
          file: null,
          command: null,
        },
      },
    },
  });
  const services: { ui?: ReturnType<RuntimeUiHost["createService"]> } = {};

  class SmokeOwner extends NexusComponent {
    override async onload(): Promise<void> {
      const workspaceService = workspace!.createService(this.owner!, (resource) => {
        this.register(resource);
        resources.push(resource);
      });
      const registration = workspaceService.registerView(
        "smoke-plugin:secondary-view",
        (target) => {
          view = new SmokeView(target as RuntimeWorkspaceLeaf);
          return view;
        },
        { missingViewPolicy: "close", stateVersion: 1 },
      );
      if (!registration.ok) throw new Error(registration.diagnostic.message);

      services.ui = ui.createService(this.owner!, (resource) => {
        this.register(resource);
        resources.push(resource);
      });
      const action = services.ui.registerAction("status-bar", {
        id: "secondary-status",
        label: "Secondary status",
        action: () => undefined,
      });
      if (!action.ok) throw new Error(action.diagnostic.message);
    }
  }

  rootController = new ComponentLifecycleRuntime().manage(new SmokeOwner(), identity);
  await rootController.load();
  await leaf.setViewState({
    type: "smoke-plugin:secondary-view",
    stateVersion: 1,
    state: { source: "real-electron" },
  });
  const sourceViewElement = document.querySelector<HTMLElement>("[data-smoke-view='secondary']");
  const sourceMountedBeforeMove = Boolean(sourceViewElement?.isConnected);
  const sourceOwnerDocumentBeforeMove = sourceViewElement?.ownerDocument === document;
  dispatchWindowContextEvent(sourceContext);
  const sourceEventsBeforeMigration = [...(view?.windowEvents ?? [])];

  await workspace.moveLeafToWindow(leaf, popupRuntimeWindow);
  dispatchWindowContextEvent(sourceContext);
  dispatchWindowContextEvent(popupContext);

  const uiService = services.ui;
  if (!uiService) throw new Error("Runtime UI service did not initialize");
  menuSource = popupDocument.createElement("button");
  menuSource.type = "button";
  menuSource.dataset.secondaryMenuSource = "true";
  menuSource.textContent = "Popup menu source";
  popupDocument.body.append(menuSource);
  menuSource.focus();
  const popupEventWindow = popupWindow as WindowWithEventConstructors;
  const menuEvent = new popupEventWindow.MouseEvent("contextmenu", {
    bubbles: true,
    clientX: 12,
    clientY: 16,
  });
  menuSource.dispatchEvent(menuEvent);
  const popupMenu = uiService.menus.createMenu({
    kind: "view",
    event: menuEvent,
    window: popupContext,
    leaf,
    view,
    editor: null,
    file: null,
    command: null,
  });
  popupMenu.addItem({ id: "secondary-menu", label: "Secondary menu", action: () => undefined });
  await popupMenu.showAt({ x: menuEvent.clientX, y: menuEvent.clientY });
  menu = popupMenu;

  const opened = await uiService.modals.open({
    window: popupContext,
    title: "Secondary modal",
    onOpen: (controller) => {
      const button = popupDocument.createElement("button");
      button.type = "button";
      button.dataset.secondaryModalFocus = "true";
      button.textContent = "Modal focus";
      controller.contentEl.append(button);
    },
  });
  if (!opened.ok) throw new Error(opened.diagnostic.message);
  modal = opened.value;

  const viewElement = popupDocument.querySelector<HTMLElement>("[data-smoke-view='secondary']");
  const menuElement = popupDocument.querySelector<HTMLElement>(".nexus-plugin-menu");
  const modalElement = popupDocument.querySelector<HTMLElement>(".nexus-plugin-modal");
  const statusElement = popupDocument.querySelector<HTMLElement>("[data-ui-action-id='smoke-plugin:secondary-status']");
  return {
    ...windowSnapshot("secondary"),
    windowContext: {
      id: sourceContext.id,
      ownerDocumentMatches: sourceContext.ownerDocument === document,
      ownerWindowMatches: sourceContext.ownerWindow === window,
      distinctFromOpener: window.opener === null || window.opener !== window,
    },
    popupWindowContext: {
      id: popupContext.id,
      markerRole: popupDocument.documentElement.dataset.smokeRole ?? null,
      ownerDocumentMatches: popupContext.ownerDocument === popupDocument,
      ownerWindowMatches: popupContext.ownerWindow === popupWindow,
      sameOriginDocumentAccessible: popupDocument.defaultView === popupWindow,
      distinctFromSecondary: popupWindow !== window && popupDocument !== document,
    },
    leaf: {
      id: leaf.id,
      ownerDocumentMatches: leaf.containerEl.ownerDocument === popupDocument,
      windowId: leaf.window.id,
    },
    view: {
      mounted: Boolean(viewElement?.isConnected),
      ownerDocumentMatches: viewElement?.ownerDocument === popupDocument,
      openCount: view?.openCount ?? 0,
      state: view?.getState() ?? null,
    },
    migration: {
      sourceMountedBeforeMove,
      sourceOwnerDocumentBeforeMove,
      sourceViewRemovedAfterMove: document.querySelector("[data-smoke-view='secondary']") === null,
      sourceEventsBeforeMigration,
      windowChanges: view?.windowChanges ?? [],
      windowEvents: view?.windowEvents ?? [],
      previousRegistrationDisposed: view?.windowChanges[0]?.previousRegistrationDisposed ?? false,
      oldWindowIgnoredAfterMove: view?.windowEvents.join(",") === "secondary,popup",
      newWindowHandledAfterMove: view?.windowEvents.at(-1) === "popup",
    },
    menu: {
      mounted: Boolean(menuElement?.isConnected),
      ownerDocumentMatches: menuElement?.ownerDocument === popupDocument,
      sourceOwnerDocumentMatches: menuSource?.ownerDocument === popupDocument,
      eventConstructorMatches: menu?.context.event instanceof popupEventWindow.MouseEvent,
      left: menuElement?.style.left ?? null,
      top: menuElement?.style.top ?? null,
    },
    modal: {
      mounted: Boolean(modalElement?.isConnected),
      ownerDocumentMatches: modalElement?.ownerDocument === popupDocument,
      focusInside: Boolean(modalElement?.contains(popupDocument.activeElement)),
    },
    status: {
      mounted: Boolean(statusElement?.isConnected),
      ownerDocumentMatches: statusElement?.ownerDocument === popupDocument,
    },
    resourceCount: resources.length,
  };
}

async function prepare(nextRole: "primary" | "secondary"): Promise<Record<string, unknown>> {
  if (role !== null) throw new Error(`Renderer already prepared as ${role}`);
  role = nextRole;
  return nextRole === "primary" ? preparePrimary() : prepareSecondary();
}

async function verifyAfterPrimaryClosed(): Promise<Record<string, unknown>> {
  if (role !== "secondary") throw new Error("Only the secondary renderer can verify survival");
  await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
  if (!popupWindow || popupWindow.closed) throw new Error("Popup closed before survival verification");
  const popupDocument = popupWindow.document;
  const viewElement = popupDocument.querySelector<HTMLElement>("[data-smoke-view='secondary']");
  const menuElement = popupDocument.querySelector<HTMLElement>(".nexus-plugin-menu");
  const modalElement = popupDocument.querySelector<HTMLElement>(".nexus-plugin-modal");
  return {
    secondaryDocumentStillActive: document.defaultView === window && document.documentElement.isConnected,
    popupDocumentStillActive: popupDocument.defaultView === popupWindow && popupDocument.documentElement.isConnected,
    viewStillMounted: Boolean(viewElement?.isConnected),
    menuStillMounted: Boolean(menuElement?.isConnected),
    modalStillMounted: Boolean(modalElement?.isConnected),
    focusStillInPopupModal: Boolean(modalElement?.contains(popupDocument.activeElement)),
  };
}

async function cleanup(): Promise<Record<string, unknown>> {
  if (role === "primary") {
    primaryMarker?.remove();
    primaryMarker = null;
    return { primaryMarkerRemoved: document.querySelector("[data-primary-marker]") === null };
  }
  if (role !== "secondary") return { skipped: true };

  const popupDocument = popupWindow && !popupWindow.closed ? popupWindow.document : null;
  const unload = await rootController?.unload();
  const resourceStates = resources.map((resource) => "disposed" in resource
    ? Boolean((resource as ManagedResource & { readonly disposed: boolean }).disposed)
    : true);
  resources = [];
  const result = {
    unloadState: unload?.state ?? null,
    unloadClean: unload?.clean ?? false,
    viewCloseCount: view?.closeCount ?? 0,
    viewUnloadCount: view?.unloadCount ?? 0,
    viewRemoved: popupDocument?.querySelector("[data-smoke-view='secondary']") === null,
    menuRemoved: popupDocument?.querySelector(".nexus-plugin-menu") === null,
    modalRemoved: popupDocument?.querySelector(".nexus-plugin-modal") === null,
    statusRemoved: popupDocument?.querySelector("[data-ui-action-id='smoke-plugin:secondary-status']") === null,
    menuSourceRemoved: false,
    resourcesDisposed: resourceStates.every(Boolean),
    focusDetached: popupDocument?.activeElement === null || popupDocument?.activeElement?.isConnected !== false,
    sourceDocumentClean: document.querySelector("[data-smoke-view='secondary']") === null,
  };
  statusContainer?.remove();
  statusContainer = null;
  menuSource?.remove();
  menuSource = null;
  result.menuSourceRemoved = popupDocument?.querySelector("[data-secondary-menu-source]") === null;
  leaf = null;
  workspace = null;
  menu = null;
  modal = null;
  rootController = null;
  sourceContext = null;
  popupContext = null;
  popupWindow = null;
  return result;
}

window.__nexusMultiWindowSmoke = { prepare, verifyAfterPrimaryClosed, cleanup };
