import { describe, expect, it, vi } from 'vitest';
import { DEVICE_KEYS_STORAGE, DeviceKeys, memoryKeyValueStore } from '../../../../src/app/online/sharing/identity/deviceKeys';
import { ensureTableIdentity } from '../../../../src/app/online/sharing/identity/tableKey';
import { DEFAULT_ONLINE_SETTINGS, resolveOnlineSettings } from '../../../../src/app/online/onlineSettings';
import { memorySettings } from '../../connect/memorySettings';
import { nodeIdentityCrypto as crypto } from './sharingFixtures';

describe('device keys', () => {
  it('keeps one key per table on the device, made once', async () => {
    const store = memoryKeyValueStore();
    const generate = vi.spyOn(crypto, 'generate');
    const keys = new DeviceKeys(store, crypto);
    const [a, again] = await Promise.all([keys.forTable('table-a'), keys.forTable('table-a')]);
    expect(again).toEqual(a);
    expect(generate).toHaveBeenCalledTimes(1);
    const b = await keys.forTable('table-b');
    expect(b.publicKey).not.toBe(a.publicKey);
    // A new service on the same device finds them.
    expect(await new DeviceKeys(store, crypto).forTable('table-a')).toEqual(a);
    generate.mockRestore();
  });

  it('replaces a broken stored key', async () => {
    const store = memoryKeyValueStore();
    store.set(DEVICE_KEYS_STORAGE, { 'table-a': { publicKey: 1, privateKey: 'x' } });
    const keys = await new DeviceKeys(store, crypto).forTable('table-a');
    expect(typeof keys.publicKey).toBe('string');
    expect(keys.privateKey).toMatchObject({ kty: 'EC', crv: 'P-256' });
  });
});

describe('table key', () => {
  it('is made on first use, kept in the settings and stable', async () => {
    const source = memorySettings();
    const first = await ensureTableIdentity(source, crypto);
    expect(first.id).toBe(await crypto.keyId(first.keys.publicKey));
    expect(source.get().table).toEqual({ id: first.id, publicKey: first.keys.publicKey, privateKey: first.keys.privateKey });
    expect(await ensureTableIdentity(source, crypto)).toEqual(first);
  });

  it('survives stored settings of any shape', async () => {
    const source = memorySettings();
    const made = await ensureTableIdentity(source, crypto);
    expect(resolveOnlineSettings(JSON.parse(JSON.stringify(source.get()))).table).toEqual(source.get().table);
    expect(resolveOnlineSettings({ table: { id: 'short', publicKey: made.keys.publicKey, privateKey: {} } }).table).toBeNull();
    expect(resolveOnlineSettings({}).table).toBeNull();
  });
});
