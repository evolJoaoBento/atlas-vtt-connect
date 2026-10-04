import { Plugin } from 'obsidian';
import './styles/main.scss';
import { AtlasLink } from './src/connect/atlasLink';
import { ConnectSettingsStore } from './src/connect/settingsStore';
import { ConnectSettingTab } from './src/connect/settingTab';
import { startConnect } from './src/connect/startConnect';

export default class AtlasVttConnectPlugin extends Plugin {
  /** Connect's own settings; narrows the base class's `settings?: unknown`. */
  declare settings: ConnectSettingsStore;

  async onload(): Promise<void> {
    this.settings = await ConnectSettingsStore.load(this);
    this.addSettingTab(new ConnectSettingTab(this.app, this, this.settings));
    new AtlasLink(this, (atlas, api) => startConnect(this, atlas, api)).start();
    // Further services are added task by task (plan B4 onwards).
  }

  onunload(): void {
    void this.settings.flush();
  }
}
