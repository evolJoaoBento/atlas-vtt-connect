import { Notice, type Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';

/**
 * The API major Connect is written against. Minors are never compared: what Connect uses comes from `has()` and from
 * checking the members themselves (`need`, `typeof scenes.replaceMap === 'function'`), so an Atlas whose API starts
 * at 1.0.0 with every capability works, and one without some capabilities runs the features it can.
 */
const SUPPORTED_MAJOR = 1;

/** How long after layout ready Atlas gets to publish its API before Connect says it is missing (Atlas publishes it after its own start-up work). */
export const ATLAS_GRACE_MS = 10_000;

/** Every notice about a missing or wrong Atlas ends here: the README names the Atlas build to install. */
const SEE_README = "See Connect's README for the Atlas build to install.";
export const MISSING_ATLAS_NOTICE = `Atlas VTT Connect: Install or enable Atlas VTT. ${SEE_README}`;
export const NO_API_NOTICE = `Atlas VTT Connect: this Atlas VTT has no extension API yet. ${SEE_README}`;
export const oldApiNotice = (found: string): string => `Atlas VTT Connect needs extension API ${SUPPORTED_MAJOR}.x (found ${found}). ${SEE_README}`;

function isAtlasApi(value: unknown): value is AtlasApi {
  const api = value as Partial<AtlasApi> | null;
  return typeof api === 'object' && api !== null && typeof api.version === 'string'
    && typeof api.has === 'function' && typeof api.connect === 'function';
}

/** Finds Atlas's extension API whichever plugin loads first, and follows Atlas reloading (spec principle 2). */
export class AtlasLink {
  private extension: AtlasExtension | null = null;
  private stop: Disposer | null = null;
  private warnedMissing = false;
  private warnedVersion = false;
  private atlasSeen = false;
  /** The "missing" notice while it is showing: it goes away the moment Atlas's API arrives. */
  private missingNotice: Notice | null = null;
  private graceTimer: number | null = null;
  /** Disposes what Atlas registered for the current connection (it would otherwise wait for Connect to unload). */
  private release: (() => void) | null = null;

  constructor(
    private readonly plugin: Plugin,
    private readonly startWith: (atlas: AtlasExtension, api: AtlasApi) => Disposer,
    private readonly notify: (message: string) => unknown = (message) => new Notice(message),
  ) {}

  get connected(): AtlasExtension | null {
    return this.extension;
  }

  start(): void {
    const { workspace } = this.plugin.app;
    this.plugin.registerEvent(workspace.on('atlas-vtt:api-ready', (api) => this.attach(api)));
    this.plugin.registerEvent(workspace.on('atlas-vtt:api-unload', () => this.detach()));
    this.plugin.register(() => this.detach());
    this.attach(this.plugin.app.plugins?.plugins['atlas-vtt']?.api);
    workspace.onLayoutReady(() => {
      if (this.atlasSeen) return;
      this.graceTimer = window.setTimeout(() => this.warnMissing(), ATLAS_GRACE_MS);
      this.plugin.register(() => this.stopGrace());
    });
  }

  private stopGrace(): void {
    if (this.graceTimer !== null) window.clearTimeout(this.graceTimer);
    this.graceTimer = null;
  }

  /** Atlas has had its grace period and published nothing: say why, unless the API arrived meanwhile. */
  private warnMissing(): void {
    if (this.extension || this.atlasSeen || this.warnedMissing) return;
    this.warnedMissing = true;
    // Atlas loaded but offering no API (an Atlas without the extension API) is not the same as Atlas missing or disabled.
    const shown = this.notify(this.plugin.app.plugins?.plugins['atlas-vtt'] ? NO_API_NOTICE : MISSING_ATLAS_NOTICE);
    this.missingNotice = shown instanceof Notice ? shown : null;
  }

  private attach(value: unknown): void {
    if (!isAtlasApi(value)) return;
    const major = Number(value.version.split('.')[0]);
    this.atlasSeen = true;
    this.stopGrace();
    this.missingNotice?.hide();
    this.missingNotice = null;
    this.detach();
    if (major !== SUPPORTED_MAJOR) {
      if (!this.warnedVersion) this.notify(oldApiNotice(value.version));
      this.warnedVersion = true;
      return;
    }
    const release = this.connectionReleaser();
    try {
      const extension = value.connect({ manifest: this.plugin.manifest, register: release.collect });
      const stop = this.startWith(extension, value);
      this.extension = extension;
      this.stop = stop;
      this.release = release.run;
    } catch (error) {
      this.extension = null;
      this.stop = null;
      // `connect` may have succeeded before `startWith` threw: take its registrations off Atlas again.
      release.run();
      console.error('Atlas VTT Connect could not start on this Atlas:', error);
      this.notify(`Atlas VTT Connect could not start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Collects the teardowns Atlas hands to `plugin.register` during `connect`, so the connection can be disposed on its own. */
  private connectionReleaser(): { collect: (cleanup: () => void) => void; run: () => void } {
    const cleanups: Array<() => void> = [];
    return {
      collect: (cleanup) => { cleanups.push(cleanup); },
      run: () => {
        for (const cleanup of cleanups.splice(0)) {
          try {
            cleanup();
          } catch (error) {
            console.error('Atlas VTT Connect could not release a connection to Atlas:', error);
          }
        }
      },
    };
  }

  private detach(): void {
    const stop = this.stop;
    const release = this.release;
    this.stop = null;
    this.release = null;
    this.extension = null;
    try {
      stop?.();
    } catch (error) {
      console.error('Atlas VTT Connect failed to stop cleanly:', error);
    }
    release?.();
  }
}
