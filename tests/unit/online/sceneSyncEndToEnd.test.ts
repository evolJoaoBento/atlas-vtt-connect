import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { SCENE_TICK_MS, SceneHub } from '../../../src/app/online/scene/SceneHub';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { PeerLink, ClientTransport } from '../../../src/app/online/transport/types';
import type { ResourceDefinition } from '@atlas-vtt/api-types';
import { sceneView, type ViewState } from './presentedFixtures';
import { createDefaultInitiativeState } from './sceneFixtures';
import { HUB_PATHS, onHubPath, pathPresenter, pathTabs } from './hubPath';

type SceneState = ViewState;
type Objects = SceneState['objects'];

const HP: ResourceDefinition = {
  key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: false,
};

/** Everything the GM keeps that must never leave the GM's machine carries one of these. */
const SECRETS = ['SECRET', 'secret/', 'notes/', '.md', 'art/', 'maps/', 'dmNote', 'statblock'];

/** No raw message that reached a player may hold a secret; the scan runs at the end of every flow. */
function expectNoSecrets(wire: readonly string[]): void {
  expect(wire.length).toBeGreaterThan(3);
  const everything = wire.join('\n');
  for (const secret of SECRETS) expect(everything.includes(secret), secret).toBe(false);
}

function tavernObjects(): Objects {
  // The DM-only fields (notes, statblocks, tags, hidden) are not all on the public token type.
  const tokens = {
    hero: {
      id: 'hero', kind: 'character', x: 140, y: 140, imagePath: 'art/hero.png', name: 'Hero', resources: { hp: { current: 7, max: 10 } },
      notePath: 'notes/SECRET-hero.md', statblockPath: 'secret/hero.md', dmNotePath: 'secret/dm.md', tags: ['SECRET'], conditions: ['prone'],
    },
    orc: { id: 'orc', kind: 'character', x: 400, y: 140, imagePath: 'art/SECRET-orc.png', name: 'SECRET orc', isHidden: true, resources: { hp: { current: 5, max: 5 } } },
    goblin: { id: 'goblin', kind: 'character', x: 1050, y: 1050, imagePath: 'art/goblin.png', name: 'Goblin', resources: { hp: { current: 3, max: 6 } } },
  } as unknown as Objects['tokens'];
  return {
    tokens,
    fog: { f1: { id: 'f1', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 900, y: 900, width: 400, height: 400 } },
    pins: { p1: { id: 'p1', kind: 'pin', x: 1, y: 1, notePath: 'notes/SECRET-pin.md', label: 'SECRET' } } as Record<string, unknown>,
    texts: { tx: { id: 'tx', kind: 'text', x: 1100, y: 1100, text: 'Beware', fontSize: 16, fontFamily: 'serif', color: '#000000' } },
    drawings: {
      d1: { id: 'd1', kind: 'drawing', timestamp: 2, type: 'pen', points: [{ x: 1000, y: 1000 }, { x: 1010, y: 1010 }], color: '#ff0000', width: 2, opacity: 1 },
    },
    walls: {}, lights: {}, audios: {},
  };
}

function sceneState(background: string, objects: Objects, isMapLoading = false): SceneState {
  return {
    background,
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 } as SceneState['grid'],
    objects,
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading,
    // The view holds Tavern's map, as a loaded view of the Tavern tab does.
    mapLoaded: true,
    mapPath: 'maps/tavern.atlasmap',
  };
}

function patchToken(store: StoreApi<SceneState>, id: string, patch: object): void {
  store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...state.objects.tokens[id]!, ...patch } } } }));
}

function addFog(store: StoreApi<SceneState>, id: string, op: object): void {
  store.setState((state) => ({ objects: { ...state.objects, fog: { ...state.objects.fog, [id]: { id, kind: 'fog', ...op } as never } } }));
}

