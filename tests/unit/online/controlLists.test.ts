import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeControl } from '../../../src/app/online/protocol';
import { RESYNC_MIN_INTERVAL_MS } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { controlWorld, partyTokens } from './controlFixtures';

describe('control lists', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends each player their own list when their assignments change, and nobody else', async () => {
    const w = controlWorld();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('ally', a.playerId, true);
    w.control.set('hero', a.playerId, false);
    expect(a.controlLists()).toEqual([[], ['hero'], ['hero', 'ally'], ['ally']]);
    expect(b.controlLists()).toEqual([[]]);
    w.finish();
  });

  it('sends the list on admission, again with every resync, and after a reconnect with the same key', async () => {
    const w = controlWorld();
    w.present();
    const a = await w.join('A');
    expect(a.controlLists()).toEqual([[]]);
    w.control.set('hero', a.playerId, true);
    a.sendRaw(encodeControl({ v: 1, type: 'scene-resync', seq: 0 }));
    expect(a.controlLists()).toEqual([[], ['hero'], ['hero']]);
    // The list follows the snapshot it goes with.
    const types = a.received.map((message) => message.type);
    expect(types.lastIndexOf('token-control')).toBeGreaterThan(types.lastIndexOf('scene-snapshot'));

    (a.session as unknown as { link: PeerLink }).link.close();
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.session.state.status).toBe('admitted');
    expect(a.session.state.playerId).toBe(a.playerId);
    expect(a.controlLists().at(-1)).toEqual(['hero']);
    w.finish();
  });

  it('holds the list back with a snapshot the throttle defers, so it still follows it', async () => {
    const w = controlWorld();
    w.present();
    const a = await w.join('A');
    w.control.set('hero', a.playerId, true);
    a.sendRaw(encodeControl({ v: 1, type: 'scene-resync', seq: 0 }));
    const snapshots = a.received.filter((message) => message.type === 'scene-snapshot').length;
    const lists = a.controlLists().length;
    a.sendRaw(encodeControl({ v: 1, type: 'scene-resync', seq: 0 }));
    // Deferred together: neither the snapshot nor the list went out yet.
    expect(a.received.filter((message) => message.type === 'scene-snapshot')).toHaveLength(snapshots);
    expect(a.controlLists()).toHaveLength(lists);
    await vi.advanceTimersByTimeAsync(RESYNC_MIN_INTERVAL_MS);
    const types = a.received.map((message) => message.type);
    expect(types.filter((type) => type === 'scene-snapshot')).toHaveLength(snapshots + 1);
    expect(a.controlLists()).toHaveLength(lists + 1);
    expect(types.lastIndexOf('token-control')).toBeGreaterThan(types.lastIndexOf('scene-snapshot'));
    w.finish();
  });

  it('a removed player loses their tokens; one who is only gone keeps them', async () => {
    const w = controlWorld();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('hero', b.playerId, true);
    (b.session as unknown as { link: PeerLink }).link.close();
    expect(w.gm.getPlayers().find((player) => player.playerId === b.playerId)?.status).toBe('gone');
    w.gm.kick(a.playerId);
    expect(w.control.tokensOf(a.playerId)).toEqual([]);
    expect(w.control.tokensOf(b.playerId)).toEqual(['hero']);
    w.finish();
  });

  it('drops the assignments of a token deleted from the presented scene, and tells its players', async () => {
    const w = controlWorld();
    const scene = w.scene!;
    w.present();
    const a = await w.join('A');
    w.control.set('hero', a.playerId, true);
    w.control.set('ally', a.playerId, true);
    scene.store.setState((state) => {
      const { hero: _hero, ...tokens } = state.objects.tokens;
      return { objects: { ...state.objects, tokens } };
    });
    expect(w.control.tokensOf(a.playerId)).toEqual(['ally']);
    expect(a.controlLists().at(-1)).toEqual(['ally']);
    // Other edits of the scene change nothing.
    scene.store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, ally: { ...state.objects.tokens.ally!, x: 350 } } } }));
    expect(w.control.tokensOf(a.playerId)).toEqual(['ally']);
    w.finish();
  });

  it('keeps assignments while the scene is held, another map loads or presenting stops', async () => {
    const w = controlWorld();
    const scene = w.scene!;
    const noTokens = (): void => scene.store.setState((state) => ({ objects: { ...state.objects, tokens: {} } }));
    w.present();
    const a = await w.join('A');
    w.control.set('hero', a.playerId, true);
    // The GM opens the dungeon tab: the scene is held, and the dungeon map loads into the same store.
    scene.tabs.getState().setActiveTab(scene.dungeon);
    scene.store.setState({ isMapLoading: true });
    scene.store.setState((state) => ({ objects: { ...state.objects, tokens: {} }, isMapLoading: false }));
    expect(w.control.tokensOf(a.playerId)).toEqual(['hero']);
    scene.presented.clear();
    noTokens();
    expect(w.control.tokensOf(a.playerId)).toEqual(['hero']);
    // A map loading in the presented view is a load, not a deletion.
    scene.tabs.getState().setActiveTab(scene.tavern);
    scene.store.setState((state) => ({ objects: { ...state.objects, tokens: { hero: partyTokens().hero! } } }));
    w.present();
    scene.store.setState({ isMapLoading: true });
    noTokens();
    scene.store.setState({ isMapLoading: false });
    expect(w.control.tokensOf(a.playerId)).toEqual(['hero']);
    w.finish();
  });
});
