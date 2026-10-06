/**
 * A split party end to end (B13, Review Focus 3): a real GM session, the scene hub and every part the hosted session
 * runs (camera, images, token control, dice, lasers), three players on three tabs, and every raw frame each player's
 * link received, the assets channel's binary chunks included.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FogOperation } from '@atlas-vtt/api-types';
import { decodeAsset } from '../../../src/app/online/assets/assetProtocol';
import { decodeControl } from '../../../src/app/online/protocol';
import {
  character, IMAGES, lastSceneId, splitWorld, tab, TOKEN, typesOf, VIEW, type RawFrame, type RawPlayer, type SplitWorld, type TabId,
} from './splitFixtures';
import { assetClient, assetPart, cameraPart, dropToken, idOf, moveCamera, rollD6, sendLaser, tokenPart, toolParts } from './splitParts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const NAMES: Record<TabId, string> = { a: 'Ambush', b: 'Bridge', c: 'Cave', d: 'Den' };

/** Everything of a tab a player on another one must never get: its record ids, its images and its scene id. */
interface TabSecrets { words: string[]; images: Uint8Array[] }

function secretsOf(tabId: TabId, sceneIds: string[]): TabSecrets {
  const only = [`maps/${tabId}.png`, `art/${TOKEN[tabId]}.png`];
  return {
    words: [TOKEN[tabId], `${NAMES[tabId].toLowerCase()}fog`, `${NAMES[tabId].toLowerCase()}gm`, ...only.map(idOf), ...sceneIds],
    images: only.map((path) => IMAGES[path]!),
  };
}

/**
 * The frames' text, with what is not another scene's data taken out: the roller's scene name on a dice log entry (the
 * one cross-scene datum, P9), and `asset-denied`, which only repeats the id the player asked for, whatever it is.
 */
function textOf(frames: readonly RawFrame[]): string {
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

const bytesOf = (data: unknown): Uint8Array | null => (data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null);

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  const probe = needle.subarray(0, Math.min(needle.length, 32));
  outer: for (let start = 0; start + probe.length <= haystack.length; start++) {
    for (let index = 0; index < probe.length; index++) if (haystack[start + index] !== probe[index]) continue outer;
    return true;
  }
  return false;
}

function expectNothingOf(player: RawPlayer, frames: readonly RawFrame[], secrets: TabSecrets, label: string): void {
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
const namesIn = (frames: readonly RawFrame[], tabs: TabId[]): string[] => tabs.filter((tabId) => textOf(frames).includes(NAMES[tabId]));

function fog(id: string, isErasing: boolean): FogOperation {
  return { id, kind: 'fog', type: 'rectangle', timestamp: Date.now(), isErasing, x: 0, y: 0, width: 400, height: 400 } as FogOperation;
}

interface Party { w: SplitWorld; anna: RawPlayer; ben: RawPlayer; cy: RawPlayer; sceneOf(tabId: TabId): string }

/** Anna follows the presented Ambush; Ben is on Bridge and Cy on Cave, each switched to once, so each has its scene. */
async function party(): Promise<Party> {
  const w = await splitWorld({ images: true });
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
    await vi.advanceTimersByTimeAsync(60);
  }
  // Each scene's id, kept for the whole test: Bridge's is gone from the hub once it closes.
  const ids: Partial<Record<TabId, string>> = { a: w.hub.slotOf(anna.playerId)!.sceneId, b: w.hub.slotOf(ben.playerId)!.sceneId, c: w.hub.slotOf(cy.playerId)!.sceneId };
  return { w, anna, ben, cy, sceneOf: (tabId) => ids[tabId]! };
}

/** Each player asks for every image of every tab, as a hostile page could: only their own scene's may stream. */
function greedy(player: RawPlayer): void {
  assetClient(player).request(Object.keys(IMAGES));
}