/** A real GM session, broadcaster, presented scene and players over an in-memory network. */
function world() {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  let rules: PlayerViewRules = { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true };
  // The collection's HP, kept from players until the GM shows it
  let definitions: readonly ResourceDefinition[] = [HP];
  const resourceListeners = new Set<() => void>();
  const listeners = new Set<() => void>();
  const settings = {
    getLocalPlayerViewSettings: (): PlayerViewRules => rules,
    onChange: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const presented = pathPresenter();
  const notices: string[] = [];
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: (message) => notices.push(message), hash: nodeHash });
  const broadcaster = new SceneHub({ tabs: pathTabs(presented), assignments: new SceneAssignments(),
    session: gm, presented, settings, assets, notify: (message) => notices.push(message), resources: () => definitions,
    watchResources: (listener) => { resourceListeners.add(listener); return () => { resourceListeners.delete(listener); }; },
  });
  broadcaster.start();

  const { view, store, tabs, tavern, dungeon } = sceneView(presented, sceneState('maps/tavern.png', tavernObjects()), { mapSize: { width: 2000, height: 1500 } });

  /** Every raw control message that reached any player. */
  const wire: string[] = [];
  const players: PlayerSession[] = [];
  const join = async (playerKey: string): Promise<PlayerSession> => {
    const before = requests.length;
    const inner = network.client();
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const link = await inner.connect(hostId);
        link.onMessage((_channel, data) => { if (typeof data === 'string') wire.push(data); });
        return link;
      },
    };
    const player = new PlayerSession({ hostId: 'gm', name: playerKey, playerKey, clientVersion: '1', transport, onChange: () => {} });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    players.push(player);
    return player;
  };
  return {
    gm, broadcaster, presented, store, tabs, tavern, dungeon, view, wire, notices, join,
    setRules(next: Partial<PlayerViewRules>): void {
      rules = { ...rules, ...next };
      listeners.forEach((listener) => listener());
    },
    setResources(next: readonly ResourceDefinition[]): void {
      definitions = next;
      resourceListeners.forEach((listener) => listener());
    },
    tick: async (): Promise<void> => { await vi.advanceTimersByTimeAsync(SCENE_TICK_MS + 5); },
    /** Every given player has exactly the scene the GM projected last. */
    expectInSync(label: string, ...who: PlayerSession[]): void {
      for (const player of who) expect(player.scene, label).toEqual(broadcaster.currentProjection());
    },
    finish(): void {
      players.forEach((player) => player.stop());
      broadcaster.stop();
      gm.stop();
    },
  };
}

