import type {
  ComponentId,
  ContributionRegistration,
  HotkeyBinding,
  ManagedResource,
  NexusDiagnostic,
  PluginId,
  RegistrationId,
  RegistrationResult,
  RegistrationState,
  ResourceOwner,
} from "@floatboat/nexus-plugin-api";
import type {
  NexusPlugin,
  SlashCommandDef,
  WidgetDefinition,
} from "@floatboat/nexus-core";

import { CommandRegistry } from "./commands/command-registry";
import { EditorHostRegistry } from "./editor-host-registry";

type LegacyRemarkPlugin = NonNullable<NexusPlugin["remarkPlugins"]>[number];

export interface LegacyRemarkTransformPort {
  registerLegacyTransform(
    owner: ResourceOwner,
    localId: string,
    transform: LegacyRemarkPlugin,
  ): RegistrationResult<ContributionRegistration & ManagedResource>;
}

export interface LegacyWidgetPort {
  registerLegacyWidget(
    owner: ResourceOwner,
    localId: string,
    widget: WidgetDefinition,
  ): RegistrationResult<ContributionRegistration & ManagedResource>;
}

export interface LegacySlashCommandPort {
  registerLegacySlashCommand(
    owner: ResourceOwner,
    localId: string,
    command: SlashCommandDef,
  ): RegistrationResult<ContributionRegistration & ManagedResource>;
}

export interface LegacyPluginAdapterOptions {
  readonly commands: CommandRegistry;
  readonly editors: EditorHostRegistry;
  readonly remarkTransforms?: LegacyRemarkTransformPort;
  readonly widgets?: LegacyWidgetPort;
  readonly slashCommands?: LegacySlashCommandPort;
  readonly reportDiagnostic?: (diagnostic: NexusDiagnostic) => void;
}

export type LegacyPluginAdapterResult = RegistrationResult<LegacyPluginRegistration>;

function asRegistrationId(value: string): RegistrationId {
  return value as RegistrationId;
}

function diagnostic(
  owner: ResourceOwner,
  code: NexusDiagnostic["code"],
  message: string,
  resourceId?: string,
  cause?: unknown,
): NexusDiagnostic {
  return Object.freeze({
    code,
    severity: "error",
    phase: "validation",
    message,
    plugin: { id: owner.pluginId, version: "legacy" },
    ...(resourceId ? { resourceId } : {}),
    ...(cause === undefined
      ? {}
      : {
          cause: cause instanceof Error
            ? { name: cause.name, message: cause.message }
            : { message: String(cause) },
        }),
  });
}

function parseLegacyHotkey(value: string): HotkeyBinding {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    throw new TypeError(`Legacy hotkey '${value}' must contain exactly one key chord`);
  }
  const parts = trimmed.split("-").filter(Boolean);
  const key = parts.pop();
  if (!key) throw new TypeError(`Legacy hotkey '${value}' has no key`);
  const modifiers: Array<"Mod" | "Ctrl" | "Meta" | "Alt" | "Shift"> = [];
  for (const raw of parts) {
    const normalized = raw.toLowerCase();
    const modifier = normalized === "mod"
      ? "Mod"
      : normalized === "ctrl" || normalized === "control"
        ? "Ctrl"
        : normalized === "cmd" || normalized === "meta"
          ? "Meta"
          : normalized === "alt" || normalized === "option"
            ? "Alt"
            : normalized === "shift"
              ? "Shift"
              : null;
    if (!modifier) throw new TypeError(`Unknown legacy hotkey modifier '${raw}'`);
    if (!modifiers.includes(modifier)) modifiers.push(modifier);
  }
  return Object.freeze({
    key,
    ...(modifiers.length > 0 ? { modifiers: Object.freeze(modifiers) } : {}),
  });
}

function validateLocalId(id: string, kind: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new TypeError(`${kind} id '${id}' is not a valid managed contribution id`);
  }
}

