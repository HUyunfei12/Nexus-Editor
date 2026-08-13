import {
  COMMANDS_CAPABILITY,
  EDITOR_HOST_CAPABILITY,
  PLUGIN_STORAGE_CAPABILITY,
  UI_CAPABILITY,
  VAULT_CAPABILITY,
  WORKSPACE_CAPABILITY,
  NexusComponent,
  NexusPluginBase,
  type AuthorPluginManifest,
  type EditorContext,
  type JsonObject,
  type NexusApp,
  type NexusView,
  type NormalizedPluginManifest,
  type UiService,
  type ViewId,
  type ViewState,
  type WindowId,
  type WorkspaceId,
  type WorkspaceLeaf,
} from "@floatboat/nexus-plugin-api";

export const OBSIDIAN_SAMPLE_PLUGIN_COMMIT =
  "07ceb81d1fb3384af611ebf665a1ec42a7e5926d" as const;

export interface ObsidianSamplePortSettings {
  readonly mySetting: string;
  readonly enablePasteTransform: boolean;
}

const DEFAULT_SETTINGS: ObsidianSamplePortSettings = Object.freeze({
  mySetting: "default",
  enablePasteTransform: true,
});

export interface ObsidianSamplePortManifestOptions {
  readonly workspaceId?: string;
}

