import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnlineSessionService } from '../../../../src/app/online/OnlineSessionService';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../../src/app/online/onlineSessionStore';
import { DEFAULT_ONLINE_SETTINGS } from '../../../../src/app/online/onlineSettings';
import { decodeControl, encodeControl, type ControlMessage } from '../../../../src/app/online/protocol';
import { JsonDataFile } from '../../../../src/app/online/sharing/dataFile';
import { checkTableProof, makeDeviceProof } from '../../../../src/app/online/sharing/identity/proofs';
import { personKey } from '../../../../src/app/online/sharing/people/peopleTypes';
import { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import { parsePeopleData } from '../../../../src/app/online/sharing/people/peopleTypes';
import { MemoryNetwork } from '../../../../src/app/online/transport/MemoryTransport';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { memorySettings } from '../../connect/memorySettings';
import { presenter } from '../presentedFixtures';
import { nodeIdentityCrypto as crypto, testTable } from './sharingFixtures';
import { PATHS } from './sharingPathsFixture';

const app = { workspace: { on: () => ({}), offref: () => {} }, vault: { getName: () => 'Vault', getAbstractFileByPath: () => null, on: () => ({}), offref: () => {} } } as never;
const settings = memorySettings({ ...DEFAULT_ONLINE_SETTINGS, playerName: 'Morgan' });
const playerViewSettings = { getLocalPlayerViewSettings: () => ({ showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }), onChange: () => () => {} };
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => { resetOnlineSessionStore(); });

async function hosting() {
  const network = new MemoryNetwork();
  const host = network.host('gm-id');
  const table = await testTable();
  const people = new PeopleBook(new JsonDataFile(createInMemoryApp().app.vault.adapter, PATHS.people, parsePeopleData));
  const presented = presenter();
  const shown: Array<{ name: string; identity: unknown; link: (() => void) | null; answer: (allow: boolean) => void }> = [];
  const svc = new OnlineSessionService(app, settings, {
    createHost: async () => host, presented, views: presented.extension.views, playerViewSettings, table: async () => table, identityCrypto: crypto, people,
    showRequest: (player, answer, info) => {
      shown.push({ name: player.name, identity: info?.identity ?? null, link: info?.link ?? null, answer });
      return { hide: () => {} };
    },
  });
  await svc.start();
  const join = async (
    name: string, keys?: Awaited<ReturnType<typeof crypto.generate>>, nonce = 'nonce-aaaaaaaaaaaaaaaa', hostId = 'gm-id', playerKey = `key-${name}-${nonce}`, badSig = false,
  ) => {
    const link = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    link.onMessage((channel, data) => {
      const decoded = decodeControl(data);
      if (channel === 'control' && decoded.kind === 'message') received.push(decoded.message);
    });
    const deviceKeys = keys ?? await crypto.generate();
    const proof = await makeDeviceProof(crypto, deviceKeys, table.id, hostId, nonce);
    const device = badSig ? { ...proof, sig: 'A'.repeat(86) } : proof;
    link.send('control', encodeControl({ v: 1, type: 'join', name, playerKey, client: { kind: 'obsidian', version: '1' }, device }));
    await flush();
    return { link, received, deviceKeys, deviceId: await crypto.keyId(deviceKeys.publicKey) };
  };
  return { svc, table, people, shown, join };
}

