import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoreApi } from 'zustand/vanilla';
import type { Character, DrawingStroke, FogOperation, InitiativeEntry, InitiativeRules, ResourceDefinition } from '@atlas-vtt/api-types';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl, MAX_CONTROL_MESSAGE_BYTES, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import { REMOTE_FOG_LIMITS } from '../../../src/app/online/scene/remoteFogLimits';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { readFileSync } from 'node:fs';
import { createTabScenes } from '../../../src/app/online/atlas/tabScenes';
import { applied, recordFlows, replay, segment, seqsUnbroken, states, type StreamHandlerInput, type Streams } from './sceneStreamFlows';
import { FOG_TRUNCATED_NOTICE, SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE, SceneHub } from '../../../src/app/online/scene/SceneHub';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import { patchMessage, snapshotMessages, splitParts } from '../../../src/app/online/scene/sceneMessages';
import { MAP_SIZE_POLL_MS } from '../../../src/app/online/scene/sceneTicks';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { fingerprintOf, memoryImageFiles, nodeHash, type MemoryImageFiles } from './assetFixtures';
import { presenter, sceneView, type Presenter, type SceneView, type ViewState } from './presentedFixtures';
import { createDefaultInitiativeState, fogRect, playerScene } from './sceneFixtures';

type SceneState = ViewState & { camera: { x: number; y: number; scale: number } };

function character(id: string, x: number, overrides: Partial<Character> = {}): Character {
  return { id, kind: 'character', x, y: 140, imagePath: `art/${id}.png`, name: id, resources: { hp: { current: 7, max: 10 } }, ...overrides };
}

function sceneState(tokens: Record<string, Character>, fog: Record<string, FogOperation> = {}): SceneState {
  return {
    background: 'maps/tavern.png',
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 } as SceneState['grid'],
    objects: { tokens, fog, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {}, audios: {} },
    widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 },
    widgetValues: {},
    initiative: createDefaultInitiativeState(),
    initiativeTrackerOpen: false,
    isMapLoading: false,
    // The view holds Tavern's map, as a loaded view of the Tavern tab does.
    mapLoaded: true,
    mapPath: 'maps/tavern.atlasmap',
    camera: { x: 0, y: 0, scale: 1 },
  };
}

/** Zigzag brush strokes that survive simplification (5 px teeth): about 57 KB each on the wire. */
function bigFog(count: number): Record<string, FogOperation> {
  const fog: Record<string, FogOperation> = {};
  for (let op = 0; op < count; op++) {
    const points = Array.from({ length: 3000 }, (_, i) => ({
      x: (i % 400) * 10,
      y: op * 400 + Math.floor(i / 400) * 40 + (i % 2) * 5,
    }));
    fog[`big${op}`] = { id: `big${op}`, kind: 'fog', type: 'brush', timestamp: 100 + op, isErasing: false, brushRadius: 30, points };
  }
  return fog;
}

/** Zigzag pen strokes that survive simplification: about 19 KB each on the wire. */
function manyDrawings(count: number): Record<string, DrawingStroke> {
  const drawings: Record<string, DrawingStroke> = {};
  for (let index = 0; index < count; index++) {
    const points = Array.from({ length: 1000 }, (_, i) => ({ x: (i % 200) * 10, y: index * 100 + Math.floor(i / 200) * 20 + (i % 2) * 5 }));
    drawings[`ink${index}`] = { id: `ink${index}`, kind: 'drawing', timestamp: index, type: 'pen', points, color: '#aa0000', width: 3, opacity: 1 };
  }
  return drawings;
}

type FakeView = SceneView<SceneState>;

/** The presenter of the harness `setup` made last: its fake Atlas holds the views. */
let presenting: Presenter;

/** `mapSize`: on a fogged scene only what lies on a map of known size can be proven revealed (ruling F-POS). */
function fakeView(state: SceneState, mapSize?: { width: number; height: number }): FakeView {
  return sceneView(presenting, state, mapSize ? { mapSize } : {});
}

function moveToken(store: StoreApi<SceneState>, id: string, x: number): void {
  store.setState((state) => ({
    objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...state.objects.tokens[id]!, x } } },
  }));
}

const DEFAULT_RULES: PlayerViewRules = { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true };

/** The collection's HP: a bar that defeats the token, kept from players until the GM shows it. */
const HP: ResourceDefinition = {
  key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: false,
};
const SHOWN_HP: ResourceDefinition = { ...HP, visibleToPlayers: true };
const HP_BAR = { color: '#22c55e', share: 0.7, spent: false };

