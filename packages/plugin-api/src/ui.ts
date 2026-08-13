import type { CommandContext } from "./commands";
import type { NexusComponent } from "./component";
import type { NexusFile, NexusFolder } from "./content";
import type { EditorContext } from "./editor";
import type { NexusDiagnostic } from "./diagnostics";
import type { JsonValue } from "./json";
import type {
  ContributionRegistration,
  Registration,
  RegistrationResult,
  ServiceResult,
} from "./ownership";
import type { PluginStorageService } from "./storage";
import type { NexusView, WindowContext, WorkspaceLeaf } from "./workspace";

export type UiText = string;

export interface IconReference {
  readonly id: string;
  readonly decorative?: boolean;
}

export interface AccessibleActionLabel {
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly tooltip?: string;
}

export interface UiActionDefinition extends AccessibleActionLabel {
  readonly id: string;
  readonly icon?: IconReference;
  readonly priority?: number;
  readonly dangerous?: boolean;
  readonly commandId?: string;
  readonly visible?: () => boolean;
  readonly disabled?: () => boolean;
  readonly action: (context: UiActionContext) => void | Promise<void>;
}

export interface UiActionContext {
  readonly window: WindowContext;
  readonly leaf: WorkspaceLeaf | null;
  readonly view: NexusView | null;
  readonly editor: EditorContext | null;
  readonly file: NexusFile | null;
  readonly command: CommandContext | null;
}

export type UiSlot =
  | "status-bar"
  | "ribbon"
  | "editor-toolbar"
  | "view-toolbar"
  | "command-palette";

export interface UiSlotRegistration extends ContributionRegistration {
  readonly slot: UiSlot;
  /**
   * Updates this contribution in place and re-evaluates its visibility and
   * disabled predicates. Passing an empty patch is a supported invalidation.
   */
  update(
    definition: Partial<Omit<UiActionDefinition, "id">>,
  ): ServiceResult<void>;
}

export interface MenuContext extends UiActionContext {
  readonly kind: "editor" | "file" | "view" | "tab" | "custom";
  readonly event: MouseEvent | KeyboardEvent | null;
}

export interface MenuItemDefinition extends AccessibleActionLabel {
  readonly id: string;
  readonly icon?: IconReference;
  readonly section?: string;
  readonly priority?: number;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  readonly dangerous?: boolean;
  readonly separatorBefore?: boolean;
  readonly action?: (context: MenuContext) => void | Promise<void>;
  readonly submenu?: readonly MenuItemDefinition[];
}

export interface Menu extends Registration {
  readonly context: MenuContext;
  readonly closed: boolean;
  addItem(item: MenuItemDefinition): void;
  addSeparator(section?: string): void;
  showAt(position: { readonly x: number; readonly y: number }): Promise<void>;
  close(): Promise<void>;
}

export type MenuContributionPoint = "editor-menu" | "file-menu" | "view-menu" | "tab-menu";

export interface MenuService {
  createMenu(context: MenuContext): Menu;
  registerContribution(
    point: MenuContributionPoint,
    contribute: (menu: Menu, context: MenuContext) => void,
    options?: { readonly section?: string; readonly priority?: number },
  ): RegistrationResult<ContributionRegistration>;
}

export interface ModalController extends Registration {
  readonly window: WindowContext;
  readonly containerEl: HTMLElement;
  readonly titleEl: HTMLElement;
  readonly contentEl: HTMLElement;
  readonly open: boolean;
  close(): Promise<void>;
}

export interface ModalDefinition {
  readonly window: WindowContext;
  readonly title?: UiText;
  readonly restoreFocus?: HTMLElement | null;
  readonly onOpen?: (modal: ModalController) => void | Promise<void>;
  readonly onClose?: (modal: ModalController) => void | Promise<void>;
}

export interface ModalService {
  open(definition: ModalDefinition): Promise<ServiceResult<ModalController>>;
}

export type NoticeLevel = "info" | "success" | "warning" | "error";

export interface NoticeOptions {
  readonly level?: NoticeLevel;
  readonly durationMs?: number;
  readonly dedupeKey?: string;
  readonly window?: WindowContext;
}

