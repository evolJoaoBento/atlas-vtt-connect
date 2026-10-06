/**
 * A split party over a fake Atlas with scene tabs: the GM's view `gm` with the tabs Ambush (`a`), Bridge (`b`), Cave
 * (`c`) and Den (`d`), each with its own token (`TOKEN`: words no random id holds, for wire checks), Ambush active and loaded; a real `GmSession`,
 * the `SceneHub` with `TabScenes` and `SceneAssignments`, and raw players that record every control message.
 */
import { vi } from 'vitest';
import type { AtlasCapability, AtlasExtension, Character, PlayerVisibility, ResourceDefinition, SceneSnapshot } from '@atlas-vtt/api-types';
import { presentedSource, type PresentedSceneSource } from '../../../src/app/online/atlas/presentedSource';
import { createTabScenes, type TabScenes } from '../../../src/app/online/atlas/tabScenes';
import { GmSession, type SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AssetRegistry } from '../../../src/app/online/scene/AssetRegistry';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { SCENE_TICK_MS, SceneHub } from '../../../src/app/online/scene/SceneHub';
import { liveLighting } from '../../../src/app/online/scene/sceneLighting';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import type { TabKey } from '../../../src/app/online/split/tabKey';
import type { PeerLink } from '../../../src/app/online/transport/types';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';
import { MemoryNetwork } from '../../fake/MemoryTransport';
import { imageBytes, memoryImageFiles, nodeHash, type MemoryImageFiles } from './assetFixtures';
import { emptySceneState, snapshotOfState } from './presentedFixtures';

export const VIEW = 'gm';
export const TABS = [
  { tabId: 'a', mapPath: 'maps/ambush.atlasmap', name: 'Ambush' },
  { tabId: 'b', mapPath: 'maps/bridge.atlasmap', name: 'Bridge' },
  { tabId: 'c', mapPath: 'maps/cave.atlasmap', name: 'Cave' },
  { tabId: 'd', mapPath: 'maps/den.atlasmap', name: 'Den' },
] as const;
export type TabId = (typeof TABS)[number]['tabId'];
export const tab = (tabId: TabId): TabKey => ({ viewId: VIEW, tabId });
export const TOKEN: Record<TabId, string> = { a: 'ambushorc', b: 'bridgetroll', c: 'cavebat', d: 'denwolf' };
export const MAP = { width: 2000, height: 1500 };

export function character(id: string, x: number, y = 140, overrides: Partial<Character> = {}): Character {
  return { id, kind: 'character', x, y, imagePath: `art/${id}.png`, name: id, ...overrides };
}

/** A tab's scene, loaded: its own token (`TOKEN`) and anything given. */
export function tabScene(tabId: TabId, tokens: Record<string, Character> = {}, lit = false): Omit<SceneSnapshot, 'viewId'> {
  const state = emptySceneState();
  const mapPath = TABS.find((entry) => entry.tabId === tabId)!.mapPath;
  return {
    ...snapshotOfState({ ...state, mapPath, background: `maps/${tabId}.png`, objects: { ...state.objects, tokens: { [TOKEN[tabId]]: character(TOKEN[tabId], 140), ...tokens } } }, MAP, mapPath),
    ...(lit ? { lighting: { enabled: true, ambient: 0 } } : {}),
  };
}

export interface RawPlayer {
  key: string;
  playerId: string;
  received: ControlMessage[];
  link: PeerLink;
}

export interface SplitWorld {
  atlas: FakeAtlas;
  /** The extension's API and its presented scene, for the session's other parts (`splitParts`). */
  extension: AtlasExtension;
  presented: PresentedSceneSource;
  hub: SceneHub;
  /** The session's content registry, over `files`. */
  registry: AssetRegistry;
  files: MemoryImageFiles;
  tabs: TabScenes;
  assignments: SceneAssignments;
  gm: GmSession;
  notices: string[];
  join(key: string): Promise<RawPlayer>;
  /** The GM presents a tab (it must be the active, loaded one to be presented at once). */
  present(tabId: TabId): Promise<void>;
  /** The GM's own tab switch, its map loading for `loadDelayMs`. */
  switchTo(tabId: TabId, loadDelayMs?: number): Promise<void>;
  /** The GM edits the active tab's tokens. */
  editTokens(tokens: Record<string, Character>): void;
  setRules(next: Partial<PlayerViewRules>): void;
  /** The GM edits the collection's resources; the hub is told, as the collection settings event does. */
  setResources(next: readonly ResourceDefinition[]): void;
  tick(): Promise<void>;
}

/** Every image the tabs' scenes show (`images: true`): each map, each tab's token art and `art/shared.png`. */
export const IMAGES: Record<string, Uint8Array> = Object.fromEntries([
  ...TABS.map(({ tabId }) => `maps/${tabId}.png`), ...TABS.map(({ tabId }) => `art/${TOKEN[tabId]}.png`), 'art/shared.png',
].map((path, index) => [path, imageBytes(64 + index, index + 1)]));