describe('a split party end to end', () => {
  it('no byte of B reaches a player on A', async () => {
    const { w, anna, ben, cy, sceneOf } = await party();
    const [a, b, c] = [sceneOf('a'), sceneOf('b'), sceneOf('c')];
    expect(new Set([a, b, c]).size).toBe(3);
    const benFrom = ben.frames.findIndex((frame) => typeof frame.data === 'string' && frame.data.includes('"scene-clear"'));
    const cyFrom = cy.frames.findIndex((frame) => typeof frame.data === 'string' && frame.data.includes('"scene-clear"'));
    expect(benFrom).toBeGreaterThan(0);
    for (const player of [anna, ben, cy]) greedy(player);

    // The GM edits on Ambush, moves the camera there, then switches to Bridge.
    await w.switchTo('a');
    w.editTokens({ ambushgm: character('ambushgm', 600) });
    moveCamera(w, 700);
    await w.tick();
    await w.switchTo('b');
    await w.tick();
    // On Bridge: an edit, the camera, Ben's move, lasers (the GM's and Ben's), rolls, and fog revealed.
    w.editTokens({ bridgegm: character('bridgegm', 650) });
    moveCamera(w, 800);
    dropToken(ben, b, TOKEN.b, 420);
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 9, y: 9 });
    sendLaser(ben, b, 30);
    await w.tick();
    rollD6(ben);
    rollD6(anna);
    const scene = w.atlas.views.sceneOf(VIEW)!;
    w.atlas.views.update(VIEW, { objects: { ...scene.objects, fog: { bridgefogpaint: fog('bridgefogpaint', false), bridgefogreveal: fog('bridgefogreveal', true) } } });
    await w.tick();
    for (const player of [anna, ben, cy]) greedy(player);
    await w.tick();
    // Then to Cave, and Bridge closes.
    await w.switchTo('c');
    w.editTokens({ cavegm: character('cavegm', 660) });
    await w.tick();
    const benBeforeClose = ben.frames.length;
    w.atlas.views.removeTab(VIEW, 'b');
    await vi.advanceTimersByTimeAsync(60);
    await w.tick();

    // The capture holds the assets channel: each player's own images streamed, as binary chunks; another scene's were denied.
    const assetsOf = (player: RawPlayer): string[] => player.frames.flatMap((frame) => {
      const asset = frame.channel === 'assets' ? decodeAsset(frame.data) : null;
      return asset?.kind === 'message' && 'id' in asset.message ? [`${asset.message.type}:${asset.message.id}`] : [];
    });
    expect(assetsOf(anna)).toEqual(expect.arrayContaining([`asset-start:${idOf('maps/a.png')}`, `asset-denied:${idOf('maps/b.png')}`, `asset-denied:${idOf(`art/${TOKEN.b}.png`)}`]));
    expect(assetsOf(ben)).toEqual(expect.arrayContaining([`asset-start:${idOf('maps/b.png')}`, `asset-denied:${idOf('maps/c.png')}`]));
    expect(anna.frames.some((frame) => frame.channel === 'assets' && bytesOf(frame.data) !== null)).toBe(true);
    expectNothingOf(anna, anna.frames, secretsOf('b', [b]), 'Anna, Bridge');
    expectNothingOf(anna, anna.frames, secretsOf('c', [c]), 'Anna, Cave');
    expectNothingOf(ben, ben.frames.slice(benFrom, benBeforeClose), secretsOf('a', [a]), 'Ben, Ambush before Bridge closed');
    expectNothingOf(ben, ben.frames.slice(benFrom), secretsOf('c', [c]), 'Ben, Cave');
    expectNothingOf(cy, cy.frames.slice(cyFrom), secretsOf('a', [a]), 'Cy, Ambush');
    expectNothingOf(cy, cy.frames.slice(cyFrom), secretsOf('b', [b]), 'Cy, Bridge');
    // Another scene's name reaches a player only as a roller's scene in the dice log (P9).
    expect(namesIn(anna.frames, ['b', 'c'])).toEqual([]);
    expect(namesIn(cy.frames.slice(cyFrom), ['a', 'b'])).toEqual([]);
    const labelled = anna.received.flatMap((message) => (message.type === 'dice-log' ? message.entries : [])).map((entry) => entry.scene);
    expect(labelled).toContain('Bridge');

    // Bridge closed: Ben's first scene message is a clear, then Ambush's snapshot.
    const after = ben.frames.slice(benBeforeClose).flatMap((frame) => {
      const decoded = frame.channel === 'control' && typeof frame.data === 'string' ? decodeControl(frame.data) : null;
      return decoded?.kind === 'message' && decoded.message.type.startsWith('scene-') ? [decoded.message] : [];
    });
    expect(after.slice(0, 2).map((message) => message.type)).toEqual(['scene-clear', 'scene-snapshot']);
    expect(after[1]?.type === 'scene-snapshot' && after[1].scene.sceneId).toBe(a);
    expect(w.notices).toContain('ben went back to the presented scene: Bridge was closed.');
  });

  it('a reconnecting player lands on their assigned scene', async () => {
    const { w, ben, sceneOf } = await party();
    const b = sceneOf('b');
    ben.link.close();
    await vi.advanceTimersByTimeAsync(60);
    const again = await w.join('ben');
    await vi.advanceTimersByTimeAsync(60);
    // A returning player is let back in as who they were, by their player key: no new request, the same player id.
    expect(w.gm.getPlayers().filter((player) => player.name === 'ben')).toEqual([expect.objectContaining({ playerId: ben.playerId, status: 'admitted' })]);
    expect(lastSceneId(again)).toBe(b);
    expect(textOf(again.frames).includes(TOKEN.a)).toBe(false);
    expect(again.received.find((message) => message.type === 'scene-state')).toMatchObject({ sceneId: b, paused: true });
  });

  it('everyone back sends every player A\'s snapshot after a clear', async () => {
    const { w, anna, ben, cy, sceneOf } = await party();
    const a = sceneOf('a');
    const from = { anna: anna.received.length, ben: ben.received.length, cy: cy.received.length };
    w.hub.everyoneBack();
    await vi.advanceTimersByTimeAsync(60);
    for (const player of [ben, cy]) {
      expect(typesOf(player, from[player.key as 'ben' | 'cy']).slice(0, 2)).toEqual(['scene-clear', 'scene-snapshot']);
      expect(lastSceneId(player)).toBe(a);
    }
    expect(typesOf(anna, from.anna).filter((type) => type === 'scene-clear' || type === 'scene-snapshot')).toEqual([]);
    expect(w.hub.splitActive()).toBe(false);
  });
});