interface Harness {
  files: MemoryImageFiles;
  network: MemoryNetwork;
  gm: GmSession;
  requests: SessionPlayer[];
  presented: Presenter;
  broadcaster: SceneHub;
  notices: string[];
  setRules(next: Partial<PlayerViewRules>): void;
  /** The GM edits the collection's resources; the broadcaster is told, as the collection settings event does. */
  setResources(next: readonly ResourceDefinition[]): void;
  /** The GM edits the collection's initiative rules; announced the same way. */
  setInitiativeRules(next: InitiativeRules): void;
}

function setup(options: { start?: boolean; images?: Record<string, string | Uint8Array> } = {}): Harness {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), {
    title: 'Vault', onJoinRequest: (p) => requests.push(p), onRequestClosed: () => {}, onPlayersChanged: () => {},
  });
  gm.start();
  let rules = { ...DEFAULT_RULES };
  const listeners = new Set<() => void>();
  const settings = {
    getLocalPlayerViewSettings: (): PlayerViewRules => rules,
    onChange: (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const presented = presenter();
  presenting = presented;
  const notices: string[] = [];
  const files = memoryImageFiles(options.images ?? {});
  const assets = new AssetRegistry({ files: files.source, notify: (message) => notices.push(message), hash: nodeHash });
  let definitions: readonly ResourceDefinition[] = [HP];
  let initiativeRules: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };
  const resourceListeners = new Set<() => void>();
  const broadcaster = new SceneHub({ tabs: null, assignments: new SceneAssignments(),
    session: gm, presented, settings, assets, notify: (message) => notices.push(message),
    resources: () => definitions,
    initiativeRules: () => initiativeRules,
    watchResources: (listener) => { resourceListeners.add(listener); return () => { resourceListeners.delete(listener); }; },
  });
  if (options.start !== false) broadcaster.start();
  const setRules = (next: Partial<PlayerViewRules>): void => {
    rules = { ...rules, ...next };
    listeners.forEach((listener) => listener());
  };
  const setResources = (next: readonly ResourceDefinition[]): void => {
    definitions = next;
    resourceListeners.forEach((listener) => listener());
  };
  const setInitiativeRules = (next: InitiativeRules): void => {
    initiativeRules = next;
    resourceListeners.forEach((listener) => listener());
  };
  return { network, gm, requests, presented, broadcaster, notices, setRules, setResources, setInitiativeRules, files };
}

/** A player through `PlayerSession`, admitted by the GM. */
async function join(h: Harness, playerKey = 'key-a'): Promise<PlayerSession> {
  const before = h.requests.length;
  const player = new PlayerSession({
    hostId: 'gm', name: 'Anna', playerKey, clientVersion: '1', transport: h.network.client(), onChange: () => {},
  });
  player.start();
  await vi.advanceTimersByTimeAsync(0);
  if (h.requests.length > before) h.gm.allow(h.requests.at(-1)!.playerId);
  return player;
}

/** A player end that records every message and its size. */
async function rawPlayer(h: Harness, playerKey: string): Promise<{ link: PeerLink; received: ControlMessage[]; sizes: number[] }> {
  const link = await h.network.client().connect('gm');
  const received: ControlMessage[] = [];
  const sizes: number[] = [];
  link.onMessage((channel, data) => {
    if (channel !== 'control' || typeof data !== 'string') return;
    sizes.push(new TextEncoder().encode(data).length);
    const decoded = decodeControl(data);
    if (decoded.kind === 'message') received.push(decoded.message);
  });
  link.send('control', encodeControl({ v: 1, type: 'join', name: 'Raw', playerKey, client: { kind: 'web', version: '1' } }));
  h.gm.allow(h.requests.at(-1)!.playerId);
  return { link, received, sizes };
}

const sceneTypes = (messages: ControlMessage[]): string[] =>
  messages.filter((message) => message.type.startsWith('scene-')).map((message) => message.type);
const tick = async (): Promise<void> => { await vi.advanceTimersByTimeAsync(SCENE_TICK_MS); };

describe('scene messages', () => {
  it('splits records into parts under the budget, in replay order', () => {
    const fog = { b: fogRect(2), a: fogRect(1), c: fogRect(3) };
    const parts = splitParts(fog, (op) => op.order, 200);
    expect(parts.map((part) => Object.keys(part))).toEqual([['a', 'b'], ['c']]);
    expect(splitParts({}, () => 0)).toEqual([]);
  });

  it('refuses snapshots and patches over the message limit', () => {
    const huge = 'x'.repeat(300 * 1024);
    const scene = playerScene({ widgets: [{ id: 'w', type: 'counter', label: huge, icon: '', value: 0 }] });
    expect(snapshotMessages(scene)).toBeNull();
    expect(snapshotMessages(playerScene())?.map((message) => message.type)).toEqual(['scene-snapshot', 'scene-fog', 'scene-drawings']);
    expect(patchMessage({ set: { widgets: scene.widgets }, upsert: {}, remove: {} })).toBeNull();
  });
});

