import { describe, expect, it, vi } from 'vitest';
import type { ScenesApi } from '@atlas-vtt/api-types';
import { mapShareOf, mapShareReaches, parseMapShare, writeMapShare, type MapShare } from '../../../../src/app/online/sharing/model/mapShare';
import { followVaultChange } from '../../../../src/app/online/sharing/model/mapShareRenames';
import { linkedNotesOf, offeredNotes } from '../../../../src/app/online/sharing/model/linkedNotes';
import type { Person } from '../../../../src/app/online/sharing/people/peopleTypes';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';
import { mapFile } from './mapFileFixture';

const T = 'T'.repeat(43);
const share: MapShare = { item: 'i'.repeat(22), everyone: false, people: [`${T}/ana`], except: [], mode: 'player-safe', notes: ['Notes/Inn.md'] };

/** Atlas's scenes, with one scene `s1` for `m.atlasmap`; `data` is what its record holds besides. */
function scenesWith(data: Record<string, unknown> = {}): { atlas: FakeAtlas; scenes: ScenesApi } {
  const atlas = new FakeAtlas({ capabilities: ['scenes'] });
  atlas.scenes.addScene({ id: 's1', name: 'Inn', collectionId: 'c', mapPath: 'm.atlasmap', data });
  return { atlas, scenes: atlas.connect(connectingPlugin('atlas-vtt-connect')).scenes };
}

describe('map shares on scene records', () => {
  it('reads only well-formed shares', async () => {
    const { scenes } = scenesWith({ extensions: { 'atlas-vtt-connect': share } });
    expect(await mapShareOf(scenes, 's1')).toEqual(share);
    expect(parseMapShare({ ...share, mode: 'everything' })).toBeNull();
    expect(parseMapShare({ ...share, item: 'short' })).toBeNull();
    expect(await mapShareOf(scenesWith().scenes, 's1')).toBeNull();
  });

  it('reaches people by key, aliases included, and never the excepted', () => {
    const ana: Person = { tableId: T, personId: 'ana', name: 'Ana', formerNames: [], devices: [], aliases: [`${T}/old`], lastSeen: 0 };
    const people = { byKey: (key: string): Person | null => (key === `${T}/ana` || key === `${T}/old` ? ana : null) };
    expect(mapShareReaches(share, { tableId: T, personId: 'ana' }, people)).toBe(true);
    expect(mapShareReaches({ ...share, people: [`${T}/old`] }, { tableId: T, personId: 'ana' }, people)).toBe(true);
    expect(mapShareReaches(share, { tableId: T, personId: 'ben' }, people)).toBe(false);
    expect(mapShareReaches({ ...share, everyone: true, except: [`${T}/ana`] }, { tableId: T, personId: 'ana' }, people)).toBe(false);
  });

  it('writes and clears through the scene record, keeping its other data', async () => {
    const { atlas, scenes } = scenesWith({ tags: ['inn'] });
    await writeMapShare(scenes, 's1', share);
    expect(atlas.scenes.record('s1')).toMatchObject({ mapPath: 'm.atlasmap', data: { tags: ['inn'], extensions: { 'atlas-vtt-connect': share } } });
    await writeMapShare(scenes, 's1', null);
    expect(atlas.scenes.record('s1')).toMatchObject({ mapPath: 'm.atlasmap', data: { tags: ['inn'] } });
    expect(atlas.scenes.record('s1')!.data).not.toHaveProperty('extensions');
  });

  it('is dropped from copies and exports, and so is a legacy data.sharing', async () => {
    const { atlas, scenes } = scenesWith({ sharing: share });
    await writeMapShare(scenes, 's1', share);
    expect(atlas.scenes.exported('s1')).toMatchObject({ mapPath: 'm.atlasmap', data: {} });
    expect(JSON.stringify(atlas.scenes.exported('s1'))).not.toContain(share.item);
  });
});

