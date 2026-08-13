declare const pluginIdBrand: unique symbol;
declare const componentIdBrand: unique symbol;
declare const registrationIdBrand: unique symbol;
declare const capabilityIdBrand: unique symbol;
declare const editorIdBrand: unique symbol;
declare const windowIdBrand: unique symbol;
declare const workspaceIdBrand: unique symbol;
declare const leafIdBrand: unique symbol;
declare const viewIdBrand: unique symbol;
declare const fileIdBrand: unique symbol;
declare const operationIdBrand: unique symbol;
declare const vaultPathBrand: unique symbol;

export type PluginId = string & { readonly [pluginIdBrand]: "PluginId" };
export type ComponentId = string & { readonly [componentIdBrand]: "ComponentId" };
export type RegistrationId = string & { readonly [registrationIdBrand]: "RegistrationId" };
export type CapabilityId = string & { readonly [capabilityIdBrand]: "CapabilityId" };
export type EditorId = string & { readonly [editorIdBrand]: "EditorId" };
export type WindowId = string & { readonly [windowIdBrand]: "WindowId" };
export type WorkspaceId = string & { readonly [workspaceIdBrand]: "WorkspaceId" };
export type WorkspaceLeafId = string & { readonly [leafIdBrand]: "WorkspaceLeafId" };
export type ViewId = string & { readonly [viewIdBrand]: "ViewId" };
export type FileId = string & { readonly [fileIdBrand]: "FileId" };
export type OperationId = string & { readonly [operationIdBrand]: "OperationId" };

export type SemanticVersion = string;
export type SemanticVersionRange = string;
export type VaultPath = string & { readonly [vaultPathBrand]: "VaultPath" };
export type ContentVersion = string;