describe.each(HUB_PATHS)('scene sync end to end, $atlas', ({ tabs }) => {
  onHubPath(tabs);
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps players equal to the GM projection through edits, fog and view rules', async () => {
    const w = world();
    const early = await w.join('early');
    expect(early.scene).toBeNull();
    w.presented.present(w.view, w.tavern);
    const late = await w.join('late');
    w.expectInSync('present', early, late);
    expect(Object.keys(early.scene!.tokens)).toEqual(['hero']);
    expect(early.scene!.texts).toEqual({});
    expect(early.scene!.drawings).toEqual({});

    patchToken(w.store, 'hero', { x: 300 });
    await w.tick();
    w.expectInSync('move', early, late);
    expect(early.scene!.tokens.hero?.x).toBe(300);

    // Erasing the fog over the goblin shows it, the text and the drawing: each lies wholly in the erased cells (F-POS).
    addFog(w.store, 'e1', { type: 'rectangle', timestamp: 3, isErasing: true, x: 944, y: 944, width: 216, height: 216 });
    await w.tick();
    w.expectInSync('erase', early, late);
    expect(Object.keys(early.scene!.tokens).sort()).toEqual(['goblin', 'hero']);
    expect(Object.keys(early.scene!.texts)).toEqual(['tx']);
    expect(Object.keys(early.scene!.drawings)).toEqual(['d1']);

    // Painting over the hero takes it away again.
    addFog(w.store, 'b1', { type: 'brush', timestamp: 4, isErasing: false, brushRadius: 80, points: [{ x: 300, y: 140 }, { x: 301, y: 140 }] });
    await w.tick();
    w.expectInSync('brush', early, late);
    expect(early.scene!.tokens.hero).toBeUndefined();

    expect(early.scene!.tokens.goblin?.resources).toEqual([]);
    w.setRules({ showTokenNameplates: true });
    await w.tick();
    w.expectInSync('rules', early, late);
    expect(early.scene!.tokens.goblin?.name).toBe('Goblin');
    // The GM shows HP to players in the collection's settings
    w.setResources([{ ...HP, visibleToPlayers: true }]);
    await w.tick();
    w.expectInSync('resources', early, late);
    expect(early.scene!.tokens.goblin?.resources).toEqual([{ color: '#eab308', share: 0.5, spent: false }]);

    patchToken(w.store, 'goblin', { isHidden: true });
    await w.tick();
    w.expectInSync('hidden', early, late);
    expect(early.scene!.tokens.goblin).toBeUndefined();

    w.presented.clear();
    expect([early.scene, late.scene]).toEqual([null, null]);
    expect(w.notices).toEqual([]);
    expectNoSecrets(w.wire);
    w.finish();
  });

  it('holds and resumes the scene, replaces a second tab and recovers a dropped player', async () => {
    const w = world();
    const first = await w.join('A');
    const other = await w.join('B');
    w.presented.present(w.view, w.tavern);
    w.expectInSync('present', first, other);
    const sceneId = first.scene!.sceneId;

    // The GM browses the dungeon: the map loads into the same store, players keep the tavern.
    w.tabs.getState().setActiveTab(w.dungeon);
    w.store.setState(sceneState('maps/SECRET-dungeon.png', tavernObjects(), true));
    w.store.setState({ objects: { ...tavernObjects(), tokens: {} }, isMapLoading: false });
    await w.tick();
    const held = first.scene;
    expect(Object.keys(held!.tokens)).toEqual(['hero']);
    const joinedWhileHeld = await w.join('C');
    expect(joinedWhileHeld.scene).toEqual(held);

    // Back on the tavern: the map reloads, and the scene resumes with its id.
    w.tabs.getState().setActiveTab(w.tavern);
    w.store.setState(sceneState('maps/tavern.png', tavernObjects(), true));
    await vi.advanceTimersByTimeAsync(0);
    w.store.setState({ isMapLoading: false });
    await w.tick();
    w.expectInSync('resume', first, other, joinedWhileHeld);
    expect(first.scene!.sceneId).toBe(sceneId);

    // A second tab of A replaces the first and is kept up to date.
    const second = await w.join('A');
    await w.tick();
    patchToken(w.store, 'hero', { x: 50, y: 50 });
    await w.tick();
    w.expectInSync('second tab', second, other, joinedWhileHeld);

    // B loses its connection, reconnects on its own and catches up.
    (other as unknown as { link: PeerLink }).link.close();
    await vi.advanceTimersByTimeAsync(3000);
    patchToken(w.store, 'hero', { x: 60 });
    await w.tick();
    w.expectInSync('reconnect', second, other, joinedWhileHeld);
    expect(other.scene!.tokens.hero?.x).toBe(60);

    w.presented.clear();
    expect([second.scene, other.scene, joinedWhileHeld.scene]).toEqual([null, null, null]);
    expectNoSecrets(w.wire);
    w.finish();
  });

  it('never sends secrets in any message', async () => {
    const w = world();
    await w.join('A');
    w.presented.present(w.view, w.tavern);
    w.setRules({ showTokenNameplates: true });
    w.setResources([{ ...HP, visibleToPlayers: true }]);
    patchToken(w.store, 'hero', { x: 200 });
    addFog(w.store, 'e1', { type: 'rectangle', timestamp: 3, isErasing: true, x: 950, y: 950, width: 200, height: 200 });
    await w.tick();
    w.presented.clear();
    expectNoSecrets(w.wire);
    w.finish();
  });
});
