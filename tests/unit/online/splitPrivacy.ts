/**
 * The split party's end-to-end privacy checks (B13, review I3): a party of three on three tabs over a real session with
 * every part the hosted session runs, and the checks every raw frame a player received must pass, both channels, the
 * assets channel's binary chunks included.
 */
import { expect, vi } from 'vitest';
import type { FogOperation } from '@atlas-vtt/api-types';
import { decodeAsset } from '../../../src/app/online/assets/assetProtocol';
import { decodeControl } from '../../../src/app/online/protocol';
import { PlayerSceneMirror } from '../../../src/app/online/scene/PlayerSceneMirror';
import type { PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { ready } from './lightingFixtures';
import { IMAGES, MAP, splitWorld, tab, tabScene, TOKEN, VIEW, type RawFrame, type RawPlayer, type SplitWorld, type TabId } from './splitFixtures';
import { assetClient, assetPart, cameraPart, idOf, tokenPart, toolParts } from './splitParts';

export const NAMES: Record<TabId, string> = { a: 'Ambush', b: 'Bridge', c: 'Cave', d: 'Den' };

/** The control types a page of Connect 0.1.0-beta.3 knows: no `scene-state`. */
export const BETA_3_TYPES: ReadonlySet<string> = new Set([
  'join', 'admitted', 'denied', 'presence', 'ping', 'pong', 'bye',
  'scene-snapshot', 'scene-fog', 'scene-drawings', 'scene-patch', 'scene-clear', 'scene-resync', 'scene-camera',
  'token-control', 'token-move', 'token-move-refused', 'dice-roll', 'dice-log', 'laser',
]);

/** Everything of a tab a player on another one must never get: its record ids, its images and its scene id. */
export interface TabSecrets { words: string[]; images: Uint8Array[] }

/** A tab's secrets: its token, the GM's own records on it (`<name>gm`, `<name>fog`…), its images, and `sceneIds`. */
export function secretsOf(tabId: TabId, sceneIds: string[], extra: string[] = []): TabSecrets {
  const only = [`maps/${tabId}.png`, `art/${TOKEN[tabId]}.png`];
  const name = NAMES[tabId].toLowerCase();
  return {
    words: [TOKEN[tabId], `${name}fog`, `${name}gm`, ...only.map(idOf), ...sceneIds, ...extra],
    images: only.map((path) => IMAGES[path]!),
  };
}

/**
 * The frames' text, with what is not another scene's data taken out: the roller's scene name on a dice log entry (the
 * one cross-scene datum, P9), and `asset-denied`, which only repeats the id the player asked for, whatever it is.
 */
export function textOf(frames: readonly RawFrame[]): string {
  return frames.flatMap((frame) => {
    if (typeof frame.data !== 'string') return [];
    if (frame.channel === 'assets') {
      const asset = decodeAsset(frame.data);
      return asset.kind === 'message' && asset.message.type === 'asset-denied' ? [] : [frame.data];
    }
    const decoded = frame.channel === 'control' ? decodeControl(frame.data) : null;
    if (decoded?.kind !== 'message' || decoded.message.type !== 'dice-log') return [frame.data];
    return [JSON.stringify({ ...decoded.message, entries: decoded.message.entries.map(({ scene: _scene, ...entry }) => entry) })];
  }).join('\n');
}

export const bytesOf = (data: unknown): Uint8Array | null => (data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null);

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  const probe = needle.subarray(0, Math.min(needle.length, 32));
  outer: for (let start = 0; start + probe.length <= haystack.length; start++) {
    for (let index = 0; index < probe.length; index++) if (haystack[start + index] !== probe[index]) continue outer;
    return true;
  }
  return false;
}

export function expectNothingOf(player: RawPlayer, frames: readonly RawFrame[], secrets: TabSecrets, label: string): void {
  expect(frames.length, label).toBeGreaterThan(0);
  const text = textOf(frames);
  for (const word of secrets.words) {
    const hit = text.split('\n').find((line) => line.includes(word));
    expect(hit, `${label}: ${word} reached ${player.key}`).toBeUndefined();
  }
  for (const frame of frames) {
    const bytes = bytesOf(frame.data);
    if (bytes) for (const image of secrets.images) expect(contains(bytes, image), `${label}: image bytes reached ${player.key}`).toBe(false);
  }
}

/** The tab names in a player's frames outside dice entries' `scene`, which is the only place another scene's name may go. */
export const namesIn = (frames: readonly RawFrame[], tabs: TabId[]): string[] => tabs.filter((tabId) => textOf(frames).includes(NAMES[tabId]));

