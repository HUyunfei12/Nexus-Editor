import type { NexusComponent } from "./component";
import type { NexusFile } from "./content";
import type { EditorContext } from "./editor";
import type { NexusDiagnostic } from "./diagnostics";
import type { TypedEvents } from "./events";
import type {
  VaultPath,
  ViewId,
  WindowId,
  WorkspaceId,
  WorkspaceLeafId,
} from "./identifiers";
import type { JsonObject, JsonValue } from "./json";
import type {
  ContributionRegistration,
  RegistrationResult,
  ServiceResult,
} from "./ownership";

export interface WindowContext {
  readonly id: WindowId;
  readonly ownerWindow: Window;
  readonly ownerDocument: Document;
}

export type WorkspaceContainerType =
  | "root"
  | "tab"
  | "split"
  | "sidebar"
  | "window";

export interface WorkspaceLayoutNode {
  readonly id: string;
  readonly type: WorkspaceContainerType;
  readonly stateVersion: number;
  readonly state: JsonObject;
  readonly leafIds: readonly WorkspaceLeafId[];
  readonly children: readonly WorkspaceLayoutNode[];
}

export interface ViewState {
  readonly type: string;
  readonly stateVersion: number;
  readonly state: JsonObject;
  readonly ephemeralState?: JsonObject;
}

export interface WorkspaceLeaf {
  readonly id: WorkspaceLeafId;
  readonly containerEl: HTMLElement;
  readonly window: WindowContext;
  readonly view: NexusView | null;
  readonly viewType: string | null;
  readonly active: boolean;
  getViewState(): ViewState | null;
  setViewState(state: ViewState): Promise<void>;
  reveal(options?: { readonly focus?: boolean }): Promise<void>;
}

export interface NexusView extends NexusComponent {
  readonly id: ViewId;
  readonly type: string;
  readonly leaf: WorkspaceLeaf;
  readonly containerEl: HTMLElement;
  readonly window: WindowContext;
  getState(): JsonObject;
  setState(state: JsonObject): void | Promise<void>;
  getEphemeralState(): JsonObject;
  setEphemeralState(state: JsonObject): void;
  onOpen(): void | Promise<void>;
  onClose(): void | Promise<void>;
  onWindowContextChanged?(previous: WindowContext, current: WindowContext): void | Promise<void>;
}

export interface MarkdownView extends NexusView {
  readonly type: "markdown" | string;
  readonly file: NexusFile | null;
  readonly editor: EditorContext;
}

export type ViewFactory = (
  leaf: WorkspaceLeaf,
  initialState: ViewState,
) => NexusView | Promise<NexusView>;

export type MissingViewPolicy = "close" | "placeholder";

export interface ViewRegistrationOptions {
  readonly missingViewPolicy?: MissingViewPolicy;
  readonly stateVersion?: number;
}

export type NavigationTarget =
  | { readonly kind: "file"; readonly file: NexusFile }
  | { readonly kind: "view"; readonly state: ViewState }
  | { readonly kind: "url"; readonly url: string };

export type NavigationPlacement = "reuse" | "new-tab" | "split" | "window" | "default";

export interface NavigationOptions {
  readonly placement?: NavigationPlacement;
  readonly active?: boolean;
  readonly focus?: boolean;
  readonly reveal?: boolean;
  readonly sourcePath?: VaultPath;
  readonly ephemeralState?: JsonObject;
  readonly history?: "push" | "replace" | "none";
  readonly fallback?: Exclude<NavigationPlacement, "default">;
}

export type NavigationResult = ServiceResult<
  { readonly leaf: WorkspaceLeaf; readonly placement: NavigationPlacement },
  NexusDiagnostic
>;

export interface WorkspaceEventMap {
  readonly layoutReady: { readonly workspaceId: WorkspaceId };
  readonly layoutChanged: { readonly layout: WorkspaceLayoutNode };
  readonly focusedLeafChanged: { readonly leaf: WorkspaceLeaf | null };
  readonly activeViewChanged: { readonly view: NexusView | null };
  readonly activeFileChanged: { readonly file: NexusFile | null };
  readonly recentEditorChanged: { readonly editor: EditorContext | null };
  readonly leafOpened: { readonly leaf: WorkspaceLeaf };
  readonly leafClosed: { readonly leafId: WorkspaceLeafId };
  readonly windowContextChanged: {
    readonly leaf: WorkspaceLeaf;
    readonly previous: WindowContext;
    readonly current: WindowContext;
  };
}

export interface WorkspaceService {
  readonly id: WorkspaceId;
  readonly events: TypedEvents<WorkspaceEventMap>;
  readonly supportedContainers: readonly WorkspaceContainerType[];
  isLayoutReady(): boolean;
  getLayout(): WorkspaceLayoutNode;
  requestSaveLayout(): Promise<void>;
  getLeaves(): readonly WorkspaceLeaf[];
  getLeavesOfType(viewType: string): readonly WorkspaceLeaf[];
  getFocusedLeaf(): WorkspaceLeaf | null;
  getActiveView(): NexusView | null;
  getActiveFile(): NexusFile | null;
  getRecentEditor(): EditorContext | null;
  registerView(
    viewType: string,
    factory: ViewFactory,
    options?: ViewRegistrationOptions,
  ): RegistrationResult<ContributionRegistration>;
  navigate(target: NavigationTarget, options?: NavigationOptions): Promise<NavigationResult>;
  closeLeaf(leaf: WorkspaceLeaf): Promise<void>;
  revealLeaf(leaf: WorkspaceLeaf, options?: { readonly focus?: boolean }): Promise<void>;
}

export interface WorkspaceStateEnvelope {
  readonly schemaVersion: number;
  readonly data: JsonValue;
}
