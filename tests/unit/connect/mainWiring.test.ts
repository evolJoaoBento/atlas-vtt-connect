import { describe, expect, it, vi } from 'vitest';
import type { AtlasApi, AtlasExtension, Disposer } from '@atlas-vtt/api-types';
import type { ConnectOptions } from '../../../src/connect/startConnect';
import { createInMemoryApp } from '../../mocks/inMemoryVault';

type StartWith = (atlas: AtlasExtension, api: AtlasApi) => Disposer;
const links = vi.hoisted(() => ({ startWith: [] as unknown[] }));

vi.mock('../../../src/connect/startConnect', () => ({ startConnect: vi.fn(() => () => undefined) }));
vi.mock('../../../src/connect/atlasLink', () => ({
  AtlasLink: class {
    constructor(_plugin: unknown, startWith: unknown) { links.startWith.push(startWith); }
    start(): void {}
  },
}));

const { startConnect } = await import('../../../src/connect/startConnect');
const { default: AtlasVttConnectPlugin } = await import('../../../main');

/** Connect's plugin over an in-memory vault, with the Plugin methods `onload` calls. */
function loadedPlugin(): InstanceType<typeof AtlasVttConnectPlugin> {
  const { app } = createInMemoryApp();
  const plugin = new AtlasVttConnectPlugin(app, { id: 'atlas-vtt-connect', version: '0.1.0' } as never);
  Object.assign(plugin, {
    loadData: async () => null,
    saveData: async () => undefined,
    registerView: vi.fn(),
    register: vi.fn(),
    registerEvent: vi.fn(),
  });
  return plugin;
}

describe('main.ts wiring', () => {
  it("passes the plugin's player keys and settings store to every binding, so an Atlas reload keeps the keys", async () => {
    const plugin = loadedPlugin();
    await plugin.onload();
    const startWith = links.startWith.at(-1) as StartWith;
    startWith({} as AtlasExtension, {} as AtlasApi);
    startWith({} as AtlasExtension, {} as AtlasApi); // Atlas reloaded: a new binding
    const calls = vi.mocked(startConnect).mock.calls;
    expect(calls).toHaveLength(2);
    const [first, second] = calls.map((call) => call[3] as ConnectOptions);
    expect(first!.playerKeys).toBeTypeOf('function');
    expect(second!.playerKeys).toBe(first!.playerKeys);
    expect(second!.playerKeys!('gm-host')).toBe(first!.playerKeys!('gm-host'));
    expect(first!.playerKeys!('other-host')).not.toBe(first!.playerKeys!('gm-host'));
    // The fork's data is brought into the plugin's own settings store.
    expect(first!.settings).toBe(plugin.settings);
    expect(first!.migration).toBe(plugin.settings);
    expect(second!.lifetime).toBe(first!.lifetime);
  });

  it('offers New table key from load on, whether or not Atlas is bound', async () => {
    const plugin = loadedPlugin();
    await plugin.onload();
    expect((plugin as unknown as { commands: Record<string, { name: string }> }).commands['new-table-key']?.name).toBe('New table key…');
  });
});