/** Each asset message a player got, as `type:fingerprint`. */
export const assetsOf = (frames: readonly RawFrame[]): string[] => frames.flatMap((frame) => {
  const asset = frame.channel === 'assets' ? decodeAsset(frame.data) : null;
  return asset?.kind === 'message' && 'id' in asset.message ? [`${asset.message.type}:${asset.message.id}`] : [];
});

/** The index of a player's first `scene-clear` from `from` on: where a move to another scene began. */
export const clearAt = (player: RawPlayer, from = 0): number => from + player.frames.slice(from).findIndex((frame) => typeof frame.data === 'string' && frame.data.includes('"scene-clear"'));

export function fog(id: string, isErasing: boolean): FogOperation {
  return { id, kind: 'fog', type: 'rectangle', timestamp: Date.now(), isErasing, x: 0, y: 0, width: 400, height: 400 } as FogOperation;
}

/** Each player asks for every image of every tab, as a hostile page could: only their own scene's may stream. */
export function greedy(player: RawPlayer): void {
  assetClient(player).request(Object.keys(IMAGES));
}

/** Bridge, lit, as its players see it once sight is ready: its own token and the GM's records on it in light. */
export const BRIDGE_SEEN = (): ReturnType<typeof ready> => ready({ [TOKEN.b]: 'seen', bridgegm: 'seen', bridgeload: 'seen' }, () => true, MAP);

export interface Party {
  w: SplitWorld;
  anna: RawPlayer;
  ben: RawPlayer;
  cy: RawPlayer;
  sceneOf(tabId: TabId): string;
  /** Ben's and Anna's tokens are theirs to move. */
  control: ReturnType<typeof tokenPart>;
}

export interface PartyOptions {
  /** Dynamic lighting on, Bridge lit (its sight is set ready each time the GM goes there, `toBridge`). */
  lighting?: boolean;
  /** How long each of the GM's switches loads. */
  loadDelayMs?: number;
}

/** Anna follows the presented Ambush; Ben is on Bridge and Cy on Cave, each switched to once, so each has its scene. */
export async function party(options: PartyOptions = {}): Promise<Party> {
  const w = await splitWorld({ images: true, ...(options.lighting ? { lighting: true } : {}) });
  if (options.lighting) w.atlas.views.setTabScene(VIEW, 'b', tabScene('b', {}, true));
  w.atlas.views.setLoadDelay(options.loadDelayMs ?? 0);
  cameraPart(w);
  assetPart(w);
  const control = tokenPart(w);
  toolParts(w);
  await w.present('a');
  const anna = await w.join('anna');
  const ben = await w.join('ben');
  const cy = await w.join('cy');
  control.control.set(TOKEN.b, ben.playerId, true);
  control.control.set(TOKEN.a, anna.playerId, true);
  for (const [player, tabId] of [[ben, 'b'], [cy, 'c']] as const) {
    void w.hub.assign(player.playerId, tab(tabId));
    await vi.advanceTimersByTimeAsync((options.loadDelayMs ?? 0) + 60);
    if (tabId === 'b' && options.lighting) {
      w.atlas.lighting.setVisibility(VIEW, BRIDGE_SEEN());
      await vi.advanceTimersByTimeAsync(60);
    }
  }
  // Each scene's id, kept for the whole test: a closed tab's is gone from the hub.
  const ids: Partial<Record<TabId, string>> = { a: w.hub.slotOf(anna.playerId)!.sceneId, b: w.hub.slotOf(ben.playerId)!.sceneId, c: w.hub.slotOf(cy.playerId)!.sceneId };
  return { w, anna, ben, cy, control, sceneOf: (tabId) => ids[tabId]! };
}

/**
 * A page of 0.1.0-beta.3 given these frames: decoded with its own type table into a real mirror. Returns what it shows
 * and how often it asked for a resync (a `seq` gap).
 */
export function olderReplay(frames: readonly RawFrame[]): { scene: PlayerScene | null; resyncs: number } {
  let resyncs = 0;
  const mirror = new PlayerSceneMirror({ sendResync: () => { resyncs++; }, onChange: () => {} });
  for (const frame of frames) {
    if (frame.channel !== 'control') continue;
    const decoded = decodeControl(frame.data, BETA_3_TYPES);
    if (decoded.kind !== 'message') continue;
    const { message } = decoded;
    if (message.type === 'scene-snapshot' || message.type === 'scene-fog' || message.type === 'scene-drawings' || message.type === 'scene-patch' || message.type === 'scene-clear') mirror.receive(message);
  }
  const scene = mirror.scene;
  mirror.dispose();
  return { scene, resyncs };
}
