import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MapPayload } from '../../../../src/app/online/sharing/model/mapPayload';
import { pullMap, SHARED_COLLECTION, type MapPullDeps } from '../../../../src/app/online/sharing/receive/mapPull';
import { PulledItems } from '../../../../src/app/online/sharing/receive/PulledItems';
import { mapUpdateDialog } from '../../../../src/app/online/sharing/registerReceiving';
import type { PulledItem } from '../../../../src/app/online/sharing/transport/ShareNode';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { fingerprintOf } from '../assetFixtures';
import { playerToken } from '../sceneFixtures';
import { mapState, scenesOver } from './receiveFixtures';
import { TABLE_ID } from './sharingFixtures';
import { PATHS } from './sharingPathsFixture';

const MAP_IMAGE = fingerprintOf('map-bytes');
const NOTE_ITEM = 'n'.repeat(22);
const OTHER_NOTE = 'o'.repeat(22);
const SCENES = `atlas-vtt/collections/${SHARED_COLLECTION}/scenes/Ana`;
const IMAGE = `${SCENES}/files/${MAP_IMAGE}.png`;

const playerSafe: MapPayload = {
  format: 'atlas-share-map-v1', mode: 'player-safe', name: 'Inn',
  scene: {
    sceneId: 'shared-map', map: { asset: MAP_IMAGE, width: 700, height: 700, cellSize: 70 }, grid: null,
    tokens: { a: playerToken({ x: 1, y: 1 }), b: playerToken({ x: 2, y: 2 }) }, fog: {}, texts: {}, drawings: {}, widgets: [], initiative: null,
    measurement: { mode: 'metric', unitType: 'feet', unitDistance: 5, diagonalRule: 'equidistant', snapToGrid: true, rangeBands: [] },
  } as never,
  pins: [{ x: 1, y: 1, note: NOTE_ITEM }, { x: 2, y: 2, note: OTHER_NOTE }],
  tokenNotes: { a: NOTE_ITEM, b: OTHER_NOTE }, notes: [NOTE_ITEM, OTHER_NOTE], images: [MAP_IMAGE],
};

async function setup() {
  const vault = createInMemoryApp({ files: { 'Private/secret.md': 'mine', 'atlas-vtt/assets/mine.png': 'png' } });
  const { app, files } = vault;
  const pulled = PulledItems.create(app.vault.adapter, PATHS);
  await pulled.ready();
  const { atlas, scenes: api } = scenesOver(vault);
  // One addToCollection per pull: Atlas writes the images, the map file and the record under its own lock.
  const scenes = { list: vi.fn(api.list), addToCollection: vi.fn(api.addToCollection) };
  const images = vi.fn(async (fingerprint: string): Promise<PulledItem> => ({
    kind: 'image', version: fingerprint, mime: 'image/png', bytes: new TextEncoder().encode('map-bytes').buffer as ArrayBuffer,
  }));
  const confirmUpdate = vi.fn(async (): Promise<'both' | 'theirs' | null> => 'theirs');
  const notify = vi.fn();
  const deps = (notes: Record<string, string>): MapPullDeps => ({
    app, scenes, pulled, pullImage: images, notes: new Map(Object.entries(notes)), confirmUpdate, notify,
  });
  return { app, files, pulled, atlas, scenes, images, confirmUpdate, notify, deps };
}

const input = (payload: MapPayload) => ({
  tableId: TABLE_ID, from: 'ana', personName: 'Ana',
  item: { item: 'm'.repeat(22), kind: 'map' as const, title: 'Inn', version: 'V'.repeat(43), size: 1 }, payload,
});
const newer = (payload: MapPayload) => ({ ...input(payload), item: { ...input(payload).item, version: 'W'.repeat(43) } });

/** Where the saved map's tokens link notes: Atlas writes no pins for a new scene, so token links are how received notes show. */
const notePaths = (text: string | undefined): unknown[] =>
  Object.values(mapState(text).objects.tokens as Record<string, { notePath?: string }>).flatMap((token) => (token.notePath ? [token.notePath] : []));

