const { app, BrowserWindow, session } = require("electron");
const path = require("node:path");

const timeoutMs = Number.parseInt(process.env.NEXUS_ELECTRON_SMOKE_TIMEOUT_MS ?? "20000", 10);
const htmlPath = path.resolve(__dirname, "electron-multi-window-smoke.html");
let finished = false;

function emitResult(result) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function fail(error) {
  if (finished) return;
  finished = true;
  emitResult({
    ok: false,
    smoke: "electron-multi-window-window-context",
    error: error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { message: String(error) },
  });
  app.exit(1);
}

function check(value, message) {
  if (!value) throw new Error(message);
}

async function execute(window, expression) {
  return window.webContents.executeJavaScript(expression, true);
}

async function loadHarness(window) {
  await window.loadFile(htmlPath);
  const loaded = await execute(window, "Boolean(window.__nexusMultiWindowSmoke)");
  check(loaded, "Renderer smoke bundle did not initialize");
}

async function run() {
  const primaryPartition = `nexus-smoke-primary-${process.pid}`;
  const secondaryPartition = `nexus-smoke-secondary-${process.pid}`;
  const primarySession = session.fromPartition(primaryPartition, { cache: false });
  const secondarySession = session.fromPartition(secondaryPartition, { cache: false });
  const sharedPreferences = {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  };
  const primary = new BrowserWindow({
    show: false,
    width: 480,
    height: 320,
    webPreferences: { ...sharedPreferences, session: primarySession },
  });
  const secondary = new BrowserWindow({
    show: false,
    width: 480,
    height: 320,
    webPreferences: { ...sharedPreferences, session: secondarySession },
  });
  let popup = null;
  const popupCreated = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for renderer-created popup BrowserWindow")), 5_000);
    secondary.webContents.once("did-create-window", (window, details) => {
      clearTimeout(timer);
      popup = window;
      resolve({ window, details });
    });
  });
  secondary.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url !== "about:blank" || frameName !== "nexus-smoke-popup") return { action: "deny" };
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        show: false,
        width: 420,
        height: 300,
        webPreferences: { ...sharedPreferences, session: secondarySession },
      },
    };
  });

  await Promise.all([loadHarness(primary), loadHarness(secondary)]);
  const [primaryState, secondaryState, popupCreation] = await Promise.all([
    execute(primary, "window.__nexusMultiWindowSmoke.prepare('primary')"),
    execute(secondary, "window.__nexusMultiWindowSmoke.prepare('secondary')"),
    popupCreated,
  ]);
  check(popup !== null && popup === popupCreation.window, "Renderer-created popup BrowserWindow was not tracked");
  const popupState = await execute(popup, `({
    markerRole: document.documentElement.dataset.smokeRole ?? null,
    title: document.title,
    ownerWindowMatches: document.defaultView === window,
    viewMounted: Boolean(document.querySelector("[data-smoke-view='secondary']")?.isConnected),
    leafMounted: Boolean(document.querySelector("[data-workspace-leaf-id='secondary-leaf']")?.isConnected),
    menuMounted: Boolean(document.querySelector(".nexus-plugin-menu")?.isConnected),
    modalMounted: Boolean(document.querySelector(".nexus-plugin-modal")?.isConnected),
    statusMounted: Boolean(document.querySelector("[data-ui-action-id='smoke-plugin:secondary-status']")?.isConnected)
  })`);
  const primaryDomIsolation = await execute(primary, `({
    viewAbsent: document.querySelector("[data-smoke-view='secondary']") === null,
    menuAbsent: document.querySelector(".nexus-plugin-menu") === null,
    modalAbsent: document.querySelector(".nexus-plugin-modal") === null,
    statusAbsent: document.querySelector("[data-ui-action-id='smoke-plugin:secondary-status']") === null
  })`);
  const secondaryDomAfterMigration = await execute(secondary, `({
    viewAbsent: document.querySelector("[data-smoke-view='secondary']") === null,
    leafAbsent: document.querySelector("[data-workspace-leaf-id='secondary-leaf']") === null,
    menuAbsent: document.querySelector(".nexus-plugin-menu") === null,
    modalAbsent: document.querySelector(".nexus-plugin-modal") === null,
    statusAbsent: document.querySelector("[data-ui-action-id='smoke-plugin:secondary-status']") === null
  })`);
  const beforeClose = {
    browserWindowCount: BrowserWindow.getAllWindows().length,
    primaryDestroyed: primary.isDestroyed(),
    secondaryDestroyed: secondary.isDestroyed(),
    popupDestroyed: popup.isDestroyed(),
    distinctWebContents: new Set([
      primary.webContents.id,
      secondary.webContents.id,
      popup.webContents.id,
    ]).size === 3,
    distinctPrimarySession: primary.webContents.session !== secondary.webContents.session,
    popupSharesOpenerSession: popup.webContents.session === secondary.webContents.session,
    partitions: [primaryPartition, secondaryPartition],
  };

  check(beforeClose.browserWindowCount === 3, "Expected exactly three live BrowserWindow instances");
  check(beforeClose.distinctWebContents, "All BrowserWindow webContents must be distinct");
  check(beforeClose.distinctPrimarySession, "Primary and secondary BrowserWindow sessions must be distinct");
  check(beforeClose.popupSharesOpenerSession, "Same-origin popup must share its opener session");
  check(primaryState.ownerWindowMatches && secondaryState.ownerWindowMatches, "Renderer Document.defaultView must match its Window");
  check(secondaryState.windowContext.ownerDocumentMatches, "Secondary WindowContext must own the secondary Document");
  check(secondaryState.windowContext.ownerWindowMatches, "Secondary WindowContext must own the secondary Window");
  check(secondaryState.popupWindowContext.ownerDocumentMatches, "Popup WindowContext must own the popup Document");
  check(secondaryState.popupWindowContext.ownerWindowMatches, "Popup WindowContext must own the popup Window");
  check(secondaryState.popupWindowContext.sameOriginDocumentAccessible, "Secondary renderer must access the popup Document directly");
  check(secondaryState.popupWindowContext.distinctFromSecondary, "Popup Window and Document must be distinct from secondary");
  check(secondaryState.leaf.ownerDocumentMatches && secondaryState.leaf.windowId === "popup", "Migrated leaf must belong to the popup Document and WindowContext");
  check(secondaryState.view.mounted && secondaryState.view.ownerDocumentMatches, "Migrated view must mount in the popup Document");
  check(secondaryState.migration.sourceMountedBeforeMove, "View must initially mount in the secondary Document");
  check(secondaryState.migration.sourceOwnerDocumentBeforeMove, "View must initially own the secondary Document");
  check(secondaryState.migration.sourceViewRemovedAfterMove, "View must leave the secondary Document after migration");
  check(secondaryState.migration.sourceEventsBeforeMigration.join(",") === "secondary", "View listener must handle the source Window before migration");
  check(secondaryState.migration.windowChanges.length === 1, "View must receive exactly one window-context change callback");
  check(secondaryState.migration.windowChanges[0].previousId === "secondary" && secondaryState.migration.windowChanges[0].currentId === "popup", "View migration callback must expose source and target contexts");
  check(secondaryState.migration.windowChanges[0].leafOwnerDocumentMatchesCurrent, "Leaf ownerDocument must be migrated before the view callback");
  check(secondaryState.migration.windowChanges[0].viewOwnerDocumentMatchesCurrent, "View ownerDocument must be migrated before the view callback");
  check(secondaryState.migration.previousRegistrationDisposed, "View must dispose its source Window listener during migration");
  check(secondaryState.migration.oldWindowIgnoredAfterMove, "Disposed source Window listener must not fire after migration");
  check(secondaryState.migration.newWindowHandledAfterMove, "Replacement popup Window listener must fire after migration");
  check(secondaryState.menu.mounted && secondaryState.menu.ownerDocumentMatches, "Popup menu must mount in the popup Document");
  check(secondaryState.menu.sourceOwnerDocumentMatches, "Popup contextmenu source must belong to the popup Document");
  check(secondaryState.menu.eventConstructorMatches, "Popup contextmenu must use the popup Window constructor");
  check(secondaryState.menu.left === "12px" && secondaryState.menu.top === "16px", "Popup menu must use event coordinates in its own Window");
  check(secondaryState.modal.mounted && secondaryState.modal.ownerDocumentMatches, "Popup modal must mount in the popup Document");
  check(secondaryState.modal.focusInside, "Popup modal must own renderer focus");
  check(secondaryState.status.mounted && secondaryState.status.ownerDocumentMatches, "Popup runtime slot must mount in the popup Document");
  check(Object.values(primaryDomIsolation).every(Boolean), "Migrated runtime DOM must not mount in the primary Document");
  check(Object.values(secondaryDomAfterMigration).every(Boolean), "Migrated runtime DOM must leave the secondary Document");
  check(popupState.markerRole === "popup" && popupState.title === "Nexus smoke popup", "Main process must identify the renderer-created popup Document");
  check(popupState.ownerWindowMatches, "Popup Document.defaultView must match its Window");
  check(popupState.viewMounted && popupState.leafMounted && popupState.menuMounted && popupState.modalMounted && popupState.statusMounted, "Main process must observe all migrated runtime DOM in the popup BrowserWindow");
  check(popupCreation.details.frameName === "nexus-smoke-popup", "Popup BrowserWindow must retain the requested frame name");

  primary.destroy();
  await new Promise((resolve) => setTimeout(resolve, 75));
  const afterPrimaryClose = {
    browserWindowCount: BrowserWindow.getAllWindows().length,
    primaryDestroyed: primary.isDestroyed(),
    secondaryDestroyed: secondary.isDestroyed(),
    ...(await execute(secondary, "window.__nexusMultiWindowSmoke.verifyAfterPrimaryClosed()")),
  };
  check(afterPrimaryClose.browserWindowCount === 2, "Closing primary must leave secondary and popup BrowserWindows alive");
  check(afterPrimaryClose.primaryDestroyed, "Primary BrowserWindow must be destroyed");
  check(!afterPrimaryClose.secondaryDestroyed, "Closing primary must not destroy secondary BrowserWindow");
  check(afterPrimaryClose.popupDocumentStillActive, "Popup Document must survive primary close");
  check(afterPrimaryClose.viewStillMounted, "Secondary view must survive primary close");
  check(afterPrimaryClose.menuStillMounted, "Secondary menu must survive primary close");
  check(afterPrimaryClose.modalStillMounted, "Secondary modal must survive primary close");
  check(afterPrimaryClose.focusStillInPopupModal, "Popup focus must survive primary close");

  const cleanup = await execute(secondary, "window.__nexusMultiWindowSmoke.cleanup()");
  check(cleanup.unloadState === "unloaded" && cleanup.unloadClean, "Runtime owner must unload cleanly");
  check(cleanup.viewCloseCount === 1 && cleanup.viewUnloadCount === 1, "Secondary view must close and unload exactly once");
  check(cleanup.viewRemoved && cleanup.menuRemoved && cleanup.modalRemoved && cleanup.statusRemoved && cleanup.menuSourceRemoved, "Runtime UI DOM must be removed");
  check(cleanup.resourcesDisposed && cleanup.sourceDocumentClean, "Runtime owner resources must be disposed and source Document clean");
  check(cleanup.focusDetached, "Focus must not remain on detached DOM");

  popup.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const afterPopupClosed = {
    browserWindowCount: BrowserWindow.getAllWindows().length,
    popupDestroyed: popup.isDestroyed(),
    secondaryDestroyed: secondary.isDestroyed(),
  };
  check(afterPopupClosed.browserWindowCount === 1 && afterPopupClosed.popupDestroyed, "Closing popup must leave only secondary alive");
  check(!afterPopupClosed.secondaryDestroyed, "Closing popup must not destroy secondary BrowserWindow");

  secondary.destroy();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const afterAllClosed = {
    browserWindowCount: BrowserWindow.getAllWindows().length,
    secondaryDestroyed: secondary.isDestroyed(),
  };
  check(afterAllClosed.browserWindowCount === 0 && afterAllClosed.secondaryDestroyed, "All smoke BrowserWindows must close");

  finished = true;
  emitResult({
    ok: true,
    smoke: "electron-multi-window-window-context",
    electron: process.versions.electron,
    platform: process.platform,
    arch: process.arch,
    primary: primaryState,
    secondary: secondaryState,
    popup: popupState,
    popupCreation: { frameName: popupCreation.details.frameName, url: popupCreation.details.url },
    primaryDomIsolation,
    secondaryDomAfterMigration,
    beforeClose,
    afterPrimaryClose,
    cleanup,
    afterPopupClosed,
    afterAllClosed,
  });
  app.exit(0);
}

const timer = setTimeout(() => fail(new Error(`Electron smoke timed out after ${timeoutMs}ms`)), timeoutMs);
timer.unref();
app.whenReady().then(run).catch(fail);
app.on("window-all-closed", (event) => {
  if (!finished) event.preventDefault();
});
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
