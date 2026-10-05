import { vi } from 'vitest';
import type { MapPayload } from '../../../../src/app/online/sharing/model/mapPayload';
import { SHARED_COLLECTION, type MapPullDeps } from '../../../../src/app/online/sharing/receive/mapPull';
import { PulledItems } from '../../../../src/app/online/sharing/receive/PulledItems';
import type { PulledItem } from '../../../../src/app/online/sharing/transport/ShareNode';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { fingerprintOf } from '../assetFixtures';
import { playerToken } from '../sceneFixtures';
import { scenesOver } from './receiveFixtures';
import { TABLE_ID } from './sharingFixtures';
import { PATHS } from './sharingPathsFixture';

// The map pull tests' vault, Atlas (the fake) and payloads.

export const MAP_IMAGE = fingerprintOf('map-bytes');
export const NOTE_ITEM = 'n'.repeat(22);
export const OTHER_NOTE = 'o'.repeat(22);
export const SCENES = `atlas-vtt/collections/${SHARED_COLLECTION}/scenes/Ana`;
export const IMAGE = `${SCENES}/files/${MAP_IMAGE}.png`;

export const playerSafe: MapPayload = {
  format: 'atlas-share-map-v1', mode: 'player-safe', name: 'Inn',
  scene: {
    sceneId: 'shared-map', map: { asset: MAP_IMAGE, width: 700, height: 700, cellSize: 70 }, grid: null,
    tokens: { a: playerToken({ x: 1, y: 1 }), b: playerToken({ x: 2, y: 2 }) }, fog: {}, texts: {}, drawings: {}, widgets: [], initiative: null,
    measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', snapToGrid: true, rangeBands: [] },
  } as never,
  pins: [{ x: 1, y: 1, note: NOTE_ITEM }, { x: 2, y: 2, note: OTHER_NOTE }],
  tokenNotes: { a: NOTE_ITEM, b: OTHER_NOTE }, notes: [NOTE_ITEM, OTHER_NOTE], images: [MAP_IMAGE],
};

/** `older`: an Atlas before 1.13.0, without `scenes.replaceMap`. */
export async function setup(options: { older?: boolean } = {}) {
  const vault = createInMemoryApp({ files: { 'Private/secret.md': 'mine', 'atlas-vtt/assets/mine.png': 'png' } });
  const { app, files } = vault;
  const pulled = PulledItems.create(app.vault.adapter, PATHS);
  await pulled.ready();
  const { atlas, scenes: api } = scenesOver(vault, options.older === true);
  // One addToCollection per pull: Atlas writes the images, the map file and the record under its own lock.
  const scenes = { list: vi.fn(api.list), addToCollection: vi.fn(api.addToCollection), ...(api.replaceMap ? { replaceMap: vi.fn(api.replaceMap) } : {}) };
  // The fork's tests count scene records added (`assets.addAsset`); one addToCollection adds one.
  const assets = { addAsset: scenes.addToCollection };
  const images = vi.fn(async (fingerprint: string): Promise<PulledItem> => ({
    kind: 'image', version: fingerprint, mime: 'image/png', bytes: new TextEncoder().encode('map-bytes').buffer as ArrayBuffer,
  }));
  const confirmUpdate = vi.fn(async (): Promise<'both' | 'theirs' | null> => 'theirs');
  const notify = vi.fn();
  const deps = (notes: Record<string, string>): MapPullDeps => ({
    app, scenes, pulled, pullImage: images, notes: new Map(Object.entries(notes)), confirmUpdate, notify,
  });
  return { app, files, pulled, atlas, scenes, assets, images, confirmUpdate, notify, deps };
}

export const input = (payload: MapPayload) => ({
  tableId: TABLE_ID, from: 'ana', personName: 'Ana',
  item: { item: 'm'.repeat(22), kind: 'map' as const, title: 'Inn', version: 'V'.repeat(43), size: 1 }, payload,
});
export const newer = (payload: MapPayload) => ({ ...input(payload), item: { ...input(payload).item, version: 'W'.repeat(43) } });

