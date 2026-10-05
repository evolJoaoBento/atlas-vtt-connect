import { describe, expect, it, vi } from 'vitest';
import { NEW_TABLE_KEY_CONFIRM, NEW_TABLE_KEY_DONE, NEW_TABLE_KEY_NOT_KEPT, newTableKey, STOP_HOSTING_FIRST } from '../../../src/connect/newTableKey';
import { ConnectSettingsStore, TABLE_KEY_STORAGE } from '../../../src/connect/settingsStore';
import { memoryKeyValueStore } from '../../../src/app/online/sharing/identity/deviceKeys';
import { nodeIdentityCrypto } from '../online/sharing/sharingFixtures';
import { fakeDataPlugin } from './fakeDataPlugin';

const TABLE = { id: 'a'.repeat(43), publicKey: 'public-key', privateKey: { kty: 'EC', crv: 'P-256', d: 'secret', x: 'x', y: 'y' } };

async function setup(hosting: () => boolean = () => false, answer = true): Promise<{
  run: () => ReturnType<typeof newTableKey>; store: ConnectSettingsStore; local: ReturnType<typeof memoryKeyValueStore>;
  plugin: ReturnType<typeof fakeDataPlugin>; confirm: ReturnType<typeof vi.fn>; notices: string[];
}> {
  const plugin = fakeDataPlugin(null);
  const local = memoryKeyValueStore();
  local.set(TABLE_KEY_STORAGE, TABLE);
  const store = await ConnectSettingsStore.load(plugin, local);
  const notices: string[] = [];
  const confirm = vi.fn(async () => answer);
  const run = (): ReturnType<typeof newTableKey> => newTableKey({ settings: store, crypto: nodeIdentityCrypto, isHosting: hosting, confirm, notify: (message) => { notices.push(message); } });
  return { run, store, local, plugin, confirm, notices };
}

describe('New table key', () => {
  it('asks first, saying every player must be approved again, then keeps a new key on this device only', async () => {
    const { run, store, local, plugin, confirm, notices } = await setup();
    expect(await run()).toBe('made');
    expect(confirm).toHaveBeenCalledWith(NEW_TABLE_KEY_CONFIRM);
    expect(NEW_TABLE_KEY_CONFIRM.message.join(' ')).toMatch(/Every player must be approved again/);
    const made = store.get().table!;
    expect(made.id).not.toBe(TABLE.id);
    expect(local.get(TABLE_KEY_STORAGE)).toEqual(made);
    await store.flush();
    expect(JSON.stringify(plugin.saved)).not.toContain(made.privateKey.d!);
    expect(notices).toEqual([NEW_TABLE_KEY_DONE]);
  });

  it('keeps the key when the GM says no', async () => {
    const { run, store } = await setup(() => false, false);
    expect(await run()).toBe('cancelled');
    expect(store.get().table).toEqual(TABLE);
  });

  it('refuses while a session is hosted, before asking, and when one started while the dialog was open', async () => {
    const hosted = await setup(() => true);
    expect(await hosted.run()).toBe('hosting');
    expect(hosted.confirm).not.toHaveBeenCalled();
    expect(hosted.notices).toEqual([STOP_HOSTING_FIRST]);
    let hosting = false;
    const started = await setup(() => hosting);
    started.confirm.mockImplementation(async () => { hosting = true; return true; });
    expect(await started.run()).toBe('hosting');
    expect(started.store.get().table).toEqual(TABLE);
  });

  it('keeps the old key, and says so, when local storage refuses the new one', async () => {
    const plugin = fakeDataPlugin(null);
    const held = { [TABLE_KEY_STORAGE]: TABLE };
    const store = await ConnectSettingsStore.load(plugin, { get: (key) => held[key as keyof typeof held] ?? null, set: () => {} });
    const notices: string[] = [];
    const result = await newTableKey({ settings: store, crypto: nodeIdentityCrypto, isHosting: () => false, confirm: async () => true, notify: (message) => { notices.push(message); } });
    expect(result).toBe('not-kept');
    expect(store.get().table).toEqual(TABLE);
    expect(notices).toEqual([NEW_TABLE_KEY_NOT_KEPT]);
    await store.flush();
    expect(JSON.stringify(plugin.saved)).not.toContain('"d"');
  });
});