describe('OnlineSessionService admitting by identity', () => {
  it('shows a new device as new, and Allow admits with a table proof the player can check', async () => {
    const { svc, table, shown, join } = await hosting();
    const ana = await join('Ana');
    expect(shown[0]).toMatchObject({ name: 'Ana', identity: { kind: 'new', sameName: null }, link: null });
    const playerId = onlineSessionStore.getState().players[0]!.playerId;
    expect(onlineSessionStore.getState().requests[playerId]).toEqual({ kind: 'new', sameName: null });
    shown[0]!.answer(true);
    await flush();
    const admitted = ana.received.find((message) => message.type === 'admitted');
    expect(admitted?.type === 'admitted' && admitted.table && await checkTableProof(crypto, admitted.table, table.id, { hostId: 'gm-id', deviceId: ana.deviceId, nonce: 'nonce-aaaaaaaaaaaaaaaa' })).toBe(true);
    expect(admitted?.type === 'admitted' && admitted.table?.gmName).toBe('Morgan');
    expect(onlineSessionStore.getState().requests).toEqual({});
    svc.stop();
  });

  it('offers Link to Ana for a new device with her name, and links it', async () => {
    const { svc, table, people, shown, join } = await hosting();
    await join('Ana');
    shown[0]!.answer(true);
    await flush();
    const ana = people.byName('Ana')!;
    await join('Ana', undefined, 'nonce-bbbbbbbbbbbbbbbb');
    expect(shown[1]).toMatchObject({ identity: { kind: 'new', sameName: { personId: ana.personId, name: 'Ana' } } });
    shown[1]!.link!();
    await flush();
    expect(people.get(table.id, ana.personId)?.devices).toHaveLength(2);
    expect(onlineSessionStore.getState().players.filter((player) => player.personId === ana.personId)).toHaveLength(2);
    svc.stop();
  });

  it('ignores a second answer for a player whose admission is in flight', async () => {
    const { svc, people, shown, join } = await hosting();
    await join('Ana');
    const signed = vi.spyOn(crypto, 'sign');
    shown[0]!.answer(true);
    shown[0]!.answer(true);
    svc.allow(onlineSessionStore.getState().players[0]!.playerId);
    await flush();
    expect(signed).toHaveBeenCalledTimes(1);
    expect(people.list()).toHaveLength(1);
    expect(onlineSessionStore.getState().players[0]?.status).toBe('admitted');
    signed.mockRestore();
    svc.stop();
  });

  it('signs for the refreshed device proof when the waiting player joins again', async () => {
    const { svc, table, shown, join } = await hosting();
    const first = await join('Ana', undefined, 'nonce-aaaaaaaaaaaaaaaa', 'gm-id', 'same-key');
    const second = await join('Ana', first.deviceKeys, 'nonce-bbbbbbbbbbbbbbbb', 'gm-id', 'same-key');
    expect(shown).toHaveLength(1);
    shown[0]!.answer(true);
    await flush();
    const admitted = second.received.find((message) => message.type === 'admitted');
    const binding = { hostId: 'gm-id', deviceId: second.deviceId };
    expect(admitted?.type === 'admitted' && admitted.table && await checkTableProof(crypto, admitted.table, table.id, { ...binding, nonce: 'nonce-bbbbbbbbbbbbbbbb' })).toBe(true);
    expect(admitted?.type === 'admitted' && admitted.table && await checkTableProof(crypto, admitted.table, table.id, { ...binding, nonce: 'nonce-aaaaaaaaaaaaaaaa' })).toBe(false);
    svc.stop();
  });

  it('denies a waiting player whose refreshed device proof fails, when the GM answers', async () => {
    const { svc, shown, join } = await hosting();
    const first = await join('Ana', undefined, 'nonce-aaaaaaaaaaaaaaaa', 'gm-id', 'same-key');
    const second = await join('Ana', first.deviceKeys, 'nonce-bbbbbbbbbbbbbbbb', 'gm-id', 'same-key', true);
    shown[0]!.answer(true);
    await flush();
    expect(second.received).toContainEqual({ v: 1, type: 'denied', reason: 'denied' });
    expect(onlineSessionStore.getState().players).toEqual([]);
    svc.stop();
  });

  it('asks again, as new, when the person to link to is gone', async () => {
    const { svc, people, shown, join } = await hosting();
    await join('Ana');
    shown[0]!.answer(true);
    await flush();
    await join('Ana', undefined, 'nonce-bbbbbbbbbbbbbbbb');
    const ana = people.byName('Ana')!;
    people.remove(personKey(ana.tableId, ana.personId));
    shown[1]!.link!();
    await flush();
    expect(shown).toHaveLength(3);
    expect(shown[2]).toMatchObject({ identity: { kind: 'new', sameName: null }, link: null });
    const waiting = onlineSessionStore.getState().players.find((player) => player.status === 'pending')!;
    expect(onlineSessionStore.getState().requests[waiting.playerId]).toEqual({ kind: 'new', sameName: null });
    shown[2]!.answer(true);
    await flush();
    expect(onlineSessionStore.getState().players.filter((player) => player.status === 'admitted')).toHaveLength(2);
    svc.stop();
  });

  it('asks again when admitting fails', async () => {
    const { svc, shown, join } = await hosting();
    await join('Ana');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const signed = vi.spyOn(crypto, 'sign').mockRejectedValueOnce(new Error('no key'));
    shown[0]!.answer(true);
    await flush();
    expect(shown).toHaveLength(2);
    expect(onlineSessionStore.getState().players[0]?.status).toBe('pending');
    shown[1]!.answer(true);
    await flush();
    expect(onlineSessionStore.getState().players[0]?.status).toBe('admitted');
    signed.mockRestore();
    error.mockRestore();
    svc.stop();
  });

  it('denies a join whose device proof was made for another host', async () => {
    const { svc, shown, join } = await hosting();
    const eve = await join('Eve', undefined, 'nonce-cccccccccccccccc', 'other-host');
    expect(shown).toEqual([]);
    expect(eve.received).toEqual([{ v: 1, type: 'denied', reason: 'denied' }]);
    svc.stop();
  });
});
