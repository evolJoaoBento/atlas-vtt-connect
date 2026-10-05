import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { AssetCache, type ImageStore } from '../../../../src/app/online/assets/AssetCache';
import { AssetLoader, type ImageDecoder } from '../../../../src/app/online/assets/AssetLoader';
import { GmSession, type SessionPlayer } from '../../../../src/app/online/GmSession';
import { joinedSessionStore } from '../../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService, type OnlineSceneSink } from '../../../../src/app/online/obsidian/OnlineJoinService';
import { DEFAULT_ONLINE_SETTINGS, type OnlineSettings } from '../../../../src/app/online/onlineSettings';
import { RECONNECT_GIVE_UP_MS, type PlayerSessionState } from '../../../../src/app/online/PlayerSession';
import { MemoryNetwork } from '../../../fake/MemoryTransport';
import type { ClientTransport, PeerLink } from '../../../../src/app/online/transport/types';
import { MemoryStore, nodeHash } from '../assetFixtures';

const LINK = 'https://example.org/join/#id=gm';

function fakeSettings(initial: Partial<OnlineSettings> = {}) {
  let online: OnlineSettings = { ...DEFAULT_ONLINE_SETTINGS, ...initial };
  const listeners = new Set<() => void>();
  return {
    get: (): OnlineSettings => online,
    set: vi.fn((partial: Partial<OnlineSettings>): void => {
      online = { ...online, ...partial };
      listeners.forEach((listener) => listener());
    }),
    onChange: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** A client whose GM can become unreachable, keeping its links. */
function flakyClient(network: MemoryNetwork): { transport: ClientTransport; links: PeerLink[]; setDown(down: boolean): void } {
  let down = false;
  const links: PeerLink[] = [];
  const inner = network.client();
  return {
    links,
    setDown: (value) => { down = value; },
    transport: {
      connect: async (hostId) => {
        if (down) throw Object.assign(new Error('down'), { code: 'unreachable' });
        const link = await inner.connect(hostId);
        links.push(link);
        return link;
      },
    },
  };
}

function recordingSink(): OnlineSceneSink & {
  calls: string[]; states: PlayerSessionState[]; controls: Array<readonly string[]>; logs: number[]; own: string[];
} {
  const calls: string[] = [];
  const own: string[] = [];
  const states: PlayerSessionState[] = [];
  const controls: Array<readonly string[]> = [];
  const logs: number[] = [];
  return {
    calls, states, controls, logs, own,
    ownRoll: (entry) => { calls.push('ownRoll'); own.push(entry.id); },
    session: (state) => { calls.push('session'); states.push(state); },
    scene: () => calls.push('scene'),
    camera: () => calls.push('camera'),
    control: (tokenIds) => { calls.push('control'); controls.push(tokenIds); },
    moveRefused: () => calls.push('moveRefused'),
    diceLog: (entries) => { calls.push('diceLog'); logs.push(entries.length); },
    laser: () => calls.push('laser'),
    images: () => calls.push('images'),
    close: () => calls.push('close'),
  };
}

function world(options: { hosting?: boolean; store?: ImageStore } = {}) {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  let players: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Table', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: (list) => { players = list; },
  });
  gm.start();
  const settings = fakeSettings({ playerName: 'Anna' });
  const client = flakyClient(network);
  const opened = vi.fn(async (): Promise<void> => undefined);
  const decode: ImageDecoder = async () => ({ image: {} as HTMLImageElement, width: 1, height: 1, release: () => {} });
  const service = new OnlineJoinService({} as App, settings, '0.5.0', {
    createClient: () => client.transport, openStore: async () => options.store ?? null, decode, hash: nodeHash, openSceneTab: opened,
    isHosting: () => options.hosting ?? false,
  });
  const admitLast = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
    gm.allow(requests.at(-1)!.playerId);
    await vi.advanceTimersByTimeAsync(0);
  };
  return { network, gm, requests, players: () => players, settings, client, opened, service, admitLast };
}

