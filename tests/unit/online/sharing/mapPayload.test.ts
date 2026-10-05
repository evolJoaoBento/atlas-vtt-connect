import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fullPayload, playerSafePayload, readSharedMap, type PayloadContext, type SharedMapSource } from '../../../../src/app/online/sharing/model/buildMapPayload';
import { IMAGE_REF_PREFIX, NOTE_REF_PREFIX, parseMapPayload } from '../../../../src/app/online/sharing/model/mapPayload';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';
import { mapFile, sourceOf } from './mapFileFixture';

const state = {
  background: 'maps/inn.png',
  grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 },
  objects: {
    tokens: {
      hero: { id: 'hero', kind: 'character', x: 70, y: 70, imagePath: 'art/hero.png', name: 'Hero', notePath: 'Notes/Hero.md' },
      spy: { id: 'spy', kind: 'character', x: 140, y: 70, imagePath: 'art/spy.png', isHidden: true, notePath: 'Notes/Spy.md' },
    },
    pins: {
      inn: { id: 'inn', kind: 'pin', x: 10, y: 10, notePath: 'Notes/Inn.md' },
      plot: { id: 'plot', kind: 'pin', x: 20, y: 20, notePath: 'Notes/Plot.md', gmOnly: true },
    },
    walls: { w: { id: 'w' } },
  },
  dmNotePath: 'GM/Prep.md',
};

function source(): SharedMapSource {
  return sourceOf(mapFile(state), { dmNotePath: 'GM/Prep.md' });
}

/** The map saved at `m.atlasmap` with `lighting`, as Atlas reads it (`scenes.readMap`). */
function savedWith(lighting: { enabled: boolean; ambient: number }): Promise<SharedMapSource | null> {
  const atlas = new FakeAtlas({ capabilities: ['scenes'] });
  const { tokens } = state.objects;
  atlas.scenes.setMap('m.atlasmap', {
    background: state.background, grid: state.grid as never, objects: { tokens: tokens as never, texts: {}, drawings: {}, fog: {} },
    widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
    initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } }, lighting,
  }, { saved: { pins: state.objects.pins, walls: state.objects.walls, dmNotePath: state.dmNotePath } });
  return readSharedMap(atlas.connect(connectingPlugin('atlas-vtt-connect')).scenes, 'm.atlasmap');
}

const context = (ticked: string[]): PayloadContext => ({
  rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true },
  collectionGrid: null,
  coneAngle: 90,
  initiativeRules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' },
  images: { fingerprints: new Map([['maps/inn.png', 'M'.repeat(43)], ['art/hero.png', 'H'.repeat(43)], ['art/spy.png', 'S'.repeat(43)]]), size: { width: 700, height: 700 } },
  noteItem: (path) => (ticked.includes(path) ? `item-${path.length}`.padEnd(22, 'x') : null),
  linked: ticked.map((path) => `item-${path.length}`.padEnd(22, 'x')),
  isFile: (path) => /\.(md|png)$/.test(path),
});