describe('SceneHub', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends a snapshot on admission and patches after', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene?.tokens.hero?.x).toBe(140);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());

    moveToken(store, 'hero', 300);
    expect(player.scene?.tokens.hero?.x).toBe(140);
    await tick();
    expect(player.scene?.tokens.hero?.x).toBe(300);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('projects a fogged scene again once its map size, unknown at first, is known, with no store change (F-POS)', async () => {
    const h = setup();
    // Atlas reads the size from the drawn background, which can settle after the store says the map is loaded.
    const size = { width: 0, height: 0 };
    const fog = { f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 1000, y: 1000, width: 100, height: 100 } as FogOperation };
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, fog), size);
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene?.tokens).toEqual({});
    await vi.advanceTimersByTimeAsync(MAP_SIZE_POLL_MS * 2);
    expect(player.scene?.tokens).toEqual({});
    size.width = 2000;
    size.height = 1500;
    await vi.advanceTimersByTimeAsync(MAP_SIZE_POLL_MS + SCENE_TICK_MS);
    expect(player.scene?.tokens.hero?.x).toBe(140);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('stops the size poll when presenting stops or the scene is held, and polls only a fogged scene', async () => {
    const h = setup();
    const fog = { f: { id: 'f', kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: 1000, y: 1000, width: 100, height: 100 } as FogOperation };
    await join(h);
    await vi.advanceTimersByTimeAsync(SCENE_TICK_MS);
    const baseline = vi.getTimerCount();
    const fogged = fakeView(sceneState({ hero: character('hero', 140) }, fog), { width: 0, height: 0 });
    h.presented.present(fogged.view, fogged.tavern);
    expect(vi.getTimerCount()).toBe(baseline + 1);
    h.presented.clear();
    expect(vi.getTimerCount()).toBe(baseline);
    h.presented.present(fogged.view, fogged.tavern);
    expect(vi.getTimerCount()).toBe(baseline + 1);
    // Held: the view shows another tab.
    fogged.tabs.getState().setActiveTab('dungeon');
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(baseline);
    h.presented.clear();
    // Without fog the size changes nothing sent: no poll.
    const clear = fakeView(sceneState({ hero: character('hero', 140) }), { width: 0, height: 0 });
    h.presented.present(clear.view, clear.tavern);
    expect(vi.getTimerCount()).toBe(baseline);
  });

  it('batches changes into one patch per tick and sends nothing for an empty diff', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);

    moveToken(store, 'hero', 200);
    moveToken(store, 'hero', 250);
    moveToken(store, 'hero', 300);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-patch']);

    store.setState({ camera: { x: 50, y: 50, scale: 2 } });
    moveToken(store, 'hero', 310);
    moveToken(store, 'hero', 300);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-patch']);
    expect(raw.received.filter((message) => 'seq' in message).map((message) => (message as { seq: number }).seq)).toEqual([1, 2]);
  });

  it('sends a resource to players when the GM shows it to them mid-session, and takes it back', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene?.tokens.hero?.resources).toEqual([]);
    h.setResources([SHOWN_HP]);
    await tick();
    expect(player.scene?.tokens.hero?.resources).toEqual([HP_BAR]);
    h.setResources([HP]);
    await tick();
    expect(player.scene?.tokens.hero?.resources).toEqual([]);
  });

  describe('initiative by sides', () => {
    const entry = (id: string, tokenId: string, initiative: number, order: number, isActive = false): InitiativeEntry => ({
      id, tokenId, name: tokenId, initiative, initiativeModifier: 0, imagePath: '', isActive, isNPC: false, order,
    });
    const listed = (state: SceneState, fight: Partial<SceneState['initiative']> = {}): SceneState => ({
      ...state, initiativeTrackerOpen: true,
      initiative: {
        ...createDefaultInitiativeState(), round: 1,
        entries: [entry('e1', 'hero', 17, 0, true), entry('e2', 'orc', 23, 1)], ...fight,
      },
    });
    const SIDES: InitiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'opponents' };

    it('groups a collection by sides before a fight, follows the GM editing its rules, and sends no numbers by sides', async () => {
      const h = setup();
      const state = listed(sceneState({ hero: character('hero', 140, { side: 'players' }), orc: character('orc', 210) }));
      const { view, tavern } = fakeView(state);
      h.presented.present(view, tavern);
      const player = await join(h);
      expect(player.scene?.initiative).toMatchObject({ active: false, entries: [{ initiative: 17, isActive: false }, { initiative: 23 }] });
      expect(player.scene?.initiative).not.toHaveProperty('sides');
      expect(player.scene?.tokens.hero).not.toHaveProperty('side');
      h.setInitiativeRules(SIDES);
      await tick();
      expect(player.scene?.initiative).toMatchObject({ sides: { first: 'opponents' }, entries: [{ initiative: 0 }, { initiative: 0 }] });
      expect(player.scene?.tokens.hero?.side).toBe('players');
      expect(player.scene?.tokens.orc?.side).toBe('opponents');
      h.setInitiativeRules({ ...SIDES, firstSide: 'players' });
      await tick();
      expect(player.scene?.initiative?.sides).toEqual({ first: 'players' });
      h.setInitiativeRules({ mode: 'turn-order', roll: '1d20', firstSide: 'players' });
      await tick();
      expect(player.scene?.initiative).not.toHaveProperty('sides');
      expect(player.scene?.tokens.hero).not.toHaveProperty('side');
    });

    it('lets a running fight keep the mode it started in, whatever the rules say since', async () => {
      const h = setup();
      const state = listed(sceneState({ hero: character('hero', 140, { side: 'players' }), orc: character('orc', 210) }), {
        isActive: true, sides: { first: 'opponents', active: 'opponents' },
      });
      const { view, store, tavern } = fakeView(state);
      h.presented.present(view, tavern);
      const player = await join(h);
      // The collection went back to turn order mid-fight; the fight still runs by sides
      expect(player.scene?.initiative).toMatchObject({ active: true, sides: { first: 'opponents', active: 'opponents' } });
      expect(player.scene?.initiative?.entries.map((e) => [e.initiative, e.isActive])).toEqual([[0, false], [0, false]]);
      store.setState({ initiative: { ...store.getState().initiative, sides: { first: 'opponents', active: 'players' } } });
      await tick();
      expect(player.scene?.initiative?.sides).toEqual({ first: 'opponents', active: 'players' });
      // A turn-order fight under a by-sides collection stays in turn order
      const { sides: _sides, ...turnOrder } = store.getState().initiative;
      store.setState({ initiative: turnOrder });
      h.setInitiativeRules(SIDES);
      await tick();
      expect(player.scene?.initiative).not.toHaveProperty('sides');
      expect(player.scene?.initiative?.entries.map((e) => e.initiative)).toEqual([17, 23]);
    });
  });

  it('follows the GM editing a resource in the collection settings: colour, socket, order', async () => {
    const h = setup();
    const stress: ResourceDefinition = { key: 'stress', name: 'Stress', field: 'stress', direction: 'fills', color: '#a855f7', visibleToPlayers: true, slot: 1 };
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140, { resources: { hp: { current: 7, max: 10 }, stress: { current: 3, max: 6 } } }) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    h.setResources([{ ...SHOWN_HP, slot: 0 }, stress]);
    await tick();
    expect(player.scene?.tokens.hero?.resources).toEqual([HP_BAR, { color: '#a855f7', share: 0.5, spent: false }]);
    h.setResources([{ ...SHOWN_HP, slot: 1, color: '#3b82f6' }, { ...stress, slot: 0 }]);
    await tick();
    expect(player.scene?.tokens.hero?.resources).toEqual([{ color: '#a855f7', share: 0.5, spent: false }, { color: '#3b82f6', share: 0.7, spent: false }]);
    // Moved to a wheel socket, the window no longer draws it
    h.setResources([{ ...SHOWN_HP, slot: 4 }, stress]);
    await tick();
    expect(player.scene?.tokens.hero?.resources).toEqual([{ color: '#a855f7', share: 0.5, spent: false }]);
  });

  it('follows the GM editing a token\'s resource, and sends no resource of a hidden token', async () => {
    const h = setup();
    h.setResources([SHOWN_HP]);
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140), spy: character('spy', 300, { isHidden: true }) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(Object.keys(player.scene?.tokens ?? {})).toEqual(['hero']);
    store.setState((state) => ({
      objects: { ...state.objects, tokens: { ...state.objects.tokens, hero: { ...state.objects.tokens.hero!, resources: { hp: { current: 0, max: 10 } } } } },
    }));
    await tick();
    expect(player.scene?.tokens.hero).toMatchObject({ resources: [{ color: '#ef4444', share: 0, spent: true }], downed: true });
    expect(JSON.stringify(player.scene)).not.toContain('spy');
  });

  it('removes a token the GM hides', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140), orc: character('orc', 400) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    store.setState((state) => ({
      objects: { ...state.objects, tokens: { ...state.objects.tokens, orc: { ...state.objects.tokens.orc!, isHidden: true } } },
    }));
    await tick();
    expect(Object.keys(player.scene?.tokens ?? {})).toEqual(['hero']);
  });

  it('clears the scene when presenting stops', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    h.presented.clear();
    expect(player.scene).toBeNull();
  });

  it('answers a resync with a snapshot', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
  });

  it('splits a large fog into parts under the message limit', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, bigFog(12)));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const snapshot = raw.received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot && 'fogParts' in snapshot ? snapshot.fogParts : 0).toBeGreaterThan(1);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
    const player = await join(h);
    expect(Object.keys(player.scene?.fog ?? {})).toHaveLength(12);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('sends a scene with many drawings in parts', async () => {
    const h = setup();
    const state = sceneState({ hero: character('hero', 140) });
    state.objects.drawings = manyDrawings(30);
    const { view, tavern } = fakeView(state);
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const snapshot = raw.received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot && 'drawingParts' in snapshot ? snapshot.drawingParts : 0).toBeGreaterThan(1);
    expect(sceneTypes(raw.received)).toContain('scene-drawings');
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
    const player = await join(h);
    expect(Object.keys(player.scene?.drawings ?? {})).toHaveLength(30);
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('clears the scene and tells the GM once when it is too large to send', async () => {
    const tokens = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`t${i}`, character(`t${i}`, i)]));
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState(tokens));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
    moveToken(store, 't0', 50);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-clear', 'scene-clear']);
    expect(h.notices).toEqual([SCENE_TOO_LARGE_NOTICE]);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
  });

  it('sends a snapshot instead of a patch that would exceed the limit', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    store.setState((state) => ({ objects: { ...state.objects, fog: bigFog(12) } }));
    await tick();
    const types = sceneTypes(raw.received);
    expect(types).not.toContain('scene-patch');
    expect(types.filter((type) => type === 'scene-snapshot')).toHaveLength(2);
    expect(Math.max(...raw.sizes)).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
  });

  it('gives a second tab of the same player the scene', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    await join(h, 'key-a');
    const secondTab = await join(h, 'key-a');
    expect(secondTab.scene).toEqual(h.broadcaster.currentProjection());
  });

  it('keeps sending the held scene while the GM browses another tab', async () => {
    const h = setup();
    const { view, store, tabs, tavern, dungeon } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const heldId = h.broadcaster.currentProjection()?.sceneId;

    tabs.getState().setActiveTab(dungeon);
    store.setState({ isMapLoading: true });
    store.setState(sceneState({ villain: character('villain', 600) }));
    await tick();
    // Split party (spec Goal 2): the held scene's players are told it is paused, unsequenced.
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-state']);
    expect(raw.received.at(-1)).toEqual({ v: 1, type: 'scene-state', sceneId: heldId, paused: true });
    // D8: a rules change re-projects the held scene from what it kept, and its players get the patch.
    h.setResources([SHOWN_HP]);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-state', 'scene-patch']);

    const late = await join(h, 'key-late');
    expect(Object.keys(late.scene?.tokens ?? {})).toEqual(['hero']);
    expect(late.scene?.tokens.hero?.resources).toEqual([HP_BAR]);
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    const resent = raw.received.at(-1);
    expect(resent?.type === 'scene-snapshot' ? Object.keys(resent.scene.tokens) : []).toEqual(['hero']);
    expect(resent?.type === 'scene-snapshot' ? resent.scene.sceneId : null).toBe(heldId);

    store.setState({ isMapLoading: true });
    tabs.getState().setActiveTab(tavern);
    store.setState({ ...sceneState({ hero: character('hero', 140) }), isMapLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(late.scene?.sceneId).toBe(heldId);
    expect(late.scene?.tokens.hero?.resources).toEqual([HP_BAR]);
  });

  it('a held scene resumes with a patch, not a snapshot', async () => {
    const h = setup();
    const { view, store, tabs, tavern, dungeon } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const heldId = h.broadcaster.currentProjection()?.sceneId;
    tabs.getState().setActiveTab(dungeon);
    store.setState({ isMapLoading: true });
    store.setState(sceneState({ villain: character('villain', 600) }));
    await tick();
    // The GM moved the hero on the tavern before leaving it: what the tavern holds when it comes back.
    store.setState({ isMapLoading: true });
    tabs.getState().setActiveTab(tavern);
    store.setState({ ...sceneState({ hero: character('hero', 300) }), isMapLoading: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-state', 'scene-patch', 'scene-state']);
    const patch = raw.received.find((message) => message.type === 'scene-patch');
    expect(patch?.type === 'scene-patch' ? Object.keys(patch.upsert.tokens ?? {}) : []).toEqual(['hero']);
    expect(raw.received.at(-1)).toEqual({ v: 1, type: 'scene-state', sceneId: heldId, paused: false });
    expect(h.broadcaster.currentProjection()?.tokens.hero?.x).toBe(300);
  });

  it('sends a scene presented before the session started', async () => {
    const h = setup({ start: false });
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    h.broadcaster.start();
    const player = await join(h);
    expect(player.scene?.tokens.hero).toBeDefined();
  });

  it('answers admission with a clear when nothing is presented', async () => {
    const h = setup();
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-clear', 'scene-clear']);
  });

  it('clears a stale scene on a player who reconnects after presenting stopped', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    expect(player.scene).not.toBeNull();
    const gmLinks = (h.gm as unknown as { links: Map<unknown, unknown> }).links;
    ([...gmLinks.keys()][0] as { close(): void }).close();
    h.presented.clear();
    await vi.advanceTimersByTimeAsync(1000);
    expect(player.state.status).toBe('admitted');
    expect(player.scene).toBeNull();
  });

  it('replaces the scene with a new sceneId when the GM presents another', async () => {
    const h = setup();
    const first = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(first.view, first.tavern);
    const player = await join(h);
    const firstId = player.scene?.sceneId;
    const second = fakeView(sceneState({ dragon: character('dragon', 500) }));
    h.presented.present(second.view, second.tavern);
    expect(player.scene?.sceneId).not.toBe(firstId);
    expect(Object.keys(player.scene?.tokens ?? {})).toEqual(['dragon']);
  });

  it('sends nothing while the map loads, then a snapshot', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    store.setState({ isMapLoading: true });
    moveToken(store, 'hero', 500);
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);
    store.setState({ isMapLoading: false });
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
  });

  it('ignores scene data sent by players', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    const other = await join(h, 'key-other');
    const before = other.scene;
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-clear', seq: 5 }));
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-patch', seq: 6, set: { grid: null }, upsert: {}, remove: { tokens: ['hero'] } }));
    await tick();
    expect(other.scene).toEqual(before);
    expect(h.broadcaster.currentProjection()?.tokens.hero).toBeDefined();
  });

  it('stops listening when stopped', async () => {
    const h = setup();
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    h.broadcaster.stop();
    moveToken(store, 'hero', 500);
    h.presented.clear();
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot']);
  });

  it('clears players for fog it cannot send (final review M1: a refused id proves nothing hidden), telling the GM once', async () => {
    const h = setup();
    const longId = 'x'.repeat(200);
    const fog: Record<string, FogOperation> = {
      [longId]: { id: longId, kind: 'fog', type: 'rectangle', timestamp: 1, isErasing: false, x: -1000, y: -1000, width: 5000, height: 5000 },
    };
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, fog));
    h.presented.present(view, tavern);
    expect(h.broadcaster.currentProjection()).toBeNull();
    expect(h.notices).toEqual([FOG_TRUNCATED_NOTICE]);
  });

  describe('fog with more operations than can be sent', () => {
    /** Atlas's remote view takes 2,000 operations: that many small ones and, last, one that covers the hero. */
    function tooMuchFog(): Record<string, FogOperation> {
      const fog: Record<string, FogOperation> = {};
      for (let i = 0; i < REMOTE_FOG_LIMITS.ops; i++) {
        fog[`f${i}`] = { id: `f${i}`, kind: 'fog', type: 'rectangle', timestamp: i, isErasing: false, x: 5000 + i, y: 5000, width: 1, height: 1 };
      }
      fog.cover = { id: 'cover', kind: 'fog', type: 'rectangle', timestamp: 1e9, isErasing: false, x: 0, y: 0, width: 500, height: 500 };
      return fog;
    }
    const setFog = (store: StoreApi<SceneState>, fog: Record<string, FogOperation>): void =>
      store.setState((state) => ({ objects: { ...state.objects, fog } }));

    it('clears players instead of showing covered areas as clear, and tells the GM once', async () => {
      const h = setup();
      const fog = tooMuchFog();
      const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, fog));
      h.presented.present(view, tavern);
      const raw = await rawPlayer(h, 'raw');
      expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
      expect(h.broadcaster.currentProjection()).toBeNull();
      expect(h.notices).toEqual([FOG_TRUNCATED_NOTICE]);
      setFog(store, { ...fog });
      moveToken(store, 'hero', 150);
      await tick();
      expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
      expect(h.notices).toEqual([FOG_TRUNCATED_NOTICE]);
      expect(JSON.stringify(raw.received)).not.toContain('hero');
    });

    it('clears players who already have the scene when the fog grows past the limit, then resumes below it', async () => {
      const h = setup();
      const fog = tooMuchFog();
      const small = Object.fromEntries(Object.entries(fog).filter(([id]) => id !== 'cover'));
      const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 600) }, small), { width: 2000, height: 1500 });
      h.presented.present(view, tavern);
      const player = await join(h);
      expect(player.scene?.tokens.hero).toBeDefined();
      setFog(store, fog);
      await tick();
      expect(player.scene).toBeNull();
      expect(h.notices).toEqual([FOG_TRUNCATED_NOTICE]);
      setFog(store, small);
      await tick();
      expect(player.scene?.tokens.hero?.x).toBe(600);
      expect(player.scene).toEqual(h.broadcaster.currentProjection());
    });
  });

  it('gives a presentation that starts held a new scene id and clears admissions until it resumes', async () => {
    const h = setup();
    const first = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(first.view, first.tavern);
    const oldId = h.broadcaster.currentProjection()?.sceneId;
    const before = await rawPlayer(h, 'before');
    const second = fakeView(sceneState({ dragon: character('dragon', 500) }));
    second.tabs.getState().setActiveTab(second.dungeon);
    h.presented.present(second.view, second.tavern);
    expect(h.broadcaster.currentProjection()).toBeNull();
    expect(sceneTypes(before.received)).toEqual(['scene-snapshot', 'scene-clear']);
    const raw = await rawPlayer(h, 'raw');
    expect(sceneTypes(raw.received)).toEqual(['scene-clear']);
    second.tabs.getState().setActiveTab(second.tavern);
    await vi.advanceTimersByTimeAsync(0);
    const resumed = h.broadcaster.currentProjection();
    expect(resumed?.sceneId).not.toBe(oldId);
    expect(Object.keys(resumed?.tokens ?? {})).toEqual(['dragon']);
    expect(sceneTypes(raw.received)).toEqual(['scene-clear', 'scene-snapshot']);
  });

  describe('resync requests', () => {
    const resync = (raw: { link: PeerLink }): void => raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));

    it('are answered at most once per second per player; the rest wait for the window to end', async () => {
      const h = setup();
      const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
      h.presented.present(view, tavern);
      const raw = await rawPlayer(h, 'raw');
      resync(raw);
      resync(raw);
      resync(raw);
      expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
      await vi.advanceTimersByTimeAsync(999);
      expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot']);
      await vi.advanceTimersByTimeAsync(1);
      expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-snapshot', 'scene-snapshot']);
      await vi.advanceTimersByTimeAsync(5000);
      expect(sceneTypes(raw.received)).toHaveLength(3);
      resync(raw);
      expect(sceneTypes(raw.received)).toHaveLength(4);
    });

    it('keep no timer for a player who left or after stop', async () => {
      const h = setup();
      const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
      h.presented.present(view, tavern);
      const left = await rawPlayer(h, 'left');
      const staying = await rawPlayer(h, 'staying');
      const timers = vi.getTimerCount();
      for (const raw of [left, staying]) { resync(raw); resync(raw); }
      expect(vi.getTimerCount()).toBe(timers + 2);
      left.link.close();
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(timers + 1);
      h.broadcaster.stop();
      expect(vi.getTimerCount()).toBeLessThanOrEqual(timers);
    });

    it('forget the sequence numbers of players the session removed', async () => {
      const h = setup();
      const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
      h.presented.present(view, tavern);
      await rawPlayer(h, 'kicked');
      const kickedId = h.requests.at(-1)!.playerId;
      await rawPlayer(h, 'staying');
      const seqs = (h.broadcaster as unknown as { channels: { seqs: Map<string, number> } }).channels.seqs;
      expect(seqs.has(kickedId)).toBe(true);
      h.gm.kick(kickedId);
      h.presented.clear();
      expect([...seqs.keys()]).not.toContain(kickedId);
      expect(seqs.size).toBe(1);
    });
  });

  it('does not tell the GM about fog when every operation is sent', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }, bigFog(2)));
    h.presented.present(view, tavern);
    await rawPlayer(h, 'raw');
    expect(h.notices).toEqual([]);
  });

  it('answers a resync with a clear after presenting stopped', async () => {
    const h = setup();
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    h.presented.clear();
    raw.link.send('control', encodeControl({ v: 1, type: 'scene-resync', seq: 1 }));
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-clear', 'scene-clear']);
  });

  it('adds an image to the scene once its fingerprint is known', async () => {
    const h = setup({ images: { 'maps/tavern.png': 'map bytes', 'art/hero.png': 'hero bytes' } });
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    // Presenting never waits for hashing: the first snapshot has no images.
    expect(h.broadcaster.currentProjection()?.map.asset).toBeNull();
    expect(h.broadcaster.currentProjection()?.tokens.hero?.image).toBeNull();
    const player = await join(h);
    await tick();
    expect(player.scene?.map.asset).toBe(fingerprintOf('map bytes'));
    expect(player.scene?.tokens.hero?.image).toBe(fingerprintOf('hero bytes'));
    expect(player.scene).toEqual(h.broadcaster.currentProjection());
    expect(JSON.stringify(player.scene)).not.toContain('art/');
  });

  it('sends two fingerprints that finish together as one patch', async () => {
    const h = setup({ images: { 'maps/tavern.png': 'map bytes', 'art/hero.png': 'hero bytes' } });
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    await tick();
    expect(sceneTypes(raw.received)).toEqual(['scene-snapshot', 'scene-patch']);
  });

  it('ignores image changes while the scene is held', async () => {
    const h = setup({ images: { 'maps/tavern.png': 'map bytes' } });
    const { view, tabs, tavern, dungeon } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const raw = await rawPlayer(h, 'raw');
    await tick();
    tabs.getState().setActiveTab(dungeon);
    await tick();
    const sent = raw.received.length;
    h.files.set('maps/tavern.png', 'other bytes', 2);
    h.files.changed('maps/tavern.png');
    await tick();
    expect(raw.received).toHaveLength(sent);
  });

  it('gives a changed image a new fingerprint in the next patch', async () => {
    const h = setup({ images: { 'maps/tavern.png': 'map bytes' } });
    const { view, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    const player = await join(h);
    await tick();
    expect(player.scene?.map.asset).toBe(fingerprintOf('map bytes'));
    h.files.set('maps/tavern.png', 'new map bytes', 1);
    h.files.changed('maps/tavern.png');
    await tick();
    await tick();
    expect(player.scene?.map.asset).toBe(fingerprintOf('new map bytes'));
  });

  describe.each([
    { atlas: 'before scene-tabs', tabs: false },
    { atlas: 'with scene-tabs', tabs: true },
  ])('with no assignments, $atlas', ({ tabs }) => {
    const hubOf = (input: StreamHandlerInput): SceneHub => new SceneHub({
      ...input, tabs: tabs ? createTabScenes(input.extension) : null, assignments: new SceneAssignments(),
    });

    it('with no assignments every player gets exactly what SceneBroadcaster sent', async () => {
      const recorded = JSON.parse(readFileSync('tests/unit/online/fixtures/broadcasterStream.json', 'utf8')) as Streams;
      const streams = await recordFlows(hubOf, tabs);
      // Live all along: the same messages, in the same order, with the same seq.
      expect(streams.edits).toEqual(recorded.edits);
      expect(streams.secrets).toEqual(recorded.secrets);
      // Held and resumed: one unsequenced scene-state each way, and the resume's snapshot replaced by at most one patch.
      expect(Object.keys(streams.holds!)).toEqual(Object.keys(recorded.holds!));
      for (const [player, lines] of Object.entries(streams.holds!)) {
        const old = recorded.holds![player]!;
        expect(applied(segment(lines, null, 'hold')), player).toEqual(applied(segment(old, null, 'hold')));
        expect(applied(segment(lines, 'hold', 'resume')), player).toEqual(applied(segment(old, 'hold', 'resume')));
        expect(states(segment(lines, 'hold', 'resume')).map((state) => state.paused), player).toEqual([true]);
        const resumed = segment(lines, 'resume', 'resumed');
        expect(applied(segment(old, 'resume', 'resumed')).map((line) => 'message' in line && line.message.type), player)
          .toEqual(['scene-snapshot', 'scene-fog']);
        expect(applied(resumed).filter((line) => 'message' in line).map((line) => 'message' in line && line.message.type)).not.toContain('scene-snapshot');
        expect(applied(resumed).length, player).toBeLessThanOrEqual(1);
        expect(states(resumed).map((state) => state.paused), player).toEqual([false]);
        expect(applied(segment(lines, 'resumed', null)), player).toEqual(applied(segment(old, 'resumed', null)));
        // Every scene the player saw is the one SceneBroadcaster gave them, and no gap asked for a resync.
        expect(replay(segment(lines, null, 'resumed')).scene, player).toEqual(replay(segment(old, null, 'resumed')).scene);
        expect(replay(lines), player).toEqual({ ...replay(old), resyncs: 0 });
        expect(seqsUnbroken(lines), player).toBe(true);
      }
    });
  });

  it('tells slot listeners each change of what players have', async () => {
    const h = setup();
    const seen: Array<string[] | null> = [];
    const stop = h.broadcaster.onSlotChange((change) => {
      if (change.kind === 'projected') seen.push(change.slot.lastSent ? Object.keys(change.slot.lastSent.tokens) : null);
      else if (change.kind === 'freed') seen.push(null);
    });
    const { view, store, tavern } = fakeView(sceneState({ hero: character('hero', 140) }));
    h.presented.present(view, tavern);
    expect(seen).toEqual([['hero']]);

    store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, orc: character('orc', 300) } } }));
    await tick();
    expect(seen).toEqual([['hero'], ['hero', 'orc']]);
    await tick(); // nothing changed: no call
    expect(seen).toHaveLength(2);

    h.presented.clear();
    expect(seen).toEqual([['hero'], ['hero', 'orc'], null]);
    stop();
    h.presented.present(view, tavern);
    expect(seen).toHaveLength(3);
  });
});
