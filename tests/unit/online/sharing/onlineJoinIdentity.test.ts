import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { GmSession, type SessionPlayer } from '../../../../src/app/online/GmSession';
import { joinedSessionStore } from '../../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type SessionIdentity } from '../../../../src/app/online/obsidian/OnlineJoinService';
import { DEFAULT_ONLINE_SETTINGS, type OnlineSettings } from '../../../../src/app/online/onlineSettings';
import type { DeviceProof } from '../../../../src/app/online/protocol';
import { DeviceKeys, memoryKeyValueStore } from '../../../../src/app/online/sharing/identity/deviceKeys';
import { checkDeviceProof, makeTableProof, type TableBinding } from '../../../../src/app/online/sharing/identity/proofs';
import { hostedTable, tableReissuer } from '../../../../src/app/online/sharing/identity/reissue';
import { RECONNECT_DELAYS_MS } from '../../../../src/app/online/PlayerSession';
import { MemoryNetwork } from '../../../../src/app/online/transport/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../../src/app/online/transport/types';
import { nodeHash } from '../assetFixtures';
import { nodeIdentityCrypto as crypto, testTable } from './sharingFixtures';

function settings() {
  let online: OnlineSettings = { ...DEFAULT_ONLINE_SETTINGS };
  return {
    get: (): OnlineSettings => online,
    set: (partial: Partial<OnlineSettings>): void => { online = { ...online, ...partial }; },
    onChange: (): (() => void) => () => {},
  };
}

async function world(client: (network: MemoryNetwork) => ClientTransport = (network) => network.client(), reissue = false) {
  const network = new MemoryNetwork();
  const table = await testTable();
  const requests: Array<{ player: SessionPlayer; device: DeviceProof | null }> = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Table', onJoinRequest: (player, device) => requests.push({ player, device }), onRequestClosed: () => {}, onPlayersChanged: () => {},
    ...(reissue ? { reissue: tableReissuer(hostedTable(crypto, table, 'gm', () => 'Morgan')) } : {}),
  });
  gm.start();
  const identities: Array<SessionIdentity | null> = [];
  const service = new OnlineJoinService({} as App, settings(), '0.5.0', {
    createClient: () => client(network), openStore: async () => null, decode: async () => null, hash: nodeHash,
    openSceneTab: async () => {}, isHosting: () => false,
    identityCrypto: crypto, deviceKeys: new DeviceKeys(memoryKeyValueStore(), crypto),
  });
  service.onIdentity((identity) => identities.push(identity));
  return { gm, table, service, requests, identities };
}

/** The binding a GM at host `gm` signs for a verified device proof. */
async function binding(device: DeviceProof, hostId = 'gm'): Promise<TableBinding> {
  return { hostId, deviceId: await crypto.keyId(device.key), nonce: device.nonce };
}

