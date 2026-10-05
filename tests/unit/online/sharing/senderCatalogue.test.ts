import { describe, expect, it } from 'vitest';
import { SenderCatalogue, type CatalogueSources } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import { parseShareRule } from '../../../../src/app/online/sharing/model/shareRule';
import type { Person } from '../../../../src/app/online/sharing/people/peopleTypes';
import { memoryImageFiles, nodeHash } from '../assetFixtures';
import { mapFile, sourceOf } from './mapFileFixture';
import { simpleSections } from './obsidianSections';

const T = 'T'.repeat(43);
const person = (personId: string, name: string): Person => ({ tableId: T, personId, name, formerNames: [], devices: [], aliases: [], lastSeen: 0 });
const list = [person('ana', 'Ana'), person('ben', 'Ben')];
const people = {
  byName: (name: string): Person | null => list.find((p) => p.name === name) ?? null,
  byKey: (key: string): Person | null => list.find((p) => `${p.tableId}/${p.personId}` === key) ?? null,
  get: (tableId: string, personId: string): Person | null => list.find((p) => p.tableId === tableId && p.personId === personId) ?? null,
  list: (): readonly Person[] => list,
  ready: async (): Promise<void> => {},
};
const ana = { tableId: T, personId: 'ana' };
const ben = { tableId: T, personId: 'ben' };

function setup(options: { lit?: boolean; mode?: 'player-safe' | 'full' } = {}): { catalogue: SenderCatalogue; items: { idFor(path: string): string; pathOf(item: string): string | null; ready(): Promise<void> }; notes: Record<string, string> } {
  const notes: Record<string, string> = {
    'Notes/Cave.md': '---\natlas-share: [Ana]\n---\nThe cave. [[Lair]] and [[Inn]].\n> [!private]\n> Dragon.',
    'Notes/Lair.md': 'No property: private by default.',
    'Notes/Inn.md': 'The inn.',
  };
  const ids = new Map<string, string>();
  const items = {
    idFor: (path: string): string => { if (!ids.has(path)) ids.set(path, `id${ids.size}`.padEnd(22, '0')); return ids.get(path)!; },
    pathOf: (item: string): string | null => [...ids].find(([, id]) => id === item)?.[0] ?? null,
    ready: async (): Promise<void> => {},
  };
  const map = mapFile({ background: 'maps/inn.png', objects: { pins: { p: { id: 'p', kind: 'pin', x: 1, y: 1, notePath: 'Notes/Inn.md' } } } });
  const sources: CatalogueSources = {
    notes: () => [{ path: 'Notes/Cave.md', title: 'Cave', rule: parseShareRule(['Ana']) }],
    note: (path) => (notes[path] !== undefined ? { path, title: path.slice(6, -3), rule: parseShareRule(undefined) } : null),
    readNote: async (path) => { const text = notes[path] ?? ''; return { text, sections: simpleSections(text) }; },
    maps: async () => [{ name: 'Inn', mapPath: 'm.atlasmap', share: { item: 'm'.repeat(22), everyone: false, people: [`${T}/ben`], except: [], mode: options.mode ?? 'player-safe', notes: ['Notes/Inn.md'] } }],
    readMap: async () => sourceOf(map, {}, options.lit ?? false),
    images: memoryImageFiles({ 'maps/inn.png': 'png-bytes' }).source,
    isFile: (path) => path in notes || path === 'maps/inn.png',
    resolveLink: (linkpath) => (`Notes/${linkpath}.md` in notes ? `Notes/${linkpath}.md` : null),
    shareable: () => [],
    rules: () => ({ showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }),
    collectionGrid: () => null,
    coneAngle: () => 90,
    initiativeRules: () => ({ mode: 'turn-order', roll: '1d20', firstSide: 'players' }),
  };
  return { catalogue: new SenderCatalogue(sources, items, people as unknown as ConstructorParameters<typeof SenderCatalogue>[2], nodeHash, async () => ({ width: 100, height: 100 })), items, notes };
}

