import {
  Notice, PluginSettingTab, Setting, type App, type Plugin, type SettingDefinitionItem, type TextComponent, type ToggleComponent,
} from 'obsidian';
import { DEFAULT_ONLINE_SETTINGS, formatTurnServers, parseTurnServers, type OnlineSettings } from '../app/online/onlineSettings';
import type { ConnectSettingsStore } from './settingsStore';

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Rows with several controls keep their text readable: the controls wrap below it (`settings-rows.scss`). */
const WRAP_CLASS = 'atlas-setting-wrap';
/** Controls too wide to sit beside the text take their own full-width row under it. */
const BELOW_CLASS = 'atlas-setting-wrap--below';

type Signaling = OnlineSettings['signaling'];

/** One settings row. `render` adds the controls (name and description are already set) and may return its cleanup. */
interface SettingRow {
  name: string;
  desc: string;
  /** Extra terms for Obsidian's settings search. */
  aliases?: string[];
  render: (setting: Setting) => void | (() => void);
}

/** Connect's settings: how online play finds players, and what notes and maps share. */
export class ConnectSettingTab extends PluginSettingTab {
  private cleanups: Array<() => void> = [];

  constructor(app: App, plugin: Plugin, private readonly settings: ConnectSettingsStore) {
    super(app, plugin);
  }

  /** Obsidian 1.13 and later draw (and search) the tab from these. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.rows().map((row) => ({
      name: row.name, desc: row.desc, ...(row.aliases ? { aliases: row.aliases } : {}), render: row.render,
    }));
  }

  /** The same rows, drawn by hand where Obsidian does not read the definitions (before 1.13). */
  display(): void {
    this.hide();
    this.containerEl.empty();
    for (const row of this.rows()) {
      const cleanup = row.render(new Setting(this.containerEl).setName(row.name).setDesc(row.desc));
      if (cleanup) this.cleanups.push(cleanup);
    }
  }

  hide(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }

  private rows(): SettingRow[] {
    return [
      this.signalingRow(), this.addressRow(), this.keyRow(), this.relayRow(), this.pageRow(), this.propertiesRow(), this.imagesRow(), this.logRow(),
    ];
  }

  private signaling(): Signaling {
    return this.settings.get().signaling;
  }

  private setSignaling(partial: Partial<Signaling>): void {
    this.settings.set({ signaling: { ...this.signaling(), ...partial } });
  }

  /** The own server's fields stay in place, shown disabled, while the PeerJS cloud is chosen. */
  private ownServerFields(setting: Setting, fields: Array<TextComponent | ToggleComponent>): () => void {
    const sync = (): void => {
      const off = this.signaling().mode !== 'custom';
      setting.settingEl.toggleClass('is-disabled', off);
      for (const field of fields) field.setDisabled(off);
    };
    sync();
    return this.settings.onChange(sync);
  }

  private signalingRow(): SettingRow {
    return {
      name: 'Signaling server',
      desc: 'Helps players find your session; no game data goes through it. The free PeerJS cloud works out of the box. Only used while a session is running.',
      aliases: ['peerjs', 'online', 'multiplayer', 'remote'],
      render: (setting) => {
        setting.addDropdown((dropdown) => dropdown
          .addOption('cloud', 'PeerJS cloud (free)')
          .addOption('custom', 'My own server')
          .setValue(this.signaling().mode)
          .onChange((value) => this.setSignaling({ mode: value === 'custom' ? 'custom' : 'cloud' })));
      },
    };
  }

  private addressRow(): SettingRow {
    return {
      name: 'Own server address',
      desc: 'Host, port and path of your peerjs-server, used when "My own server" is chosen.',
      render: (setting) => {
        const fields: TextComponent[] = [];
        const field = (label: string, build: (text: TextComponent) => TextComponent): void => {
          setting.addText((text) => {
            fields.push(build(text));
            text.inputEl.setAttribute('aria-label', label);
            if (label === 'Host') text.inputEl.addClass('atlas-setting-wrap__wide');
          });
        };
        setting.setClass(WRAP_CLASS).setClass(BELOW_CLASS);
        field('Host', (text) => text.setPlaceholder('peer.example.org').setValue(this.signaling().host)
          .onChange((value) => this.setSignaling({ host: value.trim() })));
        field('Port', (text) => text.setPlaceholder('443').setValue(String(this.signaling().port))
          .onChange((value) => {
            const number = Number(value);
            if (Number.isInteger(number) && number >= 1 && number <= 65535) this.setSignaling({ port: number });
          }));
        field('Path', (text) => text.setPlaceholder('/').setValue(this.signaling().path)
          .onChange((value) => this.setSignaling({ path: value.trim() || '/' })));
        return this.ownServerFields(setting, fields);
      },
    };
  }