describe('linked notes of a map', () => {
  const map = mapFile({
    background: 'maps/inn.png',
    objects: {
      pins: { p1: { id: 'p1', kind: 'pin', x: 1, y: 1, notePath: 'Notes/Inn.md' }, p2: { id: 'p2', kind: 'pin', x: 2, y: 2, notePath: 'Notes/Plot.md', gmOnly: true } },
      tokens: {
        t1: { id: 't1', kind: 'character', x: 0, y: 0, imagePath: 'a.png', notePath: 'Notes/Hero.md' },
        t2: { id: 't2', kind: 'character', x: 0, y: 0, imagePath: 'b.png', statblockPath: 'Monsters/Ogre.md', isHidden: true },
      },
    },
  });

  it('lists pins and tokens, and player-safe shares never offer what players cannot see', () => {
    expect(linkedNotesOf(map).map((note) => [note.path, note.hidden])).toEqual([
      ['Notes/Inn.md', false], ['Notes/Plot.md', true], ['Notes/Hero.md', false], ['Monsters/Ogre.md', true],
    ]);
    expect(offeredNotes(map, 'player-safe').map((note) => note.path)).toEqual(['Notes/Inn.md', 'Notes/Hero.md']);
    expect(offeredNotes(map, 'full')).toHaveLength(4);
  });
});

describe('ticked notes follow the vault (I3)', () => {
  /** Scenes `a` and `b` (and more), each shared with these ticked notes; `setData` is watched. */
  function shared(scenes: Record<string, string[] | null>): { atlas: FakeAtlas; api: ScenesApi; setData: ReturnType<typeof vi.spyOn> } {
    const atlas = new FakeAtlas({ capabilities: ['scenes'] });
    for (const [id, notes] of Object.entries(scenes)) {
      atlas.scenes.addScene({ id, name: id, mapPath: `${id}.atlasmap`, data: notes ? { extensions: { 'atlas-vtt-connect': { ...share, notes } } } : {} });
    }
    const api = { ...atlas.connect(connectingPlugin('atlas-vtt-connect')).scenes };
    return { atlas, api, setData: vi.spyOn(api, 'setData') };
  }
  const notesOf = (atlas: FakeAtlas, id: string): unknown => (atlas.scenes.record(id)!.data.extensions?.['atlas-vtt-connect'] as MapShare).notes;

  it('re-reads each scene before writing, so a concurrent map path update is not undone (F-b)', async () => {
    const { atlas, api } = shared({ a: ['Notes/Inn.md'] });
    // The list was read before Atlas moved the map.
    const list = api.list;
    api.list = async () => { const stale = await list(); atlas.scenes.moveMap('a', 'moved/a.atlasmap'); return stale; };
    await followVaultChange(api, { rename: ['Notes', 'Archive'] });
    expect(atlas.scenes.record('a')!.mapPath).toBe('moved/a.atlasmap');
    expect(notesOf(atlas, 'a')).toEqual(['Archive/Inn.md']);
  });

  it('keeps a renamed or moved note ticked under its new path, folders included', async () => {
    const { atlas, api, setData } = shared({ a: ['Notes/Inn.md', 'Other/Keep.md'], b: ['Other/Keep.md'] });
    await followVaultChange(api, { rename: ['Notes', 'Archive/Notes'] });
    expect(setData).toHaveBeenCalledTimes(1);
    expect(notesOf(atlas, 'a')).toEqual(['Archive/Notes/Inn.md', 'Other/Keep.md']);
  });

  it('unticks a deleted note, so a new file at its path is not shared', async () => {
    const { atlas, api } = shared({ a: ['Notes/Inn.md', 'Other/Keep.md'] });
    await followVaultChange(api, { removed: 'Notes/Inn.md' });
    expect(notesOf(atlas, 'a')).toEqual(['Other/Keep.md']);
  });

  it('writes nothing when no ticked note is affected', async () => {
    const { api, setData } = shared({ a: ['Notes/Inn.md'], m: null });
    await followVaultChange(api, { rename: ['Notes/Inn.md.bak', 'x'] });
    await followVaultChange(api, { removed: 'Elsewhere' });
    expect(setData).not.toHaveBeenCalled();
  });
});
