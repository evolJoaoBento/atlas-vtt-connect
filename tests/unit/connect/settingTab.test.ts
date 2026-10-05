import { describe, expect, it } from 'vitest';
import { App, Setting, type Plugin, type SettingDefinitionRender } from 'obsidian';
import { UPDATE_ATLAS_TO_SHARE } from '../../../src/connect/connectSharing';
import { ConnectSettingTab } from '../../../src/connect/settingTab';
import { ConnectSettingsStore } from '../../../src/connect/settingsStore';
import { fakeDataPlugin } from './fakeDataPlugin';

async function renderTab(): Promise<{ tab: ConnectSettingTab; store: ConnectSettingsStore; el: HTMLElement }> {
  const store = await ConnectSettingsStore.load(fakeDataPlugin(null));
  const tab = new ConnectSettingTab(new App(), {} as Plugin, store);
  tab.display();
  return { tab, store, el: tab.containerEl };
}

function rowOf(el: HTMLElement, name: string): HTMLElement {
  const row = [...el.querySelectorAll<HTMLElement>('.setting-item')]
    .find((item) => item.querySelector('.setting-item-name')?.textContent === name);
  if (!row) throw new Error(`No row "${name}"`);
  return row;
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('ConnectSettingTab', () => {
  it('shows the online rows', async () => {
    const { el } = await renderTab();
    const names = [...el.querySelectorAll('.setting-item-name')].map((node) => node.textContent);
    for (const name of ['Signaling server', 'Own server address', 'Relay (TURN) servers', 'Player page', 'Shared note properties', 'Log online play events']) {
      expect(names).toContain(name);
    }
  });

  it('offers the same rows to Obsidian 1.13 and later as definitions, with search terms', async () => {
    const { tab, store } = await renderTab();
    const definitions = tab.getSettingDefinitions() as SettingDefinitionRender[];
    expect(definitions.map((definition) => definition.name)).toEqual([...tab.containerEl.querySelectorAll('.setting-item-name')].map((node) => node.textContent));
    expect(definitions.find((definition) => definition.name === 'Relay (TURN) servers')!.aliases).toContain('turn');
    const host = document.createElement('div');
    const pageRow = definitions.find((definition) => definition.name === 'Player page')!;
    pageRow.render(new Setting(host), undefined as never);
    type(host.querySelector('input')!, 'https://other.example/');
    expect(store.get().playerPageUrl).toBe('https://other.example/');
  });

  it('saves a new player page address, and ignores one that is not a web address', async () => {
    const { el, store } = await renderTab();
    const input = rowOf(el, 'Player page').querySelector('input')!;
    type(input, 'https://my.example/join/');
    expect(store.get().playerPageUrl).toBe('https://my.example/join/');
    type(input, 'not a url');
    expect(store.get().playerPageUrl).toBe('https://my.example/join/');
  });

  it('keeps the own server fields disabled while the PeerJS cloud is chosen, and enables them for a custom server', async () => {
    const { el, store } = await renderTab();
    const address = rowOf(el, 'Own server address');
    const inputs = [...address.querySelectorAll('input')];
    expect(inputs.map((input) => input.getAttribute('aria-label'))).toEqual(['Host', 'Port', 'Path']);
    expect(inputs.every((input) => input.disabled)).toBe(true);
    expect(address.classList.contains('is-disabled')).toBe(true);
    const select = rowOf(el, 'Signaling server').querySelector('select')!;
    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    expect(store.get().signaling.mode).toBe('custom');
    expect(inputs.every((input) => !input.disabled)).toBe(true);
    expect(address.classList.contains('is-disabled')).toBe(false);
    expect(rowOf(el, 'Own server key and TLS').classList.contains('is-disabled')).toBe(false);
  });

  it('gives the own server address and other wide controls their own row, with the host widest', async () => {
    const { el } = await renderTab();
    for (const name of ['Own server address', 'Relay (TURN) servers', 'Player page', 'Shared note properties']) {
      expect(rowOf(el, name).classList.contains('atlas-setting-wrap--below')).toBe(true);
    }
    expect(rowOf(el, 'Own server address').querySelector('input[aria-label="Host"]')!.classList.contains('atlas-setting-wrap__wide')).toBe(true);
  });

  it('saves the relay list and the shared properties', async () => {
    const { el, store } = await renderTab();
    type(rowOf(el, 'Relay (TURN) servers').querySelector('textarea')!, 'turn:relay.example.org:3478 user secret');
    expect(store.get().turnServers).toEqual([{ urls: 'turn:relay.example.org:3478', username: 'user', credential: 'secret' }]);
    type(rowOf(el, 'Shared note properties').querySelector('input')!, 'tags, atlas-share, status');
    expect(store.get().shareableProperties).toEqual(['tags', 'status']);
  });

  it('stops following the settings once the tab is hidden', async () => {
    const { tab, store, el } = await renderTab();
    const address = rowOf(el, 'Own server address');
    tab.hide();
    store.set({ signaling: { ...store.get().signaling, mode: 'custom' } });
    expect(address.classList.contains('is-disabled')).toBe(true);
  });

  it('says to update Atlas while the bound Atlas cannot share notes and maps, and not otherwise', async () => {
    const store = await ConnectSettingsStore.load(fakeDataPlugin(null));
    let notice: string | null = UPDATE_ATLAS_TO_SHARE;
    const tab = new ConnectSettingTab(new App(), {} as Plugin, store, () => notice);
    tab.display();
    expect(rowOf(tab.containerEl, 'Sharing notes and maps').querySelector('.setting-item-description')?.textContent).toBe('Update Atlas VTT to share notes and maps.');
    notice = null;
    tab.display();
    expect(() => rowOf(tab.containerEl, 'Sharing notes and maps')).toThrow();
  });
});
