/**
 * The three `sceneSyncEndToEnd` flows as a recorder: every scene message each player link receives, in order, so the
 * scene hub's stream can be compared with the one `SceneBroadcaster` sent (`fixtures/broadcasterStream.json`, recorded
 * before it was deleted). The flows are those of `sceneSyncEndToEnd.test.ts`, with one change that only a split-party
 * Atlas can tell: while the GM browses the dungeon the store holds the dungeon's map path, as Atlas's does (the end to
 * end fixtures keep the tavern's on every tab). Scene ids are random per presentation: they are recorded as `S1`, `S2`…
 */
import { vi } from 'vitest';
import type { AtlasCapability, ResourceDefinition } from '@atlas-vtt/api-types';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import type { PresentedSceneSource } from '../../../src/app/online/atlas/presentedSource';
import { PlayerSceneMirror, type SceneMessage } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import { memoryImageFiles, nodeHash } from './assetFixtures';
import { DUNGEON_MAP, presenter, sceneView, type ViewState } from './presentedFixtures';
import { createDefaultInitiativeState } from './sceneFixtures';

type Objects = ViewState['objects'];

/** One line of a recorded stream: a scene message (scene ids normalised), a new link, or a step of the flow. */
export type StreamLine = { message: Record<string, unknown> } | { link: number } | { step: string };
/** Per flow, per player key, the lines that player's links received. */
export type Streams = Record<string, Record<string, StreamLine[]>>;

/** What the flows need of a scene handler: start, stop, and what followers have now. */
export interface StreamHandler {
  start(): void;
  stop(): void;
  currentProjection(): PlayerScene | null;
}

export interface StreamHandlerInput {
  session: GmSession;
  presented: PresentedSceneSource;
  settings: { getLocalPlayerViewSettings(): PlayerViewRules; onChange(listener: () => void): () => void };
  assets: AssetRegistry;
  notify(message: string): void;
  resources(): readonly ResourceDefinition[];
  watchResources(listener: () => void): () => void;
  extension: ReturnType<FakeAtlas['connect']>;
}

const HP: ResourceDefinition = {
  key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: false,
};

function tavernObjects(): Objects {
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
    pins: {}, texts: { tx: { id: 'tx', kind: 'text', x: 1100, y: 1100, text: 'Beware', fontSize: 16, fontFamily: 'serif', color: '#000000' } },
    drawings: {
      d1: { id: 'd1', kind: 'drawing', timestamp: 2, type: 'pen', points: [{ x: 1000, y: 1000 }, { x: 1010, y: 1010 }], color: '#ff0000', width: 2, opacity: 1 },
    },
    walls: {}, lights: {}, audios: {},
  };
}

function sceneState(background: string, objects: Objects, isMapLoading = false, mapPath = 'maps/tavern.atlasmap'): ViewState {
  return {
    background,
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 } as ViewState['grid'],
    objects, widgetSettings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, widgetValues: {},
    initiative: createDefaultInitiativeState(), initiativeTrackerOpen: false, isMapLoading, mapLoaded: true, mapPath,
  };
}

type Store = ReturnType<typeof sceneView>['store'];

function patchToken(store: Store, id: string, patch: object): void {
  store.setState((state) => ({ objects: { ...state.objects, tokens: { ...state.objects.tokens, [id]: { ...state.objects.tokens[id]!, ...patch } } } }));
}

function addFog(store: Store, id: string, op: object): void {
  store.setState((state) => ({ objects: { ...state.objects, fog: { ...state.objects.fog, [id]: { id, kind: 'fog', ...op } as never } } }));
}

const HOSTING: readonly AtlasCapability[] = ['views', 'presentation', 'rules', 'settings', 'storage'];

