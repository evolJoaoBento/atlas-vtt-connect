import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GmSession, SESSION_LIMITS, type Admission, type SessionPlayer } from '../../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage, type DeviceProof, type TableProof } from '../../../../src/app/online/protocol';
import { MemoryNetwork } from '../../../../src/app/online/transport/MemoryTransport';

const DEVICE: DeviceProof = { table: 'T'.repeat(43), key: 'K'.repeat(120), nonce: 'N'.repeat(22), sig: 'S'.repeat(86) };
const TABLE: TableProof = { id: 'T'.repeat(43), key: 'G'.repeat(120), personId: 'ana_1', gmName: 'Morgan', sig: 'S'.repeat(86) };

function setup(reissue?: (player: SessionPlayer, device: DeviceProof) => Promise<Admission | null>) {
  const network = new MemoryNetwork();
  const requests: Array<{ player: SessionPlayer; device: DeviceProof | null }> = [];
  const session = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (player, device) => requests.push({ player, device }), onRequestClosed: () => {}, onPlayersChanged: () => {},
    ...(reissue ? { reissue } : {}),
  });
  session.start();
  return { network, session, requests };
}

async function player(network: MemoryNetwork, key: string, device?: DeviceProof) {
  const link = await network.client().connect('gm');
  const received: ControlMessage[] = [];
  link.onMessage((channel, data) => {
    const decoded = decodeControl(data);
    if (channel === 'control' && decoded.kind === 'message') received.push(decoded.message);
  });
  link.send('control', encodeControl({ v: 1, type: 'join', name: 'Ana', playerKey: key, client: { kind: 'obsidian', version: '1' }, ...(device ? { device } : {}) }));
  return { link, received };
}

describe('GmSession identity', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('passes the device proof with the request, and none for a join without one', async () => {
    const { network, requests } = setup();
    await player(network, 'k1', DEVICE);
    await player(network, 'k2');
    expect(requests.map((request) => request.device)).toEqual([DEVICE, null]);
  });

  it('admits with a person id: the table proof goes to the player, the person id to presence', async () => {
    const { network, session, requests } = setup();
    const ana = await player(network, 'k1', DEVICE);
    session.allow(requests[0]!.player.playerId, { personId: 'ana_1', table: TABLE });
    expect(ana.received[0]).toEqual({ v: 1, type: 'admitted', playerId: requests[0]!.player.playerId, session: { title: 'Vault' }, table: TABLE });
    expect(ana.received[1]).toMatchObject({ type: 'presence', players: [{ name: 'Ana', personId: 'ana_1' }] });
    expect(session.getPlayers()[0]).toMatchObject({ personId: 'ana_1' });
    expect(session.personOf(requests[0]!.player.playerId)).toBe('ana_1');
  });

  it('re-admits a reconnect with the same proof and person, without asking again', async () => {
    const { network, session, requests } = setup();
    const first = await player(network, 'k1', DEVICE);
    session.allow(requests[0]!.player.playerId, { personId: 'ana_1', table: TABLE });
    first.link.close();
    const again = await player(network, 'k1', DEVICE);
    expect(requests).toHaveLength(1);
    expect(again.received[0]).toMatchObject({ type: 'admitted', table: TABLE });
    expect(session.getPlayers()[0]).toMatchObject({ personId: 'ana_1', status: 'admitted' });
  });

  it('admits as before without a person id: no table proof, no person in presence', async () => {
    const { network, session, requests } = setup();
    const web = await player(network, 'k1');
    session.allow(requests[0]!.player.playerId);
    expect(web.received[0]).toEqual({ v: 1, type: 'admitted', playerId: requests[0]!.player.playerId, session: { title: 'Vault' } });
    expect(web.received[1]).toEqual({ v: 1, type: 'presence', players: [{ playerId: requests[0]!.player.playerId, name: 'Ana', connected: true }] });
    expect(session.personOf(requests[0]!.player.playerId)).toBeNull();
  });
});