describe('pulling a map', () => {
  it('writes its images by fingerprint and the map with its scene record in the Shared with me collection', async () => {
    const { files, atlas, scenes, deps } = await setup();
    const outcome = await pullMap(deps({ [NOTE_ITEM]: 'Shared/Ana/Inn.md' }), input(playerSafe));
    const mapPath = `${SCENES}/Inn.atlasmap`;
    expect(outcome).toEqual({ kind: 'created', path: mapPath });
    expect([...atlas.scenes.collections.keys()]).toEqual([SHARED_COLLECTION]);
    expect(files.get(IMAGE)).toBe('map-bytes');
    expect(scenes.addToCollection).toHaveBeenCalledTimes(1);
    expect(scenes.addToCollection).toHaveBeenCalledWith(expect.objectContaining({ collection: { name: SHARED_COLLECTION }, name: 'Inn', folder: SCENES }));
    expect(await scenes.list()).toEqual([expect.objectContaining({ name: 'Inn', collectionId: SHARED_COLLECTION, mapPath })]);
    const state = mapState(files.get(mapPath));
    expect(state.background).toBe(IMAGE);
    expect(notePaths(files.get(mapPath))).toEqual(['Shared/Ana/Inn.md']);
  });

  it('linked notes only when ticked: a token whose note was not pulled links none', async () => {
    const { files, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    expect(notePaths(files.get(`${SCENES}/Inn.atlasmap`))).toEqual([]);
    expect(mapState(files.get(`${SCENES}/Inn.atlasmap`)).objects.pins).toEqual({});
  });

  it('a re-pull seeds the linked notes from the ones pulled before, so their links stay', async () => {
    const { files, pulled, deps } = await setup();
    files.set('Shared/Ana/Inn.md', 'note');
    files.set('Shared/Ana/Gone.md', 'note');
    pulled.put({ tableId: TABLE_ID, from: 'ana', item: NOTE_ITEM, kind: 'note', path: 'Shared/Ana/Inn.md', version: 'v', pulledAt: 1 });
    // This note was pulled once, but its file was deleted since: its link goes.
    pulled.put({ tableId: TABLE_ID, from: 'ana', item: OTHER_NOTE, kind: 'note', path: 'Shared/Ana/Missing.md', version: 'v', pulledAt: 1 });
    await pullMap(deps({}), input(playerSafe));
    expect(notePaths(files.get(`${SCENES}/Inn.atlasmap`))).toEqual(['Shared/Ana/Inn.md']);
  });

  it('clears paths it did not write from a full map', async () => {
    const { files, deps } = await setup();
    const full: MapPayload = {
      format: 'atlas-share-map-v1', mode: 'full', name: 'Inn',
      map: {
        background: `atlas-share-image:${MAP_IMAGE}`,
        objects: {
          tokens: {
            t: { id: 't', kind: 'character', x: 0, y: 0, imagePath: 'atlas-vtt/assets/mine.png', notePath: 'Private/secret.md', name: 'Private/secret.md' },
            u: { id: 'u', kind: 'character', x: 0, y: 0, imagePath: '', notePath: `atlas-share-note:${NOTE_ITEM}`, name: 'Guard' },
          },
          pins: { p: { id: 'p', kind: 'pin', x: 0, y: 0, notePath: `atlas-share-note:${NOTE_ITEM}` }, q: { id: 'q', kind: 'pin', x: 0, y: 0, notePath: 'Private/secret.md' } },
        },
        dmNotePath: 'Private/secret.md',
      },
      notes: [NOTE_ITEM], images: [MAP_IMAGE],
    };
    await pullMap(deps({ [NOTE_ITEM]: 'Shared/Ana/Inn.md' }), input(full));
    const text = files.get(`${SCENES}/Inn.atlasmap`)!;
    expect(text).not.toContain('Private/secret.md');
    expect(text).not.toContain('atlas-vtt/assets/mine.png');
    const state = mapState(text);
    expect(state.background).toBe(IMAGE);
    expect(state.objects.tokens.t.imagePath).toBe('');
    expect(state.objects.tokens.t).not.toHaveProperty('notePath');
    expect(state.objects.tokens.u.notePath).toBe('Shared/Ana/Inn.md');
    expect(state.objects.pins).toEqual({});
  });

  it('clears every *Path field of the map types, and a new one fails this test until it is covered', async () => {
    // The map's record types are Atlas's (the vendored API types) and the note pin (`sharedMapFile.ts`).
    const api = readFileSync(resolve(__dirname, '../../../../vendor/atlas/api-types/atlas-vtt-api.d.ts'), 'utf8');
    // The initiative list and the widgets travel in a saved map too.
    const records = ['BaseToken', 'Character', 'Token', 'TextElement', 'DrawingStroke', 'FogBrushStroke', 'FogLassoFill', 'FogRectangleFill',
      'InitiativeEntry', 'InitiativeState', 'Widget', 'ClockWidget', 'CounterWidget', 'TimerWidget', 'WidgetSettings']
      .map((name) => api.match(new RegExp(`(?:export )?declare interface ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? `missing ${name}`);
    const types = [...records, readFileSync(resolve(__dirname, '../../../../src/app/online/sharing/model/sharedMapFile.ts'), 'utf8')].join('\n');
    expect(types).not.toContain('missing');
    const fields = [...new Set([...types.matchAll(/\b(\w*Path)\??:/g)].map((match) => match[1] as string))].sort();
    expect(fields).toEqual(['imagePath', 'notePath', 'statblockPath']);
    const foreign = Object.fromEntries(fields.map((field) => [field, `Secret/${field}.md`]));
    const { files, deps } = await setup();
    const full: MapPayload = {
      format: 'atlas-share-map-v1', mode: 'full', name: 'Inn',
      map: {
        background: 'Secret/background.png',
        objects: {
          tokens: { t: { id: 't', kind: 'character', x: 0, y: 0, ...foreign } },
          pins: { p: { id: 'p', kind: 'pin', x: 0, y: 0, ...foreign } },
        },
        initiative: { entries: [{ id: 'e', tokenId: 't', name: 'E', ...foreign }] },
        widgetSettings: { widgets: { w: { id: 'w', type: 'counter', label: 'W', ...foreign } } },
      },
      notes: [], images: [],
    };
    await pullMap(deps({}), input(full));
    expect(files.get(`${SCENES}/Inn.atlasmap`)).not.toContain('Secret/');
  });

  it('writes no image whose bytes are not the fingerprint it was asked for', async () => {
    const { files, images, deps } = await setup();
    images.mockImplementation(async (): Promise<PulledItem> => ({
      kind: 'image', version: fingerprintOf('other-bytes'), mime: 'image/png', bytes: new TextEncoder().encode('other-bytes').buffer as ArrayBuffer,
    }));
    await pullMap(deps({}), input(playerSafe));
    expect([...files.keys()].some((path) => path.includes('/files/'))).toBe(false);
    expect(mapState(files.get(`${SCENES}/Inn.atlasmap`)).background).toBeNull();
  });

  it('a re-pull of a newer version arrives as a new scene that later pulls follow, its saved images used again (Atlas cannot replace a scene yet)', async () => {
    const { files, pulled, scenes, images, notify, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    expect(await pullMap(deps({}), newer(playerSafe))).toEqual({ kind: 'updated', path: `${SCENES}/Inn (2).atlasmap` });
    expect(notify).toHaveBeenCalledWith(`The new version of Inn is a new scene, ${SCENES}/Inn (2).atlasmap: Atlas VTT cannot replace a scene yet.`);
    expect(images).toHaveBeenCalledTimes(1);
    expect(scenes.addToCollection.mock.calls[1]![0].images).toEqual([]);
    expect(mapState(files.get(`${SCENES}/Inn (2).atlasmap`)).background).toBe(IMAGE);
    expect(pulled.get(TABLE_ID, 'ana', 'm'.repeat(22))).toMatchObject({ path: `${SCENES}/Inn (2).atlasmap`, version: 'W'.repeat(43) });
    expect(await pulled.readBase(pulled.get(TABLE_ID, 'ana', 'm'.repeat(22))!)).toBe(files.get(`${SCENES}/Inn (2).atlasmap`));
  });

  it("uses an image the fork's preview saved (Shared with me/files/<person>/) without pulling it again", async () => {
    const { files, atlas, images, deps } = await setup();
    // The fork's Shared with me collection, as Atlas indexes it, with the image the fork received for Ana.
    atlas.scenes.addScene({ name: 'Old inn', collectionId: SHARED_COLLECTION, mapPath: `atlas-vtt/collections/${SHARED_COLLECTION}/scenes/Ana/Old inn.atlasmap` });
    const forkImage = `atlas-vtt/collections/${SHARED_COLLECTION}/files/Ana/${MAP_IMAGE}.png`;
    files.set(forkImage, 'map-bytes');
    const outcome = await pullMap(deps({}), input(playerSafe));
    expect(images).not.toHaveBeenCalled();
    expect(files.has(IMAGE)).toBe(false);
    expect(mapState(files.get((outcome as { path: string }).path)).background).toBe(forkImage);
    expect(files.get(forkImage)).toBe('map-bytes');
  });

  it('a re-pull of the version already pulled, still as Atlas saved it, is unchanged and adds no scene', async () => {
    const { pulled, scenes, images, confirmUpdate, notify, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    expect(await pullMap(deps({}), input(playerSafe))).toEqual({ kind: 'unchanged', path: `${SCENES}/Inn.atlasmap` });
    expect(scenes.addToCollection).toHaveBeenCalledTimes(1);
    expect(images).toHaveBeenCalledTimes(1);
    expect(confirmUpdate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(pulled.list()).toHaveLength(1);
  });

  it('a map changed here asks first: Keep both adds the new version and keeps following the first; closing changes nothing', async () => {
    const { files, pulled, scenes, confirmUpdate, notify, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    files.set(`${SCENES}/Inn.atlasmap`, `${files.get(`${SCENES}/Inn.atlasmap`)!} `);
    confirmUpdate.mockResolvedValueOnce(null);
    expect(await pullMap(deps({}), newer(playerSafe))).toEqual({ kind: 'cancelled' });
    expect(scenes.addToCollection).toHaveBeenCalledTimes(1);
    confirmUpdate.mockResolvedValueOnce('both');
    expect(await pullMap(deps({}), newer(playerSafe))).toEqual({ kind: 'both', path: `${SCENES}/Inn (2).atlasmap` });
    expect(notify).not.toHaveBeenCalled();
    expect(confirmUpdate).toHaveBeenCalledWith('Inn');
    expect(pulled.get(TABLE_ID, 'ana', 'm'.repeat(22))).toMatchObject({ path: `${SCENES}/Inn.atlasmap`, version: 'V'.repeat(43) });
  });

  it('never overwrites another map that took a deleted map’s path, and writes the deleted one anew', async () => {
    const { files, pulled, atlas, deps } = await setup();
    const other = { ...input(playerSafe), item: { ...input(playerSafe).item, item: 'x'.repeat(22) } };
    const first = await pullMap(deps({}), input(playerSafe));
    files.delete(`${SCENES}/Inn.atlasmap`);
    // Atlas drops the scene of a deleted map file; Connect's record keeps its base but owns no file.
    atlas.scenes.removeScene(pulled.byPath((first as { path: string }).path)!.sceneId!);
    pulled.deleted(`${SCENES}/Inn.atlasmap`);
    expect(await pullMap(deps({}), other)).toEqual({ kind: 'created', path: `${SCENES}/Inn.atlasmap` });
    const second = files.get(`${SCENES}/Inn.atlasmap`);
    expect(await pullMap(deps({}), newer(playerSafe))).toEqual({ kind: 'created', path: `${SCENES}/Inn (2).atlasmap` });
    expect(files.get(`${SCENES}/Inn.atlasmap`)).toBe(second);
  });

  it('leaves no map file, image or record behind when its scene record cannot be added', async () => {
    const { files, pulled, atlas, deps } = await setup();
    atlas.scenes.failNextAdd = { error: new Error('no'), after: 'record' };
    await expect(pullMap(deps({}), input(playerSafe))).rejects.toThrow('no');
    expect(files.has(`${SCENES}/Inn.atlasmap`)).toBe(false);
    expect(files.has(IMAGE)).toBe(false);
    expect(pulled.list()).toEqual([]);
  });

  it('a failed add rejects with its own error and records nothing', async () => {
    const { pulled, atlas, deps } = await setup();
    atlas.scenes.failNextAdd = { error: new Error('no scene'), after: 'writes' };
    await expect(pullMap(deps({}), input(playerSafe))).rejects.toThrow('no scene');
    expect(pulled.list()).toEqual([]);
  });

  it('fails closed when a folder named Shared with me that no collection indexes is in the way, as Atlas refuses to create the collection', async () => {
    const vault = createInMemoryApp();
    vault.folders.add(`atlas-vtt/collections/shared WITH me`);
    const pulled = PulledItems.create(vault.app.vault.adapter, PATHS);
    const { scenes } = scenesOver(vault);
    const deps: MapPullDeps = { app: vault.app, scenes, pulled, pullImage: async () => { throw new Error('gone'); }, notes: new Map(), confirmUpdate: async () => 'theirs' };
    await expect(pullMap(deps, input(playerSafe))).rejects.toThrow('A folder named "Shared with me" already exists in the collections folder');
    expect([...vault.files.keys()].filter((path) => path.startsWith('atlas-vtt/collections/'))).toEqual([]);
    expect(pulled.list()).toEqual([]);
  });

  it('skips an image that cannot be pulled and still brings the map', async () => {
    const { files, images, deps } = await setup();
    images.mockRejectedValue(new Error('gone'));
    expect(await pullMap(deps({}), input(playerSafe))).toMatchObject({ kind: 'created' });
    expect(mapState(files.get(`${SCENES}/Inn.atlasmap`)).background).toBeNull();
  });

  it('creates the collection once when two first pulls run together', async () => {
    const { atlas, scenes, deps } = await setup();
    const outcomes = await Promise.all([
      pullMap(deps({}), input(playerSafe)),
      pullMap(deps({}), { ...input(playerSafe), item: { ...input(playerSafe).item, item: 'x'.repeat(22) } }),
    ]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['created', 'created']);
    expect([...atlas.scenes.collections.keys()]).toEqual([SHARED_COLLECTION]);
    expect((await scenes.list()).map((scene) => scene.collectionId)).toEqual([SHARED_COLLECTION, SHARED_COLLECTION]);
  });
});

describe('a received map is untrusted', () => {
  it('lands in its own folder whatever its name and its sender’s name say', async () => {
    const { files, deps } = await setup();
    const outcome = await pullMap(deps({}), { ...input({ ...playerSafe, name: '../../../Private/secret' }), personName: '../../Private' });
    expect(outcome).toMatchObject({ kind: 'created' });
    const path = (outcome as { path: string }).path;
    expect(path.startsWith(`atlas-vtt/collections/${SHARED_COLLECTION}/scenes/`)).toBe(true);
    expect(path.split('/').some((segment) => segment === '..')).toBe(false);
    expect(files.get('Private/secret.md')).toBe('mine');
  });

  it('never carries lighting, camera or other keys of a full map, and a __proto__ key stays a plain key', async () => {
    const { files, deps } = await setup();
    const map = JSON.parse(`{"objects":{"tokens":{"__proto__":{"id":"x","kind":"token","x":0,"y":0,"imagePath":"Private/secret.md"}}},
      "lighting":{"enabled":true,"ambient":0},"camera":{"x":5,"y":5,"scale":3},"notes":"Private/secret.md","__proto__":{"background":"Private/secret.md"}}`) as Record<string, unknown>;
    await pullMap(deps({}), input({ format: 'atlas-share-map-v1', mode: 'full', name: 'Inn', map, notes: [], images: [] }));
    const text = files.get(`${SCENES}/Inn.atlasmap`)!;
    const state = mapState(text);
    expect(state).not.toHaveProperty('lighting');
    expect(state.camera).toEqual({ x: 0, y: 0, scale: 1 });
    expect(state.background).toBeNull();
    expect(text).not.toContain('Private/secret.md');
    expect(({} as Record<string, unknown>).background).toBeUndefined();
  });
});

describe('the question for a received map changed here', () => {
  it('says that both answers add a scene and neither replaces the receiver’s copy, with no warning style', () => {
    const dialog = mapUpdateDialog('Inn');
    expect(dialog.title).toBe('Inn changed here and was shared again');
    expect(dialog.message).toEqual(['Both answers add the new version as a new scene; your copy stays as it is. Take theirs makes later pulls follow the new scene; Keep both keeps them on yours.']);
    expect(dialog.choices).toEqual([{ label: 'Keep both', value: 'both' }, { label: 'Take theirs', value: 'theirs' }]);
  });
});
