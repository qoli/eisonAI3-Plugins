export type PluginOperation = "describe" | "probe" | "collect" | "detail";
export type PluginBrowserProfile = "systemSafari";

export interface PluginRequest {
  operation: PluginOperation;
  collectionID?: string;
  sourceItemID?: string;
  cursor?: unknown;
  limit?: number;
}

export interface PluginManifest {
  id: string;
  displayName: string;
  protocolVersion: 0;
  revision: string;
  loginURL: string;
  browserProfile?: PluginBrowserProfile;
  collections: Array<{
    id: string;
    displayName: string;
    kind: "favorite" | "like";
  }>;
  capabilities: {
    sourceSavedAt: boolean;
    resumableCursor: boolean;
    detailNavigation: boolean;
    orderedMedia: boolean;
  };
}

export interface PluginResponse {
  status:
    | "ready"
    | "needsLogin"
    | "needsUserVerification"
    | "batch"
    | "sourceStructureChanged"
    | "temporaryNetworkFailure"
    | "rateLimited"
    | "endConfirmed"
    | "endUnconfirmed";
  manifest?: PluginManifest;
  sourceAccount?: { id: string; displayName?: string | null };
  collectionID?: string;
  records?: unknown[];
  cursor?: unknown;
  next?: { kind: "scroll" | "navigate" | "wait"; [key: string]: unknown };
  diagnostics?: Record<string, unknown>;
}

export interface EisonPlugin {
  manifest: PluginManifest;
  run(request: PluginRequest): Promise<PluginResponse> | PluginResponse;
}

declare global {
  var eison: {
    registerPlugin(plugin: EisonPlugin): void;
  };
}