describe('OnlineJoinService', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    joinedSessionStore.setState({ session: null });
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('joins as an Obsidian player, remembers the name and opens the tab once admitted', async () => {
    const w = world();
    expect(w.service.rememberedName()).toBe('Anna');
    expect(w.service.join(LINK, '  Ben  ')).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(joinedSessionStore.getState().session?.status).toBe('waiting');
    expect(w.players()).toEqual([expect.objectContaining({ name: 'Ben', status: 'pending', client: 'obsidian' })]);
    expect(w.settings.set).toHaveBeenCalledWith({ playerName: 'Ben' });
    expect(w.opened).not.toHaveBeenCalled();
    await w.admitLast();
    expect(joinedSessionStore.getState().session).toMatchObject({ status: 'admitted', title: 'Table' });
    expect(w.opened).toHaveBeenCalledOnce();
    w.service.dispose();
  });

  it('refuses a broken link, a bad name, joining while hosting and a second join', async () => {
    const w = world();
    expect(w.service.join('https://example.org/join/', 'Ben')).toBe('link');
    expect(w.service.join(LINK, '   ')).toBe('name');
    expect(world({ hosting: true }).service.join(LINK, 'Ben')).toBe('hosting');
    expect(w.service.join(LINK, 'Ben')).toBeNull();
    expect(w.service.join(LINK, 'Ben')).toBe('joined');
    w.service.dispose();
  });

  it('gives a tab that attaches what is known so far, then everything new, until it detaches', async () => {
    const w = world();
    w.service.join(LINK, 'Ben');
    await w.admitLast();
    const playerId = w.service.state?.playerId ?? '';
    w.gm.send(playerId, { v: 1, type: 'token-control', tokenIds: ['t1'] });
    const sink = recordingSink();
    const detach = w.service.attach(sink);
    expect(detach).not.toBeNull();
    expect(sink.calls).toEqual(['session', 'control', 'diceLog', 'scene', 'images']);
    expect(sink.controls).toEqual([['t1']]);
    const entry = { id: 'r1', name: 'GM', formula: 'd20', dice: [{ die: 'd20', value: 11 }], modifier: 0, total: 11, at: 1 };
    w.gm.send(playerId, { v: 1, type: 'dice-log', entries: [entry], replay: true });
    w.gm.send(playerId, { v: 1, type: 'dice-log', entries: [{ ...entry, id: 'r2' }], replay: false });
    expect(sink.logs).toEqual([0, 1, 2]);
    // Only a live roll of this player's own is thrown: never a replay, nor someone else's.
    w.gm.send(playerId, { v: 1, type: 'dice-log', entries: [{ ...entry, id: 'r3', mine: true }], replay: true });
    w.gm.send(playerId, { v: 1, type: 'dice-log', entries: [{ ...entry, id: 'r4', mine: true }], replay: false });
    w.gm.send(playerId, { v: 1, type: 'dice-log', entries: [{ ...entry, id: 'r4', mine: true }], replay: false });
    expect(sink.own).toEqual(['r4']);
    expect(sink.calls.slice(-2)).toEqual(['diceLog', 'ownRoll']);
    w.gm.send(playerId, { v: 1, type: 'token-move-refused', tokenId: 't1' });
    expect(sink.calls.at(-1)).toBe('moveRefused');
    detach?.();
    w.gm.send(playerId, { v: 1, type: 'token-control', tokenIds: [] });
    expect(sink.controls).toEqual([['t1']]);
    w.service.dispose();
  });

  it('attaches no tab without a joined session', () => {
    expect(world().service.attach(recordingSink())).toBeNull();
  });

  it('leaving says bye, frees the images and closes the tab; a new join then works', async () => {
    const dispose = vi.spyOn(AssetLoader.prototype, 'dispose');
    const w = world();
    w.service.join(LINK, 'Ben');
    await w.admitLast();
    const sink = recordingSink();
    w.service.attach(sink);
    w.service.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.players().map((player) => player.status)).toEqual(['gone']);
    expect(dispose).toHaveBeenCalledOnce();
    expect(sink.calls.at(-1)).toBe('close');
    expect(joinedSessionStore.getState().session).toBeNull();
    expect(w.service.state).toBeNull();
    expect(w.service.join(LINK, 'Ben')).toBeNull();
    w.service.dispose();
  });

  it("replaces a session that ended and closes its tab", async () => {
    const w = world();
    w.service.join(LINK, 'Ben');
    await w.admitLast();
    const sink = recordingSink();
    w.service.attach(sink);
    w.gm.kick(w.service.state?.playerId ?? '');
    await vi.advanceTimersByTimeAsync(0);
    expect(w.service.state).toMatchObject({ status: 'denied', reason: 'kicked' });
    expect(w.service.join(LINK, 'Ben')).toBeNull();
    expect(sink.calls.at(-1)).toBe('close');
    w.service.dispose();
  });

  it('reconnects after the connection was lost, with the same key and without a new approval or a second tab', async () => {
    const w = world();
    w.service.join(LINK, 'Ben');
    await w.admitLast();
    expect(w.requests).toHaveLength(1);
    w.client.setDown(true);
    w.client.links.at(-1)?.close();
    await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS + 20_000);
    expect(w.service.state).toMatchObject({ status: 'lost', reason: 'connection-lost' });
    w.client.setDown(false);
    w.service.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.service.state?.status).toBe('admitted');
    expect(w.requests).toHaveLength(1);
    expect(w.opened).toHaveBeenCalledOnce();
    w.service.dispose();
  });

  it('deletes the kept images when keeping is switched off in the settings', async () => {
    const setKeep = vi.spyOn(AssetCache.prototype, 'setKeep');
    const w = world();
    w.service.join(LINK, 'Ben');
    w.settings.set({ keepImages: false });
    expect(setKeep).toHaveBeenLastCalledWith(false);
    w.service.dispose();
  });

  it('deletes the stored images when keeping is switched off with no session joined', async () => {
    const store = new MemoryStore();
    await store.put({ id: 'a'.repeat(43), mime: 'image/webp', bytes: new ArrayBuffer(8) }, 1);
    const w = world({ store });
    w.settings.set({ keepImages: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.images.size).toBe(0);
    expect(store.closed).toBe(true);
    w.service.dispose();
  });

  it('leaves the stored images when keeping is switched on with no session joined', async () => {
    const store = new MemoryStore();
    await store.put({ id: 'a'.repeat(43), mime: 'image/webp', bytes: new ArrayBuffer(8) }, 1);
    const w = world({ store });
    w.settings.set({ keepImages: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(store.images.size).toBe(1);
    w.service.dispose();
  });

  it('keeps one player key per GM for the life of the plugin', () => {
    const { service } = world();
    expect(service.playerKeyFor('a')).toBe(service.playerKeyFor('a'));
    expect(service.playerKeyFor('a')).not.toBe(service.playerKeyFor('b'));
  });

  it('refuses to reconnect while hosting', async () => {
    const options = { hosting: false };
    const w = world(options);
    w.service.join(LINK, 'Ben');
    await w.admitLast();
    w.client.setDown(true);
    w.client.links.at(-1)?.close();
    await vi.advanceTimersByTimeAsync(RECONNECT_GIVE_UP_MS + 20_000);
    expect(w.service.state?.status).toBe('lost');
    options.hosting = true;
    w.client.setDown(false);
    expect(w.service.reconnect()).toBe('hosting');
    await vi.advanceTimersByTimeAsync(0);
    expect(w.service.state?.status).toBe('lost');
    options.hosting = false;
    expect(w.service.reconnect()).toBeNull();
    w.service.dispose();
  });

  it('frees the image cache when the session is left, and uses a fresh one for the next', async () => {
    const dispose = vi.spyOn(AssetCache.prototype, 'dispose');
    const store = new MemoryStore();
    const w = world({ store });
    w.service.join(LINK, 'Ben');
    w.settings.set({ keepImages: false });
    await w.admitLast();
    expect(store.closed).toBe(false);
    w.service.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispose).toHaveBeenCalledOnce();
    expect(store.closed).toBe(true);
    w.service.join(LINK, 'Ben');
    w.service.dispose();
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('offers a cleaned remembered name', () => {
    const w = world();
    w.settings.set({ playerName: '  Anna ​ the   Bold ' });
    expect(w.service.rememberedName()).toBe('Anna the Bold');
    w.settings.set({ playerName: '' });
    expect(w.service.rememberedName()).toBe('');
  });
});
