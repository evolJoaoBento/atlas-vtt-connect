import { describe, expect, it } from 'vitest';
import type { MapPayload } from '../../../../src/app/online/sharing/model/mapPayload';
import { CLOSE_TO_UPDATE, pullMap } from '../../../../src/app/online/sharing/receive/mapPull';
import { PulledItems } from '../../../../src/app/online/sharing/receive/PulledItems';
import { mapUpdateDialog } from '../../../../src/app/online/sharing/registerReceiving';
import { mapOpenIn } from '../../../../src/app/online/sharing/registerSharing';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';
import { IMAGE, input, MAP_IMAGE, newer, NOTE_ITEM, playerSafe, SCENES, setup } from './mapPullFixture';
import { mapState } from './receiveFixtures';
import { TABLE_ID } from './sharingFixtures';
import { PATHS } from './sharingPathsFixture';

// A re-pull on an Atlas with `scenes.replaceMap` (1.13.0): the received map is replaced in place, as the fork did.

const MAP = `${SCENES}/Inn.atlasmap`;
const ITEM = 'm'.repeat(22);

const full = (camera: { x: number; y: number; scale: number }): MapPayload => ({
  format: 'atlas-share-map-v1', mode: 'full', name: 'Inn',
  map: {
    background: `atlas-share-image:${MAP_IMAGE}`, camera, initiativeTrackerOpen: true, tokenSettings: { showNameplates: true },
    objects: { tokens: {}, pins: { p: { id: 'p', kind: 'pin', x: 1, y: 2, notePath: `atlas-share-note:${NOTE_ITEM}`, gmOnly: true } }, walls: { w: { id: 'w', kind: 'wall' } } },
  },
  notes: [NOTE_ITEM], images: [MAP_IMAGE],
});

