import { describe, expect, it } from 'vitest';
import type { SavedMapInput, ScenesApi } from '@atlas-vtt/api-types';
import { fullPayload, playerSafePayload, readSharedMap, type PayloadContext, type SharedMapSource } from '../../../../src/app/online/sharing/model/buildMapPayload';
import { accessFor, type AccessSources, type NoteSource } from '../../../../src/app/online/sharing/model/catalogueAccess';
import { offeredNotes } from '../../../../src/app/online/sharing/model/linkedNotes';
import type { MapShare } from '../../../../src/app/online/sharing/model/mapShare';
import { parseShareRule } from '../../../../src/app/online/sharing/model/shareRule';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';

// Sharing a map read through Atlas 1.13.0's fuller `scenes.readMap`: the fork's payloads, failing closed on what
// Atlas hands out as saved, and an older Atlas's maps exactly as before.

const MAP = 'maps/inn.atlasmap';
const BASE: SavedMapInput = {
  background: 'maps/inn.png', grid: null,
  objects: {
    tokens: { hero: { id: 'hero', kind: 'character', x: 70, y: 70, imagePath: 'art/hero.png', name: 'Hero' } as never },
    texts: {}, drawings: {}, fog: {},
  },
  widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
  initiative: { entries: [{ id: 'e', tokenId: 'hero', name: 'Hero', initiative: 12 } as never], currentIndex: 0, round: 1, isActive: true, config: { autoSort: true } },
};
const PINS = {
  inn: { id: 'inn', kind: 'pin', x: 10, y: 10, notePath: 'Notes/Inn.md' },
  plot: { id: 'plot', kind: 'pin', x: 20, y: 20, notePath: 'Notes/Plot.md', gmOnly: true },
  // Saved by hand or by an older build: Atlas hands these out as saved.
  sneaky: { id: 'sneaky', kind: 'pin', x: 30, y: 30, notePath: 'Notes/Sneaky.md', gmOnly: 'true' },
  broken: { id: 'broken', kind: 'pin', x: 'far', y: 30, notePath: 'Notes/Broken.md' },
  noNote: { id: 'noNote', kind: 'pin', x: 1, y: 1 },
};

function scenesWith(saved: Record<string, unknown>, mapPath = MAP): Pick<ScenesApi, 'readMap'> {
  const atlas = new FakeAtlas({ capabilities: ['scenes'] });
  atlas.scenes.setMap(mapPath, BASE, { saved });
  return atlas.connect(connectingPlugin('atlas-vtt-connect')).scenes;
}

const ticked = (paths: string[]): PayloadContext => ({
  rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
  collectionGrid: null, coneAngle: 90, initiativeRules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' },
  images: { fingerprints: new Map([['maps/inn.png', 'M'.repeat(43)], ['art/hero.png', 'H'.repeat(43)]]), size: { width: 700, height: 700 } },
  noteItem: (path) => (paths.includes(path) ? `item-${path.length}`.padEnd(22, 'x') : null),
  linked: paths.map((path) => `item-${path.length}`.padEnd(22, 'x')),
  isFile: (path) => /\.(md|png)$/.test(path),
});
const ALL = ['Notes/Inn.md', 'Notes/Plot.md', 'Notes/Sneaky.md', 'Notes/Broken.md'];

const SAVED = {
  objects: { pins: PINS, walls: { w: { id: 'w', kind: 'wall' } }, lights: { l: { id: 'l', kind: 'light' } }, lightZones: { z: { id: 'z', kind: 'light-zone' } } },
  camera: { x: 5, y: 6, scale: 2 }, initiativeTrackerOpen: true, tokenSettings: { showNameplates: true }, dmNotePath: 'GM/Prep.md',
  lighting: { enabled: false, ambient: 1 },
};

