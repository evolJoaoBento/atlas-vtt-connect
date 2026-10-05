/**
 * A player-safe share is projected with the same rules as live play: the cone angle the measure tool
 * opens on the map, and the initiative grouping of the map's collection, both as Atlas gives them for the
 * map (`rules.forMap`). The sources are the real ones (`obsidianCatalogueSources`), over a fake Atlas.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { obsidianCatalogueSources } from '../../../../src/app/online/sharing/model/catalogueSources';
import { SenderCatalogue, type CatalogueSources } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import { parseMapPayload } from '../../../../src/app/online/sharing/model/mapPayload';
import { SectionTrust } from '../../../../src/app/online/sharing/model/sectionTrust';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';
import type { FakeCollection } from '../../../fake/fakeRules';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { memoryImageFiles, nodeHash } from '../assetFixtures';
import { mapFile } from './mapFileFixture';

afterEach(() => { vi.restoreAllMocks(); });

const T = 'T'.repeat(43);
const ben = { tableId: T, personId: 'ben' };
const person = { tableId: T, personId: 'ben', name: 'Ben', formerNames: [], devices: [], aliases: [], lastSeen: 0 };
const people = { byName: () => person, byKey: () => person, ready: async (): Promise<void> => {} };
const items = {
  idFor: (path: string): string => path.padEnd(22, '0').slice(0, 22),
  pathOf: (): string | null => null,
  ready: async (): Promise<void> => {},
};
const noEvents = { onModify: () => {}, onParsed: () => {}, onRename: () => {}, onDelete: () => {} };

/** The rules Atlas gives for the map: those of its collection `c`. */
let collection: Omit<FakeCollection, 'maps'> = {};

/** The catalogue over real catalogue sources for rules, and a saved map with two combatants. */
function openedShare(running: boolean): Promise<ReturnType<typeof parseMapPayload>> {
  const { app } = createInMemoryApp();
  const atlas = new FakeAtlas({ capabilities: ['scenes', 'rules'] });
  atlas.rules.saveCollection('c', { maps: ['m.atlasmap'], ...collection });
  const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  const real = obsidianCatalogueSources(app as unknown as App, {
    scenes: extension.scenes, rules: extension.rules, shareableProperties: () => [],
    playerView: () => ({ showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true }),
  }, new SectionTrust(noEvents));
  const map = mapFile({
    background: 'maps/inn.png',
    objects: { tokens: {
      hero: { id: 'hero', kind: 'character', x: 70, y: 70, imagePath: 'art/hero.png', name: 'Hero', side: 'players' },
      orc: { id: 'orc', kind: 'character', x: 140, y: 70, imagePath: 'art/orc.png', name: 'Orc' },
    } },
  });
  const initiative = {
    entries: [
      { id: 'e1', tokenId: 'hero', name: 'Hero', initiative: 17, initiativeModifier: 0, imagePath: '', isActive: true, isNPC: false, order: 0 },
      { id: 'e2', tokenId: 'orc', name: 'Orc', initiative: 23, initiativeModifier: 0, imagePath: '', isActive: false, isNPC: true, order: 1 },
    ],
    currentIndex: 0, round: 1, isActive: running, config: { autoSort: true },
    ...(running ? { sides: { first: 'players', active: 'players' } } : {}),
  };
  const sources: CatalogueSources = {
    ...real,
    notes: () => [],
    readNote: async () => ({ text: '', sections: [] }),
    maps: async () => [{ name: 'Inn', mapPath: 'm.atlasmap', share: { item: 'm'.repeat(22), everyone: false, people: [`${T}/ben`], except: [], mode: 'player-safe', notes: [] } }],
    readMap: async () => ({
      map, extra: {}, lit: false,
      state: {
        background: map.background, grid: map.grid, objects: map.objects, mapPath: null, lighting: { enabled: false, ambient: 1 },
        widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} }, initiative: initiative as never, initiativeTrackerOpen: true,
      },
    }),
    images: memoryImageFiles({ 'maps/inn.png': 'png-bytes', 'art/hero.png': 'a', 'art/orc.png': 'b' }).source,
    isFile: () => false,
    rules: () => ({ showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true }),
    collectionGrid: () => null,
  };
  const catalogue = new SenderCatalogue(sources, items, people as never, nodeHash, async () => ({ width: 100, height: 100 }));
  return catalogue.list(ben).then(async (list) => {
    const mapItem = list.find((item) => item.kind === 'map');
    const opened = mapItem ? await catalogue.open(ben, mapItem.item) : null;
    return opened ? parseMapPayload(JSON.parse(new TextDecoder().decode(opened.bytes))) : null;
  });
}

describe('a player-safe share follows the rules of live play', () => {
  it("opens cones by the game system's angle, as the live scene does: D&D 5e without grid defaults gives 53.13", async () => {
    collection = { systemConeAngle: 53.13 };
    const payload = await openedShare(false);
    expect(payload?.mode).toBe('player-safe');
    expect(payload?.mode === 'player-safe' && payload.scene.measurement.coneAngle).toBe(53.13);
  });

  it('keeps a stored angle, and falls back to a quarter circle for one no cone can open with', async () => {
    collection = { gridDefaults: { unitType: 'feet', unitDistance: 5, measurementMode: 'metric', coneAngle: 60 } };
    expect((await openedShare(false) as { scene: { measurement: { coneAngle: number } } }).scene.measurement.coneAngle).toBe(60);
    collection = { gridDefaults: { unitType: 'feet', unitDistance: 5, measurementMode: 'metric', coneAngle: 500 } };
    expect((await openedShare(false) as { scene: { measurement: { coneAngle: number } } }).scene.measurement.coneAngle).toBe(90);
  });

  it('lists a by-sides collection by sides before a fight, with no initiative numbers in the share', async () => {
    collection = { initiative: { mode: 'sides', roll: '1d20', firstSide: 'players' } };
    const payload = await openedShare(false) as { scene: { initiative: { sides?: unknown; entries: Array<{ initiative: number }> } } };
    expect(payload.scene.initiative.sides).toEqual({ first: 'players' });
    expect(payload.scene.initiative.entries.map((entry) => entry.initiative)).toEqual([0, 0]);
    expect(JSON.stringify(payload)).not.toMatch(/"initiative":(17|23)\b/);
  });

  it('lists a turn-order collection with its numbers', async () => {
    collection = { systemConeAngle: 53.13 };
    const payload = await openedShare(false) as { scene: { initiative: { sides?: unknown; entries: Array<{ initiative: number }> } } };
    expect(payload.scene.initiative.sides).toBeUndefined();
    expect(payload.scene.initiative.entries.map((entry) => entry.initiative)).toEqual([17, 23]);
  });
});