describe('a re-pull where Atlas can replace the received map', () => {
  it('Take theirs on a map changed here replaces it in place: same scene and path, the new version followed, the GM\'s play kept', async () => {
    const { files, pulled, scenes, confirmUpdate, notify, deps } = await setup();
    files.set('Shared/Ana/Inn.md', 'note');
    await pullMap(deps({ [NOTE_ITEM]: 'Shared/Ana/Inn.md' }), input(full({ x: 1, y: 1, scale: 1 })));
    const sceneId = pulled.get(TABLE_ID, 'ana', ITEM)!.sceneId!;
    const changed = mapState(files.get(MAP));
    files.set(MAP, JSON.stringify({ state: { ...changed, dmNotePath: 'DM/Inn.md' }, version: 4 }));
    expect(await pullMap(deps({ [NOTE_ITEM]: 'Shared/Ana/Inn.md' }), newer(full({ x: 9, y: 8, scale: 2 })))).toEqual({ kind: 'updated', path: MAP });
    expect(confirmUpdate).toHaveBeenCalledWith('Inn', true);
    expect(scenes.addToCollection).toHaveBeenCalledTimes(1);
    expect(scenes.replaceMap).toHaveBeenCalledWith(sceneId, expect.anything());
    const state = mapState(files.get(MAP));
    expect(state).toMatchObject({ camera: { x: 9, y: 8, scale: 2 }, dmNotePath: 'DM/Inn.md', initiativeTrackerOpen: true, background: IMAGE });
    expect(state.objects.pins).toEqual({ p: { id: 'p', kind: 'pin', x: 1, y: 2, notePath: 'Shared/Ana/Inn.md', gmOnly: true } });
    expect(state.objects.walls).toEqual({ w: { id: 'w', kind: 'wall' } });
    expect((await scenes.list()).map((scene) => scene.id)).toEqual([sceneId]);
    expect(pulled.get(TABLE_ID, 'ana', ITEM)).toMatchObject({ path: MAP, sceneId, version: 'W'.repeat(43) });
    expect(await pulled.readBase(pulled.get(TABLE_ID, 'ana', ITEM)!)).toBe(files.get(MAP));
    expect(notify).not.toHaveBeenCalled();
  });

  it('Keep both adds the new version as a second scene that later pulls do not follow', async () => {
    const { files, pulled, confirmUpdate, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    files.set(MAP, `${files.get(MAP)!} `);
    confirmUpdate.mockResolvedValueOnce('both');
    expect(await pullMap(deps({}), newer(playerSafe))).toEqual({ kind: 'both', path: `${SCENES}/Inn (2).atlasmap` });
    expect(files.get(MAP)!.endsWith(' ')).toBe(true);
    expect(pulled.get(TABLE_ID, 'ana', ITEM)).toMatchObject({ path: MAP, version: 'V'.repeat(43) });
  });

  it(`a scene open in a map view is not replaced: the receiver is told "${CLOSE_TO_UPDATE}" and the pull stays pending until it is closed`, async () => {
    const { files, atlas, pulled, scenes, images, notify, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    const before = files.get(MAP);
    const open = new Set([MAP]);
    const withViews = { ...deps({}), isOpen: (path: string) => open.has(path) };
    images.mockClear();
    const changedArt = { ...playerSafe, images: [MAP_IMAGE, 'N'.repeat(43)] };
    expect(await pullMap(withViews, newer(changedArt))).toEqual({ kind: 'cancelled' });
    // Nothing is pulled for a scene that cannot be replaced now.
    expect(images).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(`Inn is open in a map view. ${CLOSE_TO_UPDATE}`);
    expect(files.get(MAP)).toBe(before);
    expect(scenes.replaceMap).not.toHaveBeenCalled();
    expect(pulled.get(TABLE_ID, 'ana', ITEM)!.version).toBe('V'.repeat(43));
    // Atlas's own refusal, for a tab the check did not see, keeps the pull pending too.
    atlas.views.open('v1', [{ tabId: 't1', mapPath: MAP, name: 'Inn' }]);
    expect(await pullMap(deps({}), newer(playerSafe))).toEqual({ kind: 'cancelled' });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(files.get(MAP)).toBe(before);
    atlas.views.close('v1');
    open.clear();
    expect(await pullMap(withViews, newer(playerSafe))).toEqual({ kind: 'updated', path: MAP });
    expect(pulled.get(TABLE_ID, 'ana', ITEM)!.version).toBe('W'.repeat(43));
    expect(scenes.addToCollection).toHaveBeenCalledTimes(1);
  });

  it('a scene received before Atlas could replace one (the fork made it) gets the new version as a new scene that later pulls follow, and the honest question', async () => {
    const { files, atlas, pulled, scenes, confirmUpdate, notify, deps } = await setup();
    // The fork's preview received this map: Connect did not add its scene, so its record is not marked replaceable.
    const sceneId = atlas.scenes.addScene({ name: 'Inn', collectionId: 'Shared with me', mapPath: MAP });
    atlas.scenes.setMap(MAP, { background: null, grid: null, objects: { tokens: {}, texts: {}, drawings: {}, fog: {} } });
    const record = pulled.put({ tableId: TABLE_ID, from: 'ana', item: ITEM, kind: 'map', path: MAP, version: 'V'.repeat(43), pulledAt: 1, sceneId });
    await pulled.writeBase(record, files.get(MAP)!);
    const outcome = await pullMap(deps({}), newer(playerSafe));
    expect(outcome).toEqual({ kind: 'updated', path: `${SCENES}/Inn (2).atlasmap` });
    expect(scenes.replaceMap).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(`The new version of Inn is a new scene, ${SCENES}/Inn (2).atlasmap: your copy came in before Atlas VTT could replace a received map.`);
    expect(pulled.get(TABLE_ID, 'ana', ITEM)).toMatchObject({ path: `${SCENES}/Inn (2).atlasmap`, version: 'W'.repeat(43), replaceable: true });
    // Changed here, the question says both answers add a scene: Connect knows it cannot replace this copy.
    files.set(MAP, `${files.get(MAP)!} `);
    pulled.update(pulled.get(TABLE_ID, 'ana', ITEM)!.key, { path: MAP, sceneId, version: 'V'.repeat(43) });
    const unmarked = pulled.get(TABLE_ID, 'ana', ITEM)!;
    const { replaceable: _replaceable, ...plain } = unmarked;
    pulled.put(plain);
    await pullMap(deps({}), newer(playerSafe));
    expect(confirmUpdate).toHaveBeenCalledWith('Inn', false);
  });

  it('marks the scenes Connect adds where Atlas can replace them, and the mark survives a reload; an older Atlas marks none', async () => {
    const { app, pulled, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    expect(pulled.get(TABLE_ID, 'ana', ITEM)).toMatchObject({ replaceable: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const reloaded = PulledItems.create(app.vault.adapter, PATHS);
    await reloaded.ready();
    expect(reloaded.get(TABLE_ID, 'ana', ITEM)).toMatchObject({ replaceable: true });
    const older = await setup({ older: true });
    await pullMap(older.deps({}), input(playerSafe));
    expect(older.pulled.get(TABLE_ID, 'ana', ITEM)).not.toHaveProperty('replaceable');
  });

  it('a marked scene Atlas still refuses (its index forgot who added it) gets the new version as a new scene, and the receiver is told', async () => {
    const { pulled, scenes, notify, deps } = await setup();
    await pullMap(deps({}), input(playerSafe));
    scenes.replaceMap!.mockRejectedValueOnce(new Error('[Atlas API] replaceMap: only a scene this extension added with addToCollection can be replaced.'));
    expect(await pullMap(deps({}), newer(playerSafe))).toEqual({ kind: 'updated', path: `${SCENES}/Inn (2).atlasmap` });
    expect(notify).toHaveBeenCalledWith(`The new version of Inn is a new scene, ${SCENES}/Inn (2).atlasmap: Atlas VTT did not replace your copy.`);
    expect(pulled.get(TABLE_ID, 'ana', ITEM)).toMatchObject({ path: `${SCENES}/Inn (2).atlasmap`, version: 'W'.repeat(43) });
  });
});

describe('a received map on an Atlas before 1.13.0', () => {
  it('arrives without the fields that Atlas ignores, and nothing throws', async () => {
    const { files, scenes, deps } = await setup({ older: true });
    files.set('Shared/Ana/Inn.md', 'note');
    expect(await pullMap(deps({ [NOTE_ITEM]: 'Shared/Ana/Inn.md' }), input(full({ x: 9, y: 8, scale: 2 })))).toMatchObject({ kind: 'created' });
    expect(scenes).not.toHaveProperty('replaceMap');
    const state = mapState(files.get(MAP));
    expect(state.objects).toMatchObject({ pins: {}, walls: {}, lights: {} });
    expect(state.camera).toEqual({ x: 0, y: 0, scale: 1 });
    expect(state).not.toHaveProperty('tokenSettings');
    expect(state).not.toHaveProperty('initiativeTrackerOpen');
  });
});

describe('whether a received map is open', () => {
  it('looks at the GM map views, loaded or among their tabs, and never at a remote view', () => {
    const atlas = new FakeAtlas({ capabilities: ['views'] });
    const isOpen = mapOpenIn(atlas.connect(connectingPlugin('atlas-vtt-connect')).views);
    atlas.views.open('v1', [{ tabId: 't1', mapPath: 'a.atlasmap', name: 'A' }, { tabId: 't2', mapPath: MAP, name: 'Inn' }]);
    atlas.views.openRemote('r1');
    atlas.views.setSnapshot('r1', { ...atlas.views.sceneOf('r1')!, mapPath: 'remote:r1', loaded: true });
    expect([MAP, 'a.atlasmap', 'b.atlasmap', 'remote:r1'].map(isOpen)).toEqual([true, true, false, false]);
    atlas.views.close('v1');
    expect(isOpen(MAP)).toBe(false);
  });
});

describe('the question for a received map changed here', () => {
  it('says that both answers add a scene and neither replaces the receiver’s copy, with no warning style', () => {
    const dialog = mapUpdateDialog('Inn');
    expect(dialog.title).toBe('Inn changed here and was shared again');
    expect(dialog.message).toEqual(['Both answers add the new version as a new scene; your copy stays as it is. Take theirs makes later pulls follow the new scene; Keep both keeps them on yours.']);
    expect(dialog.choices).toEqual([{ label: 'Keep both', value: 'both' }, { label: 'Take theirs', value: 'theirs' }]);
  });

  it('where Atlas replaces the scene, is the fork’s: Take theirs replaces the copy, with the warning style', () => {
    const dialog = mapUpdateDialog('Inn', true);
    expect(dialog.title).toBe('Inn changed here and was shared again');
    expect(dialog.message).toEqual(['Keep both saves the new version as a second scene. Take theirs replaces your copy.']);
    expect(dialog.choices).toEqual([{ label: 'Keep both', value: 'both' }, { label: 'Take theirs', value: 'theirs', style: 'warning' }]);
  });
});