function world(make: (input: StreamHandlerInput) => StreamHandler, tabs: boolean) {
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  gm.start();
  let rules: PlayerViewRules = { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true };
  let definitions: readonly ResourceDefinition[] = [HP];
  const resourceListeners = new Set<() => void>();
  const listeners = new Set<() => void>();
  const presented = presenter(new FakeAtlas({ capabilities: tabs ? [...HOSTING, 'scene-tabs'] : HOSTING }));
  const assets = new AssetRegistry({ files: memoryImageFiles().source, notify: () => {}, hash: nodeHash });
  const handler = make({
    session: gm, presented, assets, notify: () => {}, resources: () => definitions, extension: presented.extension,
    settings: { getLocalPlayerViewSettings: () => rules, onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } },
    watchResources: (listener) => { resourceListeners.add(listener); return () => { resourceListeners.delete(listener); }; },
  });
  handler.start();
  const { view, store, tabs: tabStore, tavern, dungeon } = sceneView(presented, sceneState('maps/tavern.png', tavernObjects()), { mapSize: { width: 2000, height: 1500 } });
  const lines: Record<string, StreamLine[]> = {};
  /** The steps passed so far: a player who joins later has passed them too, with nothing in between. */
  const steps: StreamLine[] = [];
  const ids = new Map<string, string>();
  const players: PlayerSession[] = [];
  const record = (key: string, data: string): void => {
    const decoded = decodeControl(data);
    if (decoded.kind !== 'message' || !decoded.message.type.startsWith('scene-')) return;
    lines[key]!.push({ message: normalised(decoded.message, ids) });
  };
  const join = async (key: string): Promise<PlayerSession> => {
    const before = requests.length;
    lines[key] ??= [...steps];
    const inner = network.client();
    let links = 0;
    const transport: ClientTransport = {
      connect: async (hostId: string): Promise<PeerLink> => {
        const link = await inner.connect(hostId);
        lines[key]!.push({ link: ++links });
        link.onMessage((channel, data) => { if (channel === 'control' && typeof data === 'string') record(key, data); });
        return link;
      },
    };
    const player = new PlayerSession({ hostId: 'gm', name: key, playerKey: key, clientVersion: '1', transport, onChange: () => {} });
    player.start();
    await vi.advanceTimersByTimeAsync(0);
    if (requests.length > before) gm.allow(requests.at(-1)!.playerId);
    players.push(player);
    return player;
  };
  return {
    handler, presented, view, store, tabs: tabStore, tavern, dungeon, join, lines,
    step: (name: string): void => {
      steps.push({ step: name });
      for (const list of Object.values(lines)) list.push({ step: name });
    },
    setRules: (next: Partial<PlayerViewRules>): void => { rules = { ...rules, ...next }; listeners.forEach((listener) => listener()); },
    setResources: (next: readonly ResourceDefinition[]): void => { definitions = next; resourceListeners.forEach((listener) => listener()); },
    tick: async (): Promise<void> => { await vi.advanceTimersByTimeAsync(55); },
    finish: (): Record<string, StreamLine[]> => {
      players.forEach((player) => player.stop());
      handler.stop();
      gm.stop();
      return lines;
    },
  };
}

/** The message with each scene id replaced by its order of first appearance; `seq` kept. */
function normalised(message: ControlMessage, ids: Map<string, string>): Record<string, unknown> {
  const id = (sceneId: string): string => {
    if (!ids.has(sceneId)) ids.set(sceneId, `S${ids.size + 1}`);
    return ids.get(sceneId)!;
  };
  const copy = JSON.parse(JSON.stringify(message)) as Record<string, unknown> & { scene?: { sceneId?: string }; sceneId?: string };
  if (copy.scene?.sceneId) copy.scene.sceneId = id(copy.scene.sceneId);
  if (typeof copy.sceneId === 'string') copy.sceneId = id(copy.sceneId);
  return copy;
}