export interface NoticeHandle extends Registration {
  readonly level: NoticeLevel;
  readonly message: string;
  update(message: string, options?: NoticeOptions): void;
  dismiss(): Promise<void>;
}

export interface NoticeService {
  show(message: string, options?: NoticeOptions): ServiceResult<NoticeHandle>;
}

export type SettingValue = JsonValue;

export interface SettingDefinitionBase<TValue extends SettingValue> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly defaultValue: TValue;
  readonly visible?: (values: Readonly<Record<string, SettingValue>>) => boolean;
  readonly disabled?: (values: Readonly<Record<string, SettingValue>>) => boolean;
  readonly validate?: (value: TValue) => string | null | Promise<string | null>;
}

export interface TextSettingDefinition extends SettingDefinitionBase<string> {
  readonly type: "text";
  readonly placeholder?: string;
}

export interface NumberSettingDefinition extends SettingDefinitionBase<number> {
  readonly type: "number";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface ToggleSettingDefinition extends SettingDefinitionBase<boolean> {
  readonly type: "toggle";
}

export interface SelectSettingDefinition extends SettingDefinitionBase<string> {
  readonly type: "select";
  readonly options: readonly { readonly value: string; readonly label: string }[];
}

export interface SliderSettingDefinition extends SettingDefinitionBase<number> {
  readonly type: "slider";
  readonly min: number;
  readonly max: number;
  readonly step?: number;
}

export interface ColorSettingDefinition extends SettingDefinitionBase<string> {
  readonly type: "color";
}

export interface FileSettingDefinition extends SettingDefinitionBase<string | null> {
  readonly type: "file";
  readonly filter?: (file: NexusFile) => boolean;
}

export interface FolderSettingDefinition extends SettingDefinitionBase<string | null> {
  readonly type: "folder";
  readonly filter?: (folder: NexusFolder) => boolean;
}

export interface ActionSettingDefinition extends SettingDefinitionBase<null> {
  readonly type: "action";
  readonly actionLabel: string;
  readonly dangerous?: boolean;
  readonly action: () => void | Promise<void>;
}

export type SettingDefinition =
  | TextSettingDefinition
  | NumberSettingDefinition
  | ToggleSettingDefinition
  | SelectSettingDefinition
  | SliderSettingDefinition
  | ColorSettingDefinition
  | FileSettingDefinition
  | FolderSettingDefinition
  | ActionSettingDefinition;

export interface SettingTabDisplayContext {
  readonly containerEl: HTMLElement;
  readonly window: WindowContext;
  readonly storage: PluginStorageService;
  readonly values: Readonly<Record<string, SettingValue>>;
  addChild(child: NexusComponent): Promise<NexusComponent>;
}

export interface SettingTabDefinition {
  readonly id: string;
  readonly name: string;
  readonly settings?: readonly SettingDefinition[];
  readonly display?: (context: SettingTabDisplayContext) => void | Promise<void>;
  readonly hide?: () => void | Promise<void>;
}

export interface SettingTabService {
  registerSettingTab(
    definition: SettingTabDefinition,
  ): RegistrationResult<ContributionRegistration>;
}

export interface HtmlSanitizationResult {
  readonly html: string;
  readonly removed: boolean;
  readonly diagnostics: readonly NexusDiagnostic[];
}

export interface UiPolicyService {
  sanitizeHtml(html: string): HtmlSanitizationResult;
  openExternalUrl(url: string, context: WindowContext): Promise<ServiceResult<void>>;
  confirmDangerousAction(options: {
    readonly title: string;
    readonly message: string;
    readonly window: WindowContext;
  }): Promise<boolean>;
}

export interface UiService {
  readonly menus: MenuService;
  readonly modals: ModalService;
  readonly notices: NoticeService;
  readonly settings: SettingTabService;
  readonly policy: UiPolicyService;
  registerAction(
    slot: UiSlot,
    definition: UiActionDefinition,
  ): RegistrationResult<UiSlotRegistration>;
}