/** One owner-bound aggregate; legacy objects themselves never become lifecycle components. */
export class LegacyPluginRegistration
  implements ContributionRegistration, ManagedResource
{
  readonly id: RegistrationId;
  readonly localId = "legacy";
  readonly globalId: string;
  readonly priority = 0;
  private currentState: RegistrationState = "staged";
  private activationPromise: Promise<void> | null = null;
  private disposePromise: Promise<void> | null = null;

  constructor(
    readonly owner: ResourceOwner,
    readonly pluginName: string,
    private readonly resources: readonly ManagedResource[],
  ) {
    this.id = asRegistrationId(`${owner.pluginId}:legacy-registration`);
    this.globalId = `${owner.pluginId}:legacy`;
  }

  get state(): RegistrationState { return this.currentState; }
  get disposed(): boolean { return this.currentState === "disposed"; }

  activate(): Promise<void> {
    if (this.activationPromise) return this.activationPromise;
    if (this.currentState !== "staged") return Promise.resolve();
    this.activationPromise = this.activateResources();
    return this.activationPromise;
  }

  quiesce(): void {
    if (this.currentState !== "staged" && this.currentState !== "active") return;
    this.currentState = "quiescing";
    for (const resource of [...this.resources].reverse()) {
      try {
        resource.quiesce?.();
      } catch {
        // dispose() still runs every resource and aggregates cleanup failures.
      }
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.quiesce();
    this.disposePromise = this.disposeResources();
    return this.disposePromise;
  }

  private async activateResources(): Promise<void> {
    const activated: ManagedResource[] = [];
    try {
      for (const resource of this.resources) {
        await resource.activate?.();
        activated.push(resource);
      }
      if (this.currentState === "staged") this.currentState = "active";
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const resource of [...activated, ...this.resources.slice(activated.length)].reverse()) {
        try {
          await resource.dispose();
        } catch (cleanupError) {
          rollbackErrors.push(cleanupError);
        }
      }
      this.currentState = "disposed";
      throw new AggregateError(
        [error, ...rollbackErrors],
        `Failed to activate legacy plugin '${this.pluginName}'`,
      );
    }
  }

  private async disposeResources(): Promise<void> {
    const errors: unknown[] = [];
    for (const resource of [...this.resources].reverse()) {
      try {
        await resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    this.currentState = "disposed";
    if (errors.length > 0) {
      throw new AggregateError(errors, `Failed to dispose legacy plugin '${this.pluginName}'`);
    }
  }
}

/**
 * Explicit compatibility boundary for the old declarative `NexusPlugin` shape.
 * It never installs a partial plugin: all unsupported fields and registrations
 * are rejected while every contribution is still staged and undispatchable.
 */
export class LegacyPluginAdapter {
  private readonly reportDiagnostic: (diagnostic: NexusDiagnostic) => void;

  constructor(private readonly options: LegacyPluginAdapterOptions) {
    this.reportDiagnostic = options.reportDiagnostic ?? (() => undefined);
  }

  createOwner(pluginId: PluginId | string): ResourceOwner {
    return Object.freeze({
      pluginId: pluginId as PluginId,
      componentId: `${pluginId}:legacy` as ComponentId,
    });
  }

  adapt(owner: ResourceOwner, plugin: NexusPlugin): LegacyPluginAdapterResult {
    const preflight = this.preflight(owner, plugin);
    if (preflight) return { ok: false, diagnostic: preflight };

    const resources: ManagedResource[] = [];
    const add = (
      result: RegistrationResult<ContributionRegistration & ManagedResource>,
    ): NexusDiagnostic | null => {
      if (!result.ok) return result.diagnostic;
      resources.push(result.registration);
      return null;
    };

    try {
      for (const [index, command] of (plugin.commands ?? []).entries()) {
        validateLocalId(command.id, "Legacy command");
        const failure = add(this.options.commands.registerCommand(owner, {
          id: command.id,
          name: command.label?.trim() || command.id,
          editorCallback: (context) => {
            command.run(context.editor);
          },
          ...(command.hotkey
            ? { defaultHotkeys: [parseLegacyHotkey(command.hotkey)] }
            : {}),
        }));
        if (failure) return this.rollbackFailure(resources, failure);
        void index;
      }

      for (const [index, shortcut] of (plugin.shortcuts ?? []).entries()) {
        const localId = `legacy-shortcut-${index + 1}`;
        const failure = add(this.options.commands.registerCommand(owner, {
          id: localId,
          name: `${plugin.name} shortcut ${index + 1}`,
          editorCallback: (context) => {
            shortcut.run(context.editor);
          },
          defaultHotkeys: [parseLegacyHotkey(shortcut.key)],
        }));
        if (failure) return this.rollbackFailure(resources, failure);
      }

      for (const [index, extension] of (plugin.cmExtensions ?? []).entries()) {
        const failure = add(this.options.editors.registerEditorExtension(
          owner,
          extension,
          { id: `legacy-extension-${index + 1}` },
        ));
        if (failure) return this.rollbackFailure(resources, failure);
      }

      for (const event of ["paste", "drop", "keydown"] as const) {
        const handler = plugin.handlers?.[event];
        if (!handler) continue;
        const failure = add(this.options.editors.registerDomEvent(
          owner,
          event,
          (domEvent, context) => handler(domEvent as never, {
            editor: context.editor,
            insertMarkdown: (markdown) => {
              const replaced = context.replaceTargetSelection(markdown);
              if (!replaced.ok && context.surface.kind === "document") {
                context.editor.replaceSelection(markdown);
              }
            },
            uploadAsset: (file) => context.editor.uploadAsset(file),
          }) === true ? "consume" : "pass",
        ));
        if (failure) return this.rollbackFailure(resources, failure);
      }

      for (const [index, transform] of (plugin.remarkPlugins ?? []).entries()) {
        const failure = add(this.options.remarkTransforms!.registerLegacyTransform(
          owner,
          `legacy-remark-${index + 1}`,
          transform,
        ));
        if (failure) return this.rollbackFailure(resources, failure);
      }

      for (const [index, widget] of (plugin.widgets ?? []).entries()) {
        const failure = add(this.options.widgets!.registerLegacyWidget(
          owner,
          `legacy-widget-${index + 1}`,
          widget,
        ));
        if (failure) return this.rollbackFailure(resources, failure);
      }

      for (const [index, command] of (plugin.slashCommands ?? []).entries()) {
        const failure = add(this.options.slashCommands!.registerLegacySlashCommand(
          owner,
          `legacy-slash-${index + 1}`,
          command,
        ));
        if (failure) return this.rollbackFailure(resources, failure);
      }

      return {
        ok: true,
        registration: new LegacyPluginRegistration(owner, plugin.name, resources),
      };
    } catch (error) {
      const item = diagnostic(
        owner,
        "legacy-contribution-unsupported",
        `Legacy plugin '${plugin.name}' could not be adapted`,
        `${owner.pluginId}:legacy`,
        error,
      );
      return this.rollbackFailure(resources, item);
    }
  }

  private preflight(owner: ResourceOwner, plugin: NexusPlugin): NexusDiagnostic | null {
    if (!plugin || typeof plugin.name !== "string" || plugin.name.trim().length === 0) {
      return this.emit(diagnostic(
        owner,
        "legacy-contribution-unsupported",
        "Legacy plugin must declare a non-empty name",
      ));
    }
    const unsupported: string[] = [];
    if ((plugin.remarkPlugins?.length ?? 0) > 0 && !this.options.remarkTransforms) {
      unsupported.push("remarkPlugins");
    }
    if ((plugin.widgets?.length ?? 0) > 0 && !this.options.widgets) {
      unsupported.push("widgets");
    }
    if ((plugin.slashCommands?.length ?? 0) > 0 && !this.options.slashCommands) {
      unsupported.push("slashCommands");
    }
    if (unsupported.length === 0) return null;
    return this.emit(diagnostic(
      owner,
      "legacy-contribution-unsupported",
      `Legacy plugin '${plugin.name}' requires unavailable dynamic registries: ${unsupported.join(", ")}`,
      `${owner.pluginId}:legacy`,
    ));
  }

  private rollbackFailure(
    resources: readonly ManagedResource[],
    failure: NexusDiagnostic,
  ): LegacyPluginAdapterResult {
    for (const resource of [...resources].reverse()) {
      try {
        void Promise.resolve(resource.dispose()).catch(() => undefined);
      } catch {
        // The original registration diagnostic remains authoritative.
      }
    }
    return { ok: false, diagnostic: this.emit(failure) };
  }

  private emit(item: NexusDiagnostic): NexusDiagnostic {
    this.reportDiagnostic(item);
    return item;
  }
}