describe('map payloads', () => {
  it('player-safe: what players see, pins that are not GM-only, notes only when ticked', () => {
    const payload = playerSafePayload(source(), 'Inn', context(['Notes/Inn.md', 'Notes/Plot.md', 'Notes/Hero.md']))!;
    expect(Object.keys(payload.scene.tokens)).toEqual(['hero']);
    expect(payload.scene.map.asset).toBe('M'.repeat(43));
    expect(payload.pins.map((pin) => pin.x)).toEqual([10]);
    expect(Object.keys(payload.tokenNotes)).toEqual(['hero']);
    expect(payload.images.sort()).toEqual(['H'.repeat(43), 'M'.repeat(43)]);
    expect(JSON.stringify(payload)).not.toMatch(/Notes\/|art\/|maps\/|GM\//);
    expect(parseMapPayload(JSON.parse(JSON.stringify(payload)))).toEqual(payload);
  });

  it('player-safe: a pin whose note is not ticked is left out (N-4)', () => {
    expect(playerSafePayload(source(), 'Inn', context([]))?.pins).toEqual([]);
  });

  it('refuses a player-safe payload of a map saved with dynamic lighting on, whatever this device’s toggle', async () => {
    const lit = await savedWith({ enabled: true, ambient: 0 });
    expect(lit?.lit).toBe(true);
    expect(playerSafePayload(lit!, 'Inn', context([]))).toBeNull();
    expect(fullPayload(lit!, 'Inn', context([])).mode).toBe('full');
    const unlit = await savedWith({ enabled: false, ambient: 0 });
    expect(unlit?.lit).toBe(false);
    expect(playerSafePayload(unlit!, 'Inn', context([]))?.mode).toBe('player-safe');
  });

  it('full: everything, with images and ticked notes as references and every other path cleared', () => {
    const payload = fullPayload(source(), 'Inn', context(['Notes/Inn.md']));
    const text = JSON.stringify(payload);
    expect(text).toContain(`${IMAGE_REF_PREFIX}${'S'.repeat(43)}`);
    expect(text).toContain(NOTE_REF_PREFIX);
    expect(text).not.toMatch(/Notes\/|art\/|maps\/|GM\//);
    expect(payload.map).toMatchObject({ objects: { walls: { w: { id: 'w' } } } });
    expect(parseMapPayload(JSON.parse(text))).toEqual(payload);
  });

  it('full: clears paths by key, whether or not the file exists (I4)', () => {
    const stale = mapFile({
      background: 'maps/gone.png',
      objects: {
        tokens: { t: { id: 't', kind: 'character', x: 0, y: 0, imagePath: 'art/missing.png', statblockPath: 'GM/Twist reveal.md', notePath: 'GM/Renamed away.md' } },
        pins: { p: { id: 'p', kind: 'pin', x: 1, y: 1, notePath: 'GM/Folder' } },
        audios: { a: { id: 'a', kind: 'audio', x: 0, y: 0, path: 'sounds/lost.ogg' } },
      },
    });
    const none = { ...source(), map: stale, extra: { dmNotePath: 'GM/Prep', mapPath: 'atlas-vtt/collections/c/Inn.atlasmap' } };
    const text = JSON.stringify(fullPayload(none, 'Inn', { ...context([]), images: { fingerprints: new Map(), size: { width: 0, height: 0 } }, isFile: () => false }));
    expect(text).not.toMatch(/GM\/|art\/|maps\/|sounds\/|atlas-vtt\//);
  });

  it('clears plural *Paths keys and values nested under a path key (R2-4)', () => {
    const map = mapFile({ background: 'maps/inn.png', objects: { tokens: {}, pins: {} } });
    const extra = { notePaths: ['Secret/a.md', 'Secret/b.md'], imagePath: { src: 'Secret/c.png', deeper: [{ url: 'Secret/d.png' }] }, other: { paths: { x: 'Secret/e.md' } } };
    const text = JSON.stringify(fullPayload({ ...source(), map, extra }, 'Inn', { ...context([]), isFile: () => false }));
    expect(text).not.toContain('Secret/');
  });

  it('every *Path field of the map types is covered by that test (a new one must be added)', () => {
    // The map's record types: Atlas's (the vendored API types) and the note pin sharing reads (`sharedMapFile.ts`).
    const api = readFileSync(resolve(__dirname, '../../../../vendor/atlas/api-types/atlas-vtt-api.d.ts'), 'utf8');
    const records = ['BaseToken', 'Character', 'Token', 'TextElement', 'DrawingStroke', 'FogBrushStroke', 'FogLassoFill', 'FogRectangleFill']
      .map((name) => api.match(new RegExp(`export declare interface ${name}\\b[^{]*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? `missing ${name}`);
    const pin = readFileSync(resolve(__dirname, '../../../../src/app/online/sharing/model/sharedMapFile.ts'), 'utf8');
    const types = [...records, pin].join('\n');
    expect(types).not.toContain('missing');
    const fields = [...new Set([...types.matchAll(/\b(\w*Path)\??:/g)].map((match) => match[1]))].sort();
    expect(fields).toEqual(['imagePath', 'notePath', 'statblockPath']);
    const token = { id: 't', kind: 'character', x: 0, y: 0 };
    const filled = mapFile({
      background: 'maps/inn.png',
      objects: { tokens: { t: { ...token, ...Object.fromEntries(fields.map((field) => [field, `Secret/${field}.md`])) } }, pins: { p: { id: 'p', kind: 'pin', x: 1, y: 1, notePath: 'Secret/pin.md' } } },
    });
    const text = JSON.stringify(fullPayload({ ...source(), map: filled }, 'Inn', { ...context([]), isFile: () => false }));
    expect(text).not.toContain('Secret/');
  });

  it('refuses payloads of the wrong shape', () => {
    expect(parseMapPayload({ format: 'other' })).toBeNull();
    expect(parseMapPayload({ format: 'atlas-share-map-v1', mode: 'player-safe', name: 'x', scene: {}, pins: [], tokenNotes: {}, notes: [], images: [] })).toBeNull();
    expect(parseMapPayload({ format: 'atlas-share-map-v1', mode: 'full', name: 'x', map: [], notes: [], images: [] })).toBeNull();
  });
});
