import { Notice, type Plugin } from 'obsidian';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';

const SUPPORTED_MAJOR = 1;

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
  private sawIncompatible = false;

  constructor(
    private readonly plugin: Plugin,
    private readonly startWith: (atlas: AtlasExtension, api: AtlasApi) => Disposer,
    private readonly notify: (message: string) => void = (message) => new Notice(message),
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
      if (this.extension || this.sawIncompatible || this.warnedMissing) return;
      this.warnedMissing = true;
      this.notify('Atlas VTT Connect needs Atlas VTT. Install or enable it, then reload.');
    });
  }

  private attach(value: unknown): void {
    if (!isAtlasApi(value)) return;
    const major = Number(value.version.split('.')[0]);
    if (major !== SUPPORTED_MAJOR) {
      this.sawIncompatible = true;
      if (!this.warnedVersion) this.notify(`Atlas VTT Connect needs Atlas VTT with extension API ${SUPPORTED_MAJOR}.x (found ${value.version}).`);
      this.warnedVersion = true;
      return;
    }
    this.detach();
    this.extension = value.connect(this.plugin);
    this.stop = this.startWith(this.extension, value);
  }

  private detach(): void {
    const stop = this.stop;
    this.stop = null;
    this.extension = null;
    stop?.();
  }
}
