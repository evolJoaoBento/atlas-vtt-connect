import type { Plugin as Plugin_2 } from 'obsidian';

/**
 * Semver of the extension API, independent of Atlas's own version (docs/extension-api.md).
 * Minor: something added. Major: something removed, renamed or tightened. The API report
 * check fails when `api-report/` changes and this does not.
 */
export declare const API_VERSION = "1.0.0";

/** `app.plugins.plugins['atlas-vtt'].api`, set once Atlas's storage and asset index are ready. */
export declare interface AtlasApi {
    /** Semver of this API, e.g. "1.0.0"; independent of Atlas's own version. */
    readonly version: string;
    has(capability: AtlasCapability): boolean;
    /** Scopes everything to `plugin.manifest.id`; registrations are disposed when either plugin unloads. */
    connect(plugin: ConnectingPlugin): AtlasExtension;
}

export declare type AtlasCapability = 'views' | 'presentation' | 'rules' | 'lighting' | 'tokens' | 'dice' | 'lasers' | 'ui' | 'scenes' | 'bundles' | 'settings' | 'storage' | 'remote-view';

export declare interface AtlasEvents {
    /** Atlas is unloading; everything is disposed after this. */
    unload: () => void;
}

export declare interface AtlasExtension {
    /** The calling plugin's manifest id. */
    readonly id: string;
    on<E extends keyof AtlasEvents>(event: E, listener: AtlasEvents[E]): Disposer;
}

/** What `connect` needs of the calling plugin: its id, and where to register its own teardown. */
export declare type ConnectingPlugin = Pick<Plugin_2, 'manifest' | 'register'>;

/** Removes a registration; calling it again does nothing. */
export declare type Disposer = () => void;

/** Plain JSON: all an extension may keep on Atlas's records. */
export declare type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};

export declare interface Point {
    x: number;
    y: number;
}

/** An Atlas map view (`AtlasView.viewId`); never reused once the view closed. */
export declare type ViewId = string;

export { }