/** Runs the three flows with the handler `make` builds; `tabs`: over an Atlas with `scene-tabs`. */
export async function recordFlows(make: (input: StreamHandlerInput) => StreamHandler, tabs: boolean): Promise<Streams> {
  const streams: Streams = {};

  let w = world(make, tabs);
  await w.join('early');
  w.presented.present(w.view, w.tavern);
  await w.join('late');
  patchToken(w.store, 'hero', { x: 300 });
  await w.tick();
  addFog(w.store, 'e1', { type: 'rectangle', timestamp: 3, isErasing: true, x: 944, y: 944, width: 216, height: 216 });
  await w.tick();
  addFog(w.store, 'b1', { type: 'brush', timestamp: 4, isErasing: false, brushRadius: 80, points: [{ x: 300, y: 140 }, { x: 301, y: 140 }] });
  await w.tick();
  w.setRules({ showTokenNameplates: true });
  await w.tick();
  w.setResources([{ ...HP, visibleToPlayers: true }]);
  await w.tick();
  patchToken(w.store, 'goblin', { isHidden: true });
  await w.tick();
  w.presented.clear();
  streams.edits = w.finish();

  w = world(make, tabs);
  await w.join('A');
  const other = await w.join('B');
  w.presented.present(w.view, w.tavern);
  w.step('hold');
  w.tabs.getState().setActiveTab(w.dungeon);
  w.store.setState(sceneState('maps/SECRET-dungeon.png', tavernObjects(), true, DUNGEON_MAP));
  w.store.setState({ objects: { ...tavernObjects(), tokens: {} }, isMapLoading: false });
  await w.tick();
  await w.join('C');
  w.step('resume');
  w.tabs.getState().setActiveTab(w.tavern);
  w.store.setState(sceneState('maps/tavern.png', tavernObjects(), true));
  await vi.advanceTimersByTimeAsync(0);
  w.store.setState({ isMapLoading: false });
  await w.tick();
  w.step('resumed');
  await w.join('A');
  await w.tick();
  patchToken(w.store, 'hero', { x: 50, y: 50 });
  await w.tick();
  // B loses its connection, reconnects on its own and catches up.
  (other as unknown as { link: PeerLink }).link.close();
  await vi.advanceTimersByTimeAsync(3000);
  patchToken(w.store, 'hero', { x: 60 });
  await w.tick();
  w.presented.clear();
  streams.holds = w.finish();

  w = world(make, tabs);
  await w.join('A');
  w.presented.present(w.view, w.tavern);
  w.setRules({ showTokenNameplates: true });
  w.setResources([{ ...HP, visibleToPlayers: true }]);
  patchToken(w.store, 'hero', { x: 200 });
  addFog(w.store, 'e1', { type: 'rectangle', timestamp: 3, isErasing: true, x: 950, y: 950, width: 200, height: 200 });
  await w.tick();
  w.presented.clear();
  streams.secrets = w.finish();
  return streams;
}

type Message = Record<string, unknown> & { type: string; seq?: number };

const messageOf = (line: StreamLine): Message | null => ('message' in line ? line.message as Message : null);

/** The lines from `from` (a step, or the start) up to `to` (a step, or the end), steps excluded. */
export function segment(lines: readonly StreamLine[], from: string | null, to: string | null): StreamLine[] {
  const start = from === null ? 0 : lines.findIndex((line) => 'step' in line && line.step === from) + 1;
  const end = to === null ? lines.length : lines.findIndex((line) => 'step' in line && line.step === to);
  return lines.slice(start, end < 0 ? lines.length : end).filter((line) => !('step' in line));
}

/** Without `scene-state`, and without each message's `seq`: what a mirror applies, in order. */
export function applied(lines: readonly StreamLine[]): StreamLine[] {
  return lines.filter((line) => messageOf(line)?.type !== 'scene-state').map((line) => {
    const message = messageOf(line);
    if (!message) return line;
    const { seq: _seq, ...rest } = message;
    return { message: rest };
  });
}

export const states = (lines: readonly StreamLine[]): Message[] => lines.map(messageOf).filter((message): message is Message => message?.type === 'scene-state');

/** Whether every link's sequenced messages count up by one with no gap (a player's newer tab carries on their count). */
export function seqsUnbroken(lines: readonly StreamLine[]): boolean {
  let last: number | null = null;
  for (const line of lines) {
    if ('link' in line) last = null;
    const seq = messageOf(line)?.seq;
    if (typeof seq !== 'number') continue;
    if (last !== null && seq !== last + 1) return false;
    last = seq;
  }
  return true;
}

/** Each player's scene after replaying the lines on a real `PlayerSceneMirror` (a new one per link), and the resyncs it asked. */
export function replay(lines: readonly StreamLine[]): { scene: PlayerScene | null; resyncs: number } {
  let resyncs = 0;
  let mirror: PlayerSceneMirror | null = null;
  for (const line of lines) {
    if ('link' in line) mirror = new PlayerSceneMirror({ sendResync: () => { resyncs++; }, onChange: () => {} });
    const message = messageOf(line);
    if (message && message.type !== 'scene-state') mirror?.receive(message as unknown as SceneMessage);
  }
  return { scene: mirror?.scene ?? null, resyncs };
}
