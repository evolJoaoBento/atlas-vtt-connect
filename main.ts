import { Notice, Plugin } from 'obsidian';
import './styles/main.scss';
import { CanvasSceneView } from './src/app/online/obsidian/CanvasSceneView';
import { ONLINE_SCENE_VIEW_TYPE } from './src/app/online/obsidian/onlineSceneTab';
import { keyPerHost } from './src/app/online/obsidian/keyPerHost';
import { AtlasLink } from './src/connect/atlasLink';
import { ConnectSettingsStore } from './src/connect/settingsStore';
import { KEY_MOVED_NOTICE, registerNewTableKey } from './src/connect/newTableKey';
import { obsidianLocalStore } from './src/app/online/sharing/identity/deviceKeys';
import { UPDATE_ATLAS_TO_SHARE } from './src/connect/connectSharing';
import { ConnectSettingTab } from './src/connect/settingTab';
import { sharingLifetime } from './src/app/online/sharing/sharingLifetime';
import { startConnect } from './src/connect/startConnect';

export default class AtlasVttConnectPlugin extends Plugin {
  /** Connect's own settings; narrows the base class's `settings?: unknown`. */
  declare settings: ConnectSettingsStore;

  /** One key per GM host for the plugin's lifetime: a join after an Atlas reload is recognised by the GM. */
  private readonly playerKeys = keyPerHost();
  /** Whether the bound Atlas can share notes and maps; null while none is bound. */
  private canShare: boolean | null = null;

  async onload(): Promise<void> {
    this.settings = await ConnectSettingsStore.load(this, obsidianLocalStore(this.app), (message) => { new Notice(message); });
    if (this.settings.takeKeyMoved()) new Notice(KEY_MOVED_NOTICE);
    registerNewTableKey(this, this.settings);
    // Registered at load, so a scene tab Obsidian restores at startup exists and closes itself cleanly.
    this.registerView(ONLINE_SCENE_VIEW_TYPE, (leaf) => new CanvasSceneView(leaf));
    this.addSettingTab(new ConnectSettingTab(this.app, this, this.settings, () => (this.canShare === false ? UPDATE_ATLAS_TO_SHARE : null)));
    // Heard from load on, before Atlas is bound: what the metadata cache parsed, and the vault's renames and deletions.
    const lifetime = sharingLifetime(this);
    new AtlasLink(this, (atlas, api) => startConnect(this, atlas, api, {
      settings: this.settings, migration: this.settings, playerKeys: this.playerKeys, lifetime, sharing: (available) => { this.canShare = available; },
    })).start();
  }

  /**
   * Obsidian runs this before the `register()` cleanups, which stop the sessions (`AtlasLink`). The second flush
   * runs once those are done, so a setting written during teardown is saved too, not left to the debounce timer.
   */
  onunload(): void {
    void this.settings.flush();
    queueMicrotask(() => { void this.settings.flush(); });
  }
}