describe('GmSession identity on a new join of a known person', () => {
  const AGAIN: DeviceProof = { ...DEVICE, nonce: 'M'.repeat(22), sig: 'R'.repeat(86) };
  const NEW_TABLE: TableProof = { ...TABLE, sig: 'Z'.repeat(86) };
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  async function admitted(reissue?: Parameters<typeof setup>[0]) {
    const world = setup(reissue);
    const first = await player(world.network, 'k1', DEVICE);
    world.session.allow(world.requests[0]!.player.playerId, { personId: 'ana_1', table: TABLE });
    first.link.close();
    return world;
  }

  it('signs a fresh table proof for the new nonce when the same device comes back', async () => {
    const reissue = vi.fn(async (): Promise<Admission | null> => ({ personId: 'ana_1', table: NEW_TABLE }));
    const { network, session, requests } = await admitted(reissue);
    const again = await player(network, 'k1', AGAIN);
    await vi.advanceTimersByTimeAsync(0);
    expect(reissue).toHaveBeenCalledWith(expect.objectContaining({ personId: 'ana_1' }), AGAIN);
    expect(requests).toHaveLength(1);
    expect(again.received[0]).toMatchObject({ type: 'admitted', table: NEW_TABLE });
    expect(session.getPlayers()[0]).toMatchObject({ personId: 'ana_1', status: 'admitted' });
    // The new proof is the one a later reconnect of this join gets.
    const reconnect = await player(network, 'k1', AGAIN);
    expect(reconnect.received[0]).toMatchObject({ type: 'admitted', table: NEW_TABLE });
  });

  it('denies another device, a join without a device and a refused reissue', async () => {
    const reissue = vi.fn(async (): Promise<Admission | null> => null);
    const { network, session } = await admitted(reissue);
    const other = await player(network, 'k1', { ...AGAIN, key: 'Q'.repeat(120) });
    const none = await player(network, 'k1');
    const refused = await player(network, 'k1', AGAIN);
    await vi.advanceTimersByTimeAsync(0);
    for (const attempt of [other, none, refused]) expect(attempt.received[0]).toEqual({ v: 1, type: 'denied', reason: 'denied' });
    expect(reissue).toHaveBeenCalledTimes(1);
    expect(session.getPlayers()[0]).toMatchObject({ personId: 'ana_1', status: 'gone' });
  });

  it('denies a new nonce when the owner cannot reissue', async () => {
    const { network } = await admitted();
    const again = await player(network, 'k1', AGAIN);
    expect(again.received[0]).toEqual({ v: 1, type: 'denied', reason: 'denied' });
  });

  it('denies a reissue for another person', async () => {
    const { network } = await admitted(async () => ({ personId: 'ben_2', table: NEW_TABLE }));
    const again = await player(network, 'k1', AGAIN);
    await vi.advanceTimersByTimeAsync(0);
    expect(again.received[0]).toEqual({ v: 1, type: 'denied', reason: 'denied' });
  });
});

describe('GmSession identity edge cases', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('denies a reissue that never finishes, after the timeout', async () => {
    const { network, session, requests } = setup(() => new Promise<Admission | null>(() => {}));
    const first = await player(network, 'k1', DEVICE);
    session.allow(requests[0]!.player.playerId, { personId: 'ana_1', table: TABLE });
    first.link.close();
    const again = await player(network, 'k1', { ...DEVICE, nonce: 'M'.repeat(22), sig: 'R'.repeat(86) });
    await vi.advanceTimersByTimeAsync(SESSION_LIMITS.reissueTimeoutMs - 1);
    expect(again.received).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(again.received[0]).toEqual({ v: 1, type: 'denied', reason: 'denied' });
  });

  it('keeps a waiting request to its device, taking the newer proof of the same key', async () => {
    const { network, session, requests } = setup();
    await player(network, 'k1', DEVICE);
    const newer = { ...DEVICE, nonce: 'M'.repeat(22), sig: 'R'.repeat(86) };
    await player(network, 'k1', newer);
    expect(requests).toHaveLength(1);
    const stranger = await player(network, 'k1', { ...DEVICE, key: 'Q'.repeat(120) });
    expect(stranger.received[0]).toEqual({ v: 1, type: 'denied', reason: 'denied' });
    expect(session.getPlayers()[0]).toMatchObject({ status: 'pending' });
  });

  async function reissuing() {
    const world = setup(() => new Promise<Admission | null>(() => {}));
    const first = await player(world.network, 'k1', DEVICE);
    world.session.allow(world.requests[0]!.player.playerId, { personId: 'ana_1', table: TABLE });
    first.link.close();
    const again = await player(world.network, 'k1', { ...DEVICE, nonce: 'M'.repeat(22), sig: 'R'.repeat(86) });
    return { ...world, again };
  }

  it('clears the reissue timer when the connection closes, and sends nothing later', async () => {
    const { again } = await reissuing();
    const waiting = vi.getTimerCount();
    again.link.close();
    expect(vi.getTimerCount()).toBe(waiting - 1);
    await vi.advanceTimersByTimeAsync(SESSION_LIMITS.reissueTimeoutMs);
    expect(again.received).toEqual([]);
  });

  it('clears the reissue timer when the session stops', async () => {
    const { session, again } = await reissuing();
    session.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(SESSION_LIMITS.reissueTimeoutMs);
    expect(again.received.filter((message) => message.type === 'denied')).toEqual([]);
  });

  it('knows the device proof of a waiting request after a takeover refreshed it', async () => {
    const { network, session, requests } = setup();
    await player(network, 'k1', DEVICE);
    const playerId = requests[0]!.player.playerId;
    expect(session.deviceOf(playerId)).toEqual(DEVICE);
    const newer = { ...DEVICE, nonce: 'M'.repeat(22), sig: 'R'.repeat(86) };
    await player(network, 'k1', newer);
    expect(session.deviceOf(playerId)).toEqual(newer);
    expect(session.deviceOf('nobody')).toBeNull();
  });
});