  private keyRow(): SettingRow {
    return {
      name: 'Own server key and TLS',
      desc: 'The key your peerjs-server expects, and whether it uses TLS (https).',
      render: (setting) => {
        const fields: Array<TextComponent | ToggleComponent> = [];
        setting
          .setClass(WRAP_CLASS)
          .addText((text) => {
            fields.push(text
              .setPlaceholder(DEFAULT_ONLINE_SETTINGS.signaling.key)
              .setValue(this.signaling().key)
              .onChange((key) => this.setSignaling({ key: key.trim() || 'peerjs' })));
            text.inputEl.setAttribute('aria-label', 'Key');
          })
          .addToggle((toggle) => {
            fields.push(toggle.setValue(this.signaling().secure).onChange((secure) => this.setSignaling({ secure })));
            toggle.toggleEl.setAttribute('aria-label', 'Use TLS');
          });
        return this.ownServerFields(setting, fields);
      },
    };
  }

  private relayRow(): SettingRow {
    return {
      name: 'Relay (TURN) servers',
      desc: 'For players whose network blocks direct connections. One per line: turn:host:port username password. Players receive these in the join link.',
      aliases: ['turn', 'relay', 'nat', 'firewall'],
      render: (setting) => {
        setting.setClass(WRAP_CLASS).setClass(BELOW_CLASS).addTextArea((area) => area
          .setPlaceholder(formatTurnServers([{ urls: 'turn:relay.example.org:3478', username: 'user', credential: 'password' }]))
          .setValue(formatTurnServers(this.settings.get().turnServers))
          .onChange((text) => this.settings.set({ turnServers: parseTurnServers(text) })));
      },
    };
  }

  private pageRow(): SettingRow {
    return {
      name: 'Player page',
      desc: 'The web page players open to join. Change it if you publish the page yourself.',
      render: (setting) => {
        setting.setClass(WRAP_CLASS).setClass(BELOW_CLASS).addText((text) => {
          text
            .setValue(this.settings.get().playerPageUrl)
            .onChange((url) => { if (isHttpUrl(url.trim())) this.settings.set({ playerPageUrl: url.trim() }); });
          // Once, when the field is left with a changed value, not on every keystroke.
          text.inputEl.addEventListener('change', () => {
            const url = text.inputEl.value.trim();
            if (url && !isHttpUrl(url)) new Notice("That isn't a web address; the player page was not changed.");
          });
        });
      },
    };
  }

  private propertiesRow(): SettingRow {
    return {
      name: 'Shared note properties',
      desc: 'Properties that notes you share keep, separated by commas. All other properties are removed before sending; atlas-share always is.',
      aliases: ['sharing', 'frontmatter', 'atlas-share'],
      render: (setting) => {
        setting.setClass(WRAP_CLASS).setClass(BELOW_CLASS).addText((text) => text
          .setPlaceholder('Tags, aliases')
          .setValue(this.settings.get().shareableProperties.join(', '))
          .onChange((value) => this.settings.set({
            shareableProperties: value.split(',').map((key) => key.trim()).filter((key) => key && key !== 'atlas-share'),
          })));
      },
    };
  }

  private imagesRow(): SettingRow {
    return {
      name: 'Keep online images on this device',
      desc: 'When you join a session from Atlas, keep its images outside your vault so the next session loads faster. Switching it off deletes them.',
      aliases: ['cache', 'images', 'join', 'online'],
      render: (setting) => {
        setting.addToggle((toggle) => toggle
          .setValue(this.settings.get().keepImages)
          .onChange((keepImages) => this.settings.set({ keepImages })));
      },
    };
  }

  private logRow(): SettingRow {
    return {
      name: 'Log online play events',
      desc: 'For troubleshooting: writes what Atlas sends to online players, and every change of the presented scene, to the developer console.',
      aliases: ['debug', 'diagnostics', 'console', 'online'],
      render: (setting) => {
        setting.addToggle((toggle) => toggle
          .setValue(this.settings.get().logEvents)
          .onChange((logEvents) => this.settings.set({ logEvents })));
      },
    };
  }
}