export function createObsidianSamplePortManifest(
  options: ObsidianSamplePortManifestOptions = {},
): AuthorPluginManifest {
  return Object.freeze({
    schemaVersion: 1,
    id: "obsidian-sample-port",
    name: "Obsidian Sample Plugin (Nexus Port)",
    version: "1.0.0",
    entrypoint: "obsidian-sample-port.js",
    apiVersion: "^1.0.0",
    requiredCapabilities: [
      { id: COMMANDS_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
      { id: EDITOR_HOST_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    ],
    optionalCapabilities: [
      { id: UI_CAPABILITY.id, version: "^1.0.0", scope: "window" as const },
      { id: WORKSPACE_CAPABILITY.id, version: "^1.0.0", scope: "workspace" as const },
      { id: VAULT_CAPABILITY.id, version: "^1.0.0", scope: "workspace" as const },
      { id: PLUGIN_STORAGE_CAPABILITY.id, version: "^1.0.0", scope: "application" as const },
    ],
    extensions: {
      upstreamRepository: "https://github.com/obsidianmd/obsidian-sample-plugin",
      upstreamCommit: OBSIDIAN_SAMPLE_PLUGIN_COMMIT,
      referenceWorkspaceId: options.workspaceId ?? "runtime-workspace",
    },
  } satisfies AuthorPluginManifest);
}

export const obsidianSamplePortManifest = createObsidianSamplePortManifest();

class SamplePortView extends NexusComponent implements NexusView {
  readonly id: ViewId;
  readonly type = "obsidian-sample-port:sample-view";
  readonly containerEl: HTMLElement;
  private state: JsonObject;
  private ephemeralState: JsonObject = {};

  constructor(
    readonly leaf: WorkspaceLeaf,
    initialState: ViewState,
    private readonly record: (event: string) => void,
  ) {
    super();
    this.id = `obsidian-sample-port-view:${leaf.id}` as ViewId;
    this.containerEl = leaf.window.ownerDocument.createElement("section");
    this.containerEl.className = "nexus-sample-port-view";
    this.containerEl.setAttribute("aria-label", "Sample plugin view");
    this.containerEl.textContent = "Sample plugin view";
    this.state = { ...initialState.state };
  }

  get window() {
    return this.leaf.window;
  }

  getState(): JsonObject {
    return structuredClone(this.state);
  }

  setState(state: JsonObject): void {
    this.state = structuredClone(state);
  }

  getEphemeralState(): JsonObject {
    return structuredClone(this.ephemeralState);
  }

  setEphemeralState(state: JsonObject): void {
    this.ephemeralState = structuredClone(state);
  }

  onOpen(): void {
    this.record("view-open");
  }

  onClose(): void {
    this.record("view-close");
  }
}

/**
 * Explicit Nexus port of the pinned Obsidian sample. It imports no `obsidian`
 * namespace and accesses host state only through declared capabilities.
 */
export class ObsidianSamplePortPlugin extends NexusPluginBase {
  settings: ObsidianSamplePortSettings = DEFAULT_SETTINGS;
  readonly lifecycleEvents: string[] = [];
  readonly vaultEvents: string[] = [];
  pasteEvents = 0;
  viewOpenEvents = 0;
  viewCloseEvents = 0;
  private readonly mountedUiWindows = new Set<WindowId>();

  constructor(app: NexusApp, manifest: NormalizedPluginManifest) {
    super(app, manifest);
  }

  override async onload(): Promise<void> {
    this.lifecycleEvents.push("load");
    await this.loadSettings();

    const commands = this.app.capabilities.require(COMMANDS_CAPABILITY, "^1.0.0");
    const editors = this.app.capabilities.require(EDITOR_HOST_CAPABILITY, "^1.0.0");

    this.reportFailure(commands.registerCommand({
      id: "open-modal-simple",
      name: "Open modal (simple)",
      callback: async ({ editor }) => this.openSampleModal(editor),
    }));
    this.reportFailure(commands.registerCommand({
      id: "replace-selected",
      name: "Replace selected content",
      editorCallback: ({ editor }) => {
        editor.replaceSelection("Sample editor command");
      },
    }));
    this.reportFailure(commands.registerCommand({
      id: "open-modal-complex",
      name: "Open modal (complex)",
      checkCallback: async (checking, context) => {
        const available = context.editor !== null;
        if (available && !checking) await this.openSampleModal(context.editor);
        return available;
      },
    }));
    this.reportFailure(commands.registerCommand({
      id: "open-sample-view",
      name: "Open sample view",
      callback: async () => {
        const workspace = this.getWorkspace();
        if (!workspace) return;
        await workspace.navigate({
          kind: "view",
          state: { type: "obsidian-sample-port:sample-view", stateVersion: 1, state: {} },
        }, { placement: "new-tab", active: true, focus: true });
      },
    }));

    this.reportFailure(editors.registerDomEvent("paste", (event, context) => {
      this.pasteEvents += 1;
      if (!this.settings.enablePasteTransform) return "pass";
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text.startsWith("sample:")) return "pass";
      const replaced = context.replaceTargetSelection(text.slice("sample:".length));
      return replaced.ok ? "consume" : "pass";
    }, { phase: "capture", priority: 10 }));

    for (const context of editors.list()) this.mountWindowUi(context);
    editors.events.on("attached", (context) => this.mountWindowUi(context));

    this.registerWorkspaceView();
    this.registerVaultEvents();

    const intervalId = globalThis.setInterval(() => {
      this.lifecycleEvents.push("interval");
    }, 5 * 60 * 1_000) as unknown as number;
    this.registerInterval(intervalId);
  }

  override onunload(): void {
    this.lifecycleEvents.push("unload");
    this.mountedUiWindows.clear();
  }

  private async loadSettings(): Promise<void> {
    const storage = this.app.capabilities.get(PLUGIN_STORAGE_CAPABILITY, "^1.0.0");
    if (!storage) return;
    const snapshot = await storage.loadData<{
      settings?: Partial<ObsidianSamplePortSettings>;
    }>();
    const stored = snapshot.data?.settings ?? {};
    this.settings = Object.freeze({ ...DEFAULT_SETTINGS, ...stored });
  }

  private async openSampleModal(editor: EditorContext | null): Promise<void> {
    const ui = this.getUi(editor);
    const window = editor?.window;
    if (!ui || !window) return;
    const opened = await ui.modals.open({
      window,
      title: "Sample",
      onOpen: (modal) => {
        modal.contentEl.textContent = "Woah!";
      },
      onClose: (modal) => {
        modal.contentEl.replaceChildren();
      },
    });
    if (!opened.ok) this.app.diagnostics.report(opened.diagnostic);
  }

  private mountWindowUi(context: EditorContext): void {
    const window = context.window;
    if (!window || this.mountedUiWindows.has(window.id)) return;
    const ui = this.getUi(context);
    if (!ui) return;
    this.mountedUiWindows.add(window.id);

    this.reportFailure(ui.registerAction("ribbon", {
      id: "sample-ribbon",
      label: "Sample",
      tooltip: "Sample",
      action: () => {
        ui.notices.show("This is a notice!", { window });
      },
    }));
    this.reportFailure(ui.registerAction("status-bar", {
      id: "sample-status",
      label: "Status bar text",
      action: () => undefined,
    }));
    this.reportFailure(ui.settings.registerSettingTab({
      id: "sample-settings",
      name: "Sample Plugin",
      settings: [
        {
          id: "mySetting",
          type: "text",
          name: "Setting #1",
          description: "It's a secret",
          defaultValue: DEFAULT_SETTINGS.mySetting,
        },
        {
          id: "enablePasteTransform",
          type: "toggle",
          name: "Transform sample paste",
          defaultValue: DEFAULT_SETTINGS.enablePasteTransform,
        },
      ],
    }));

    this.registerDomEvent(window.ownerDocument, "click", () => {
      ui.notices.show("Click", { window, dedupeKey: "sample-click" });
    });
  }

  private registerWorkspaceView(): void {
    const workspace = this.getWorkspace();
    if (!workspace) return;
    this.reportFailure(workspace.registerView(
      "obsidian-sample-port:sample-view",
      (leaf, state) => new SamplePortView(leaf, state, (event) => {
        if (event === "view-open") this.viewOpenEvents += 1;
        else this.viewCloseEvents += 1;
      }),
      { missingViewPolicy: "placeholder", stateVersion: 1 },
    ));
  }

  private registerVaultEvents(): void {
    const workspaceId = this.getWorkspaceId();
    if (!workspaceId) return;
    const vault = this.app.capabilities.get(VAULT_CAPABILITY, "^1.0.0", { workspaceId });
    if (!vault) return;
    vault.events.on("create", ({ file }) => {
      this.vaultEvents.push(`create:${file.path}`);
    });
    vault.events.on("modify", ({ file, version }) => {
      this.vaultEvents.push(`modify:${file.path}:${version}`);
    });
  }

  private getUi(editor: EditorContext | null): UiService | undefined {
    const windowId = editor?.window?.id;
    return windowId
      ? this.app.capabilities.get(UI_CAPABILITY, "^1.0.0", { windowId })
      : undefined;
  }

  private getWorkspace() {
    const workspaceId = this.getWorkspaceId();
    return workspaceId
      ? this.app.capabilities.get(WORKSPACE_CAPABILITY, "^1.0.0", { workspaceId })
      : undefined;
  }

  private getWorkspaceId(): WorkspaceId | undefined {
    const value = this.manifest.extensions.referenceWorkspaceId;
    return typeof value === "string" ? value as WorkspaceId : undefined;
  }

  private reportFailure(result: {
    readonly ok: boolean;
    readonly diagnostic?: unknown;
  }): void {
    if (!result.ok && result.diagnostic) {
      this.app.diagnostics.report(result.diagnostic as never);
    }
  }
}