describe('a map read through Atlas 1.13.0', () => {
  it('shared full, carries the fork\'s fields: pins with ticked notes as references, walls, lights, light zones, camera, token settings, the tracker; never the GM\'s note', async () => {
    const source = (await readSharedMap(scenesWith(SAVED), MAP))!;
    const payload = fullPayload(source, 'Inn', ticked(['Notes/Inn.md']));
    const objects = payload.map.objects as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(objects.pins!)).toEqual(['inn', 'plot', 'sneaky']);
    expect(objects.pins!.inn!.notePath).toBe(`atlas-share-note:${'item-12'.padEnd(22, 'x')}`);
    expect(objects.pins!.plot!.notePath).toBe('');
    expect(objects.pins!.sneaky).toMatchObject({ gmOnly: true, notePath: '' });
    expect(objects.walls).toEqual({ w: { id: 'w', kind: 'wall' } });
    expect(objects.lights).toEqual({ l: { id: 'l', kind: 'light' } });
    expect(objects.lightZones).toEqual({ z: { id: 'z', kind: 'light-zone' } });
    expect(payload.map).toMatchObject({ camera: { x: 5, y: 6, scale: 2 }, initiativeTrackerOpen: true, tokenSettings: { showNameplates: true } });
    expect(payload.map).not.toHaveProperty('lighting');
    expect(JSON.stringify(payload)).not.toContain('GM/Prep.md');
  });

  it('shared player-safe, sends only the pins players see whose note is ticked, never walls, lights or the camera, and the initiative list while the tracker is open', async () => {
    const open = (await readSharedMap(scenesWith(SAVED), MAP))!;
    const payload = playerSafePayload(open, 'Inn', ticked(ALL))!;
    expect(payload.pins.map((pin) => pin.x)).toEqual([10]);
    expect(JSON.stringify(payload)).not.toMatch(/wall|light-zone|"light"|camera/);
    expect(payload.scene.initiative).not.toBeNull();
    const closed = (await readSharedMap(scenesWith({ ...SAVED, initiativeTrackerOpen: false }), MAP))!;
    expect(playerSafePayload(closed, 'Inn', ticked(ALL))!.scene.initiative).toBeNull();
  });

  it('fails closed on pins as saved: a malformed pin is dropped, and a gmOnly set to anything but false keeps its note from player-safe shares', async () => {
    const source = (await readSharedMap(scenesWith(SAVED), MAP))!;
    expect(Object.keys(source.map.objects.pins)).toEqual(['inn', 'plot', 'sneaky']);
    expect(offeredNotes(source.map, 'player-safe').map((note) => note.path)).toEqual(['Notes/Inn.md']);
    expect(offeredNotes(source.map, 'full').map((note) => note.path)).toEqual(['Notes/Inn.md', 'Notes/Plot.md', 'Notes/Sneaky.md']);
  });

  it('offers again a note linked only through a pin, with the same audience checks: never behind a GM-only pin player-safe, never a private note, only to whom the map reaches', async () => {
    const source = (await readSharedMap(scenesWith(SAVED), MAP))!;
    const notes: NoteSource[] = ALL.map((path) => ({ path, title: path, rule: parseShareRule(path === 'Notes/Inn.md' ? [] : ['private']) }));
    notes.push({ path: 'Notes/Plot.md', title: 'Plot', rule: parseShareRule([]) });
    const share = (mode: MapShare['mode'], except: string[] = []): MapShare => ({ item: 'm'.repeat(22), everyone: true, people: [], except, mode, notes: ALL });
    const sources = (entry: MapShare): AccessSources => ({
      notes: () => [], note: (path) => notes.filter((note) => note.path === path).pop() ?? null,
      maps: async () => [{ name: 'Inn', mapPath: MAP, share: entry }], readMap: async () => source,
    });
    const people = { byName: () => null, byKey: () => null, isPlaceholder: () => false };
    const ana = { tableId: 't', personId: 'ana' };
    expect((await accessFor(sources(share('player-safe')), ana, people)).maps[0]!.linked).toEqual(['Notes/Inn.md']);
    expect((await accessFor(sources(share('full')), ana, people)).maps[0]!.linked).toEqual(['Notes/Inn.md', 'Notes/Plot.md']);
    // An except naming someone Atlas does not know hides the map from everyone, its notes with it.
    expect((await accessFor(sources(share('full', ['t:nobody'])), ana, { ...people, unlinkedKey: () => true })).maps).toEqual([]);
  });
});

describe('a map read through an Atlas before 1.13.0', () => {
  it('makes the same payloads as before: no pins, walls or camera, the tracker closed', async () => {
    const atlas = new FakeAtlas({ capabilities: ['scenes'], scenesBefore113: true });
    atlas.scenes.setMap(MAP, BASE, { saved: SAVED });
    const source = (await readSharedMap(atlas.connect(connectingPlugin('atlas-vtt-connect')).scenes, MAP))!;
    // The source as Connect built it before 1.13.0, from the saved map itself: widgets and initiative over Atlas's defaults.
    const widgets = { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} } as SavedMapInput['widgets'];
    const before: SharedMapSource = {
      map: { background: BASE.background, grid: BASE.grid, objects: { tokens: BASE.objects.tokens as never, texts: {}, drawings: {}, fog: {}, pins: {} } },
      state: {
        background: BASE.background, grid: BASE.grid, objects: BASE.objects, widgets, initiative: BASE.initiative,
        initiativeTrackerOpen: false, mapPath: null, lighting: { enabled: false, ambient: 1 },
      },
      extra: { widgetSettings: widgets.settings, widgetValues: widgets.values, initiative: BASE.initiative },
      lit: false,
    };
    expect(JSON.stringify(fullPayload(source, 'Inn', ticked(ALL)))).toBe(JSON.stringify(fullPayload(before, 'Inn', ticked(ALL))));
    expect(JSON.stringify(playerSafePayload(source, 'Inn', ticked(ALL)))).toBe(JSON.stringify(playerSafePayload(before, 'Inn', ticked(ALL))));
    expect(playerSafePayload(source, 'Inn', ticked(ALL))!.pins).toEqual([]);
    expect(source.state.initiativeTrackerOpen).toBe(false);
  });
});