export async function splitWorld(options: { lighting?: boolean; visibility?: PlayerVisibility; images?: boolean } = {}): Promise<SplitWorld> {
  const capabilities: AtlasCapability[] = ['views', 'presentation', 'rules', 'settings', 'storage', 'scene-tabs', 'tokens', 'dice', 'lasers', ...(options.lighting ? ['lighting' as const] : [])];
  const atlas = new FakeAtlas({ capabilities });
  atlas.views.open(VIEW, TABS.map((entry) => ({ ...entry })));
  atlas.views.setActive(VIEW);
  for (const { tabId } of TABS.slice(1)) atlas.views.setTabScene(VIEW, tabId, tabScene(tabId));
  atlas.views.setSnapshot(VIEW, tabScene('a'));
  if (options.visibility) atlas.lighting.setVisibility(VIEW, options.visibility);
  const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  await vi.advanceTimersByTimeAsync(0);
  const network = new MemoryNetwork();
  const requests: SessionPlayer[] = [];
  const gm = new GmSession(network.host('gm'), { title: 'Vault', onJoinRequest: (player) => requests.push(player), onRequestClosed: () => {}, onPlayersChanged: () => {} });
  gm.start();
  let rules: PlayerViewRules = { showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true };
  const ruleListeners = new Set<() => void>();
  let resources: readonly ResourceDefinition[] = [];
  const resourceListeners = new Set<() => void>();
  const notices: string[] = [];
  const tabs = createTabScenes(extension);
  const files = memoryImageFiles(options.images ? IMAGES : {});
  const registry = new AssetRegistry({ files: files.source, notify: () => {}, hash: nodeHash });
  const presented = presentedSource(extension);
  const assignments = new SceneAssignments();
  const hub = new SceneHub({
    session: gm, presented, tabs, assignments,
    settings: { getLocalPlayerViewSettings: () => rules, onChange: (listener) => { ruleListeners.add(listener); return () => { ruleListeners.delete(listener); }; } },
    assets: registry,
    notify: (message) => notices.push(message),
    resources: () => resources,
    watchResources: (listener) => { resourceListeners.add(listener); return () => { resourceListeners.delete(listener); }; },
    ...(options.lighting ? { lighting: liveLighting(extension.lighting) } : {}),
  });
  hub.start();
  return {
    atlas, extension, presented, hub, registry, files, tabs, assignments, gm, notices,
    join: async (key) => {
      const link = await network.client().connect('gm');
      const received: ControlMessage[] = [];
      link.onMessage((channel, data) => {
        if (channel !== 'control' || typeof data !== 'string') return;
        const decoded = decodeControl(data);
        if (decoded.kind === 'message') received.push(decoded.message);
      });
      link.send('control', encodeControl({ v: 1, type: 'join', name: key, playerKey: key, client: { kind: 'web', version: '1' } }));
      const request = requests.at(-1)!;
      if (request.status !== 'admitted') gm.allow(request.playerId);
      await vi.advanceTimersByTimeAsync(0);
      return { key, playerId: request.playerId, received, link };
    },
    present: async (tabId) => {
      await atlas.presentation.present(VIEW, tabId);
      await vi.advanceTimersByTimeAsync(0);
    },
    switchTo: async (tabId, loadDelayMs = 0) => {
      const switched = atlas.views.switchTab(VIEW, tabId, { loadDelayMs });
      await vi.advanceTimersByTimeAsync(loadDelayMs);
      await switched;
      await vi.advanceTimersByTimeAsync(0);
    },
    editTokens: (tokens) => {
      const scene = atlas.views.sceneOf(VIEW)!;
      atlas.views.update(VIEW, { objects: { ...scene.objects, tokens: { ...scene.objects.tokens, ...tokens } } });
    },
    setRules: (next) => {
      rules = { ...rules, ...next };
      ruleListeners.forEach((listener) => listener());
    },
    setResources: (next) => {
      resources = next;
      resourceListeners.forEach((listener) => listener());
    },
    tick: async () => { await vi.advanceTimersByTimeAsync(SCENE_TICK_MS); },
  };
}

/** The scene message types a player got, from `from` on. */
export const typesOf = (player: RawPlayer, from = 0): string[] => player.received.slice(from).map((message) => message.type).filter((type) => type.startsWith('scene-'));

/** Every token id, scene id and image path a player was sent, from `from` on: what a privacy check looks for. */
export function wireOf(player: RawPlayer, from = 0): string {
  return JSON.stringify(player.received.slice(from));
}

/** The scene id of the last snapshot a player got. */
export function lastSceneId(player: RawPlayer): string | null {
  const snapshot = [...player.received].reverse().find((message) => message.type === 'scene-snapshot');
  return snapshot?.type === 'scene-snapshot' ? snapshot.scene.sceneId : null;
}