const text = (bytes: ArrayBuffer): string => new TextDecoder().decode(bytes);

describe('SenderCatalogue', () => {
  it('lists per person: Ana gets the cave, Ben the map and its ticked note', async () => {
    const { catalogue } = setup();
    expect((await catalogue.list(ana)).map((item) => [item.kind, item.title])).toEqual([['note', 'Cave']]);
    const forBen = await catalogue.list(ben);
    expect(forBen.map((item) => [item.kind, item.title])).toEqual([['note', 'Inn'], ['map', 'Inn']]);
    expect(forBen[1]).toMatchObject({ mode: 'player-safe', linked: [forBen[0]!.item] });
  });

  it('opens only what the person may have, filtered for them, versioned by the filtered text', async () => {
    const { catalogue, items } = setup();
    const [cave] = await catalogue.list(ana);
    const payload = (await catalogue.open(ana, cave!.item))!;
    expect(text(payload.bytes)).toBe('The cave. Lair and Inn.');
    expect(payload.version).toBe(cave!.version);
    expect(await catalogue.open(ben, cave!.item)).toBeNull();
    expect(await catalogue.open(ana, items.idFor('Notes/Lair.md'))).toBeNull();
  });

  it('an edit to a part the person never gets does not change their version', async () => {
    const { catalogue, notes } = setup();
    const before = (await catalogue.list(ana))[0]!.version;
    notes['Notes/Cave.md'] = notes['Notes/Cave.md']!.replace('Dragon.', 'A different secret.');
    expect((await catalogue.list(ana))[0]!.version).toBe(before);
    notes['Notes/Cave.md'] = notes['Notes/Cave.md']!.replace('The cave.', 'The big cave.');
    expect((await catalogue.list(ana))[0]!.version).not.toBe(before);
  });

  it('previews a note as one person gets it, whatever its rule says now', async () => {
    const { catalogue } = setup();
    // Ben gets the Inn through the map, so that link stays; the Lair he does not get.
    expect(await catalogue.previewNote(ben, 'Notes/Cave.md')).toBe('The cave. Lair and [[Inn]].');
  });

  it('serves a shared map’s image by fingerprint, checked, and nothing else', async () => {
    const { catalogue } = setup();
    const map = (await catalogue.list(ben)).find((item) => item.kind === 'map')!;
    const payload = JSON.parse(text((await catalogue.open(ben, map.item))!.bytes));
    const image = await catalogue.open(ben, `${map.item}/${payload.images[0]}`);
    expect(image).toMatchObject({ kind: 'image', mime: 'image/png' });
    expect(text(image!.bytes)).toBe('png-bytes');
    expect(await catalogue.open(ana, `${map.item}/${payload.images[0]}`)).toBeNull();
    expect(await catalogue.open(ben, `${map.item}/${'X'.repeat(43)}`)).toBeNull();
  });

  it('refuses a lit map shared player-safe: not listed, not opened, no image; a full share still goes', async () => {
    const before = setup();
    const map = (await before.catalogue.list(ben)).find((item) => item.kind === 'map')!;
    const payload = JSON.parse(text((await before.catalogue.open(ben, map.item))!.bytes));
    const { catalogue } = setup({ lit: true });
    // Neither the map nor the notes ticked on it are listed: a refused share offers nothing of what it carries
    expect((await catalogue.list(ben)).map((item) => item.kind)).toEqual([]);
    expect(await catalogue.open(ben, map.item)).toBeNull();
    expect(await catalogue.open(ben, `${map.item}/${payload.images[0]}`)).toBeNull();
    const full = setup({ lit: true, mode: 'full' });
    expect((await full.catalogue.list(ben)).find((item) => item.kind === 'map')).toMatchObject({ mode: 'full' });
    expect((await full.catalogue.list(ben)).map((item) => item.kind)).toContain('note');
  });
});