describe('joining with an identity', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    joinedSessionStore.setState({ session: null });
    vi.useRealTimers();
  });

  it('presents a device proof for the link table and the GM host, and takes the verified table identity', async () => {
    const { gm, table, service, requests, identities } = await world();
    expect(service.join(`https://example.org/#id=gm&table=${table.id}`, 'Ana')).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    const device = requests[0]!.device!;
    expect(await checkDeviceProof(crypto, device, table.id, 'gm')).not.toBeNull();
    gm.allow(requests[0]!.player.playerId, { personId: 'ana_1', table: await makeTableProof(crypto, table, await binding(device), 'ana_1', 'Morgan') });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.identity).toEqual({ tableId: table.id, personId: 'ana_1', gmName: 'Morgan' });
    expect(identities.at(-1)).toEqual(service.identity);
    service.leave();
    expect(service.identity).toBeNull();
    expect(identities.at(-1)).toBeNull();
  });

  it('turns sharing off for a forged table proof, but plays on', async () => {
    const { gm, table, service, requests } = await world();
    service.join(`https://example.org/#id=gm&table=${table.id}`, 'Ana');
    await vi.advanceTimersByTimeAsync(0);
    const fake = await testTable();
    const forged = { ...(await makeTableProof(crypto, fake, await binding(requests[0]!.device!), 'ana_1', 'Morgan')), id: table.id };
    gm.allow(requests[0]!.player.playerId, { personId: 'ana_1', table: forged });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.state?.status).toBe('admitted');
    expect(service.identity).toBeNull();
  });

  it.each(['device', 'host'] as const)('turns sharing off for a table proof signed for another %s, but plays on', async (kind) => {
    const { gm, table, service, requests } = await world();
    service.join(`https://example.org/#id=gm&table=${table.id}`, 'Ana');
    await vi.advanceTimersByTimeAsync(0);
    const device = requests[0]!.device!;
    const own = await binding(device);
    const other = kind === 'device' ? { ...own, deviceId: await crypto.keyId((await crypto.generate()).publicKey) } : { ...own, hostId: 'other-host' };
    gm.allow(requests[0]!.player.playerId, { personId: 'mallory', table: await makeTableProof(crypto, table, other, 'mallory', 'Morgan') });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.state?.status).toBe('admitted');
    expect(service.identity).toBeNull();
  });

  it('presents no device and has no identity for a link without a table', async () => {
    const { gm, service, requests } = await world();
    service.join('https://example.org/#id=gm', 'Ana');
    await vi.advanceTimersByTimeAsync(0);
    expect(requests[0]!.device).toBeNull();
    gm.allow(requests[0]!.player.playerId);
    await vi.advanceTimersByTimeAsync(0);
    expect(service.state?.status).toBe('admitted');
    expect(service.identity).toBeNull();
  });

  it('reconnects with the same proof: the GM re-admits without asking and the identity stays', async () => {
    const links: PeerLink[] = [];
    const { gm, table, service, requests } = await world((network) => ({
      connect: async (hostId) => {
        const link = await network.client().connect(hostId);
        links.push(link);
        return link;
      },
    }));
    service.join(`https://example.org/#id=gm&table=${table.id}`, 'Ana');
    await vi.advanceTimersByTimeAsync(0);
    gm.allow(requests[0]!.player.playerId, { personId: 'ana_1', table: await makeTableProof(crypto, table, await binding(requests[0]!.device!), 'ana_1', 'Morgan') });
    await vi.advanceTimersByTimeAsync(0);
    links[0]!.close();
    await vi.advanceTimersByTimeAsync(RECONNECT_DELAYS_MS[0]);
    expect(links).toHaveLength(2);
    expect(requests).toHaveLength(1);
    expect(gm.getPlayers()[0]).toMatchObject({ status: 'admitted', personId: 'ana_1' });
    expect(service.identity?.personId).toBe('ana_1');
  });

  it('leaves and joins again: the GM checks the same device and signs the new nonce, with no new request', async () => {
    const { gm, table, service, requests } = await world(undefined, true);
    const link = `https://example.org/#id=gm&table=${table.id}`;
    service.join(link, 'Ana');
    await vi.advanceTimersByTimeAsync(0);
    const first = requests[0]!.device!;
    gm.allow(requests[0]!.player.playerId, { personId: 'ana_1', table: await makeTableProof(crypto, table, await binding(first), 'ana_1', 'Morgan') });
    await vi.advanceTimersByTimeAsync(0);
    expect(service.identity?.personId).toBe('ana_1');
    service.leave();
    await vi.advanceTimersByTimeAsync(0);
    service.join(link, 'Ana');
    await vi.advanceTimersByTimeAsync(0);
    expect(requests).toHaveLength(1);
    expect(service.state?.status).toBe('admitted');
    expect(service.identity).toEqual({ tableId: table.id, personId: 'ana_1', gmName: 'Morgan' });
    expect(gm.getPlayers()[0]).toMatchObject({ status: 'admitted', personId: 'ana_1' });
  });
});
