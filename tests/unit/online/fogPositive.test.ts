import { describe, expect, it } from 'vitest';
import type { Character, DrawingStroke, FogOperation, SceneSnapshot, TextElement } from '@atlas-vtt/api-types';
import { tokenBounds } from '../../../src/app/online/scene/objectBounds';
import type { ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { playerSafePayload, type PayloadContext } from '../../../src/app/online/sharing/model/buildMapPayload';
import { coverageOfFog, fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';
import { mapFile, sourceOf } from './sharing/mapFileFixture';

// Ruling F-POS: on a fogged scene an item reaches players only if every fog cell its in-map bounds touch is proven
// revealed. The partial cell at a map edge that is not a multiple of 8 counts as fogged unless revealed, and parts
// outside the map prove nothing.

const MAP = { width: 700, height: 700 };
const RULES = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };
let stamp = 1;
const rect = (x: number, y: number, width: number, height: number, isErasing = false): FogOperation =>
  ({ id: `f${stamp}`, kind: 'fog', type: 'rectangle', timestamp: stamp++, isErasing, x, y, width, height });
const fogOf = (...ops: FogOperation[]): Record<string, FogOperation> => Object.fromEntries(ops.map((op) => [op.id, op]));

const token = (id: string, x: number, y: number, size = 0.01): Character => ({ id, kind: 'character', x, y, size, imagePath: 'art/a.png', name: id });
const text = (id: string, x: number, y: number): TextElement => ({ id, kind: 'text', x, y, text: 'x', fontSize: 1, fontFamily: 'serif', color: '#000' } as TextElement);
const drawing = (id: string, x: number, y: number): DrawingStroke =>
  ({ id, kind: 'drawing', timestamp: 1, type: 'pen', points: [{ x, y }], color: '#f00', width: 0.5, opacity: 1 } as DrawingStroke);

/** The probe's edge cases and points off the map: 697–699 lie in the map's last, partial fog cell (696–704). */
const EDGE = [[697, 350], [699, 350], [350, 699], [699, 699], [-5, 350], [350, -5], [700, 350], [5000, 5000]] as const;
const CLEAR_AT = [600, 350] as const;

function sceneWith(fog: Record<string, FogOperation>, at: ReadonlyArray<readonly [number, number]>): SceneSnapshot {
  const base = snapshotOf({ mapSize: MAP, grid: { enabled: true, size: 1, type: 'square', offsetX: 0, offsetY: 0 } as never });
  const ids = at.map(([x, y]) => `${x}_${y}`);
  return {
    ...base,
    objects: {
      ...base.objects, fog,
      tokens: Object.fromEntries(at.map(([x, y], i) => [ids[i]!, token(ids[i]!, x, y)])),
      texts: Object.fromEntries(at.map(([x, y], i) => [ids[i]!, text(ids[i]!, x, y)])),
      drawings: Object.fromEntries(at.map(([x, y], i) => [ids[i]!, drawing(ids[i]!, x, y)])),
    },
  };
}

function project(fog: Record<string, FogOperation>, at: ReadonlyArray<readonly [number, number]>, mapSize = MAP): { tokens: string[]; texts: string[]; drawings: string[] } {
  const context: ProjectionContext = { sceneId: 's', rules: RULES, coverage: coverageOfFog(fog), assets: fakeAssetIds(), mapSize };
  const scene = projectForPlayers({ ...sceneWith(fog, at) }, context);
  return { tokens: Object.keys(scene.tokens), texts: Object.keys(scene.texts), drawings: Object.keys(scene.drawings) };
}

function sharedPins(fog: Record<string, FogOperation>, at: ReadonlyArray<readonly [number, number]>, size = MAP): number[][] {
  const pins = Object.fromEntries(at.map(([x, y]) => [`${x}_${y}`, { id: `${x}_${y}`, kind: 'pin', x, y, notePath: 'Notes/Inn.md' }]));
  const context: PayloadContext = {
    rules: RULES, collectionGrid: null, coneAngle: 90, initiativeRules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' },
    images: { fingerprints: new Map(), size }, noteItem: () => 'n'.repeat(22), linked: ['n'.repeat(22)], isFile: () => false,
  };
  return playerSafePayload(sourceOf(mapFile({ objects: { fog, pins } as never })), 'Inn', context)!.pins.map((pin) => [pin.x, pin.y]);
}

describe('fog positive check (F-POS)', () => {
  it('on a 700 px map fogged exactly to its size, hides tokens, texts, drawings and pins in the last strip and off the map', () => {
    const fog = fogOf(rect(0, 0, 700, 700));
    expect(project(fog, EDGE)).toEqual({ tokens: [], texts: [], drawings: [] });
    expect(sharedPins(fog, EDGE)).toEqual([]);
  });

  it('erasing the fog shows what lies wholly in the erased cells, and nothing still touching fog', () => {
    const fog = fogOf(rect(0, 0, 700, 700), rect(400, 200, 300, 300, true));
    const shown = project(fog, [CLEAR_AT, [697, 350], [380, 350]]);
    expect(shown).toEqual({ tokens: ['600_350'], texts: ['600_350'], drawings: ['600_350'] });
    expect(sharedPins(fog, [CLEAR_AT, [697, 350], [380, 350]])).toEqual([[600, 350]]);
  });

  it('a fully revealed map sends everything on it', () => {
    const fog = fogOf(rect(0, 0, 700, 700), rect(-100, -100, 900, 900, true));
    const inside = [CLEAR_AT, [697, 350], [699, 699], [1, 1]] as const;
    const ids = inside.map(([x, y]) => `${x}_${y}`);
    expect(project(fog, inside)).toEqual({ tokens: ids, texts: ids, drawings: ids });
    expect(sharedPins(fog, inside)).toEqual(inside.map(([x, y]) => [x, y]));
  });

  it('fails closed on a fogged map whose size is unknown; a scene without fog hides nothing, as the player window', () => {
    const fog = fogOf(rect(0, 0, 100, 100));
    expect(project(fog, [CLEAR_AT], { width: 0, height: 0 })).toEqual({ tokens: [], texts: [], drawings: [] });
    expect(sharedPins(fog, [CLEAR_AT], { width: 0, height: 0 })).toEqual([]);
    const ids = ['600_350', '5000_5000'];
    expect(project({}, [CLEAR_AT, [5000, 5000]], { width: 0, height: 0 })).toEqual({ tokens: ids, texts: ids, drawings: ids });
  });
});

/** A seeded generator (mulberry32), so a failure replays. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = { x: number; y: number };
const distSqToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return (p.x - a.x - t * dx) ** 2 + (p.y - a.y - t * dy) ** 2;
};
function insidePolygon(p: Point, points: readonly Point[]): boolean {
  let winding = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
    if (a.y <= p.y && b.y > p.y && cross > 0) winding++;
    else if (a.y > p.y && b.y <= p.y && cross < 0) winding--;
  }
  return winding !== 0;
}

/**
 * Pixel truth, made strict: a pixel is fogged when paint touches any of its corners or its centre (a rectangle: any
 * overlap) and cleared only when erase holds all of them (a rectangle: covers it whole).
 */
function truthMask(width: number, height: number, ops: readonly FogOperation[]): Uint8Array {
  const mask = new Uint8Array(width * height);
  for (const op of [...ops].sort((a, b) => a.timestamp - b.timestamp)) {
    // Only the pixels near the operation can change.
    const reach = op.type === 'brush' ? op.brushRadius + 1 : 1;
    const xs = op.type === 'rectangle' ? [op.x, op.x + op.width] : op.points.map((p) => p.x);
    const ys = op.type === 'rectangle' ? [op.y, op.y + op.height] : op.points.map((p) => p.y);
    const [x0, x1] = [Math.max(0, Math.floor(Math.min(...xs) - reach)), Math.min(width, Math.ceil(Math.max(...xs) + reach))];
    const [y0, y1] = [Math.max(0, Math.floor(Math.min(...ys) - reach)), Math.min(height, Math.ceil(Math.max(...ys) + reach))];
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const probes = [{ x: px, y: py }, { x: px + 1, y: py }, { x: px, y: py + 1 }, { x: px + 1, y: py + 1 }, { x: px + 0.5, y: py + 0.5 }];
        let hit: (p: Point) => boolean;
        if (op.type === 'rectangle') {
          const overlaps = px + 1 > op.x && px < op.x + op.width && py + 1 > op.y && py < op.y + op.height;
          const covers = px >= op.x && px + 1 <= op.x + op.width && py >= op.y && py + 1 <= op.y + op.height;
          if (op.isErasing ? covers : overlaps) mask[py * width + px] = op.isErasing ? 0 : 1;
          continue;
        } else if (op.type === 'brush') {
          const segments = op.points.length === 1 ? [[op.points[0]!, op.points[0]!]] : op.points.slice(1).map((p, i) => [op.points[i]!, p]);
          hit = (p) => segments.some(([a, b]) => distSqToSegment(p, a!, b!) <= op.brushRadius ** 2);
        } else {
          hit = (p) => insidePolygon(p, op.points);
        }
        if (op.isErasing ? probes.every(hit) : probes.some(hit)) mask[py * width + px] = op.isErasing ? 0 : 1;
      }
    }
  }
  return mask;
}

function randomOp(random: () => number, width: number, height: number, isErasing: boolean): FogOperation {
  const at = (span: number): number => Math.round(random() * (span + 40) - 20);
  const kind = random();
  const base = { id: `f${stamp}`, kind: 'fog' as const, timestamp: stamp++, isErasing };
  if (kind < 0.5) return { ...base, type: 'rectangle', x: at(width) + random(), y: at(height) + random(), width: random() * width * 0.7, height: random() * height * 0.7 };
  if (kind < 0.8) {
    const points = Array.from({ length: 1 + Math.floor(random() * 4) }, () => ({ x: at(width), y: at(height) }));
    return { ...base, type: 'brush', points, brushRadius: 3 + random() * 40 };
  }
  return { ...base, type: 'lasso', points: Array.from({ length: 3 + Math.floor(random() * 5) }, () => ({ x: at(width), y: at(height) })) };
}

describe('fog positive check against pixel truth', () => {
  it('whatever is sent is unfogged in every pixel of its in-map part, on maps whose sides are not multiples of 8', () => {
    const random = seeded(2026);
    let sent = 0;
    let hidden = 0;
    for (let run = 0; run < 120; run++) {
      const width = 40 + 8 * Math.floor(random() * 25) + (random() < 0.9 ? 1 + Math.floor(random() * 7) : 0);
      const height = 40 + 8 * Math.floor(random() * 25) + 1 + Math.floor(random() * 7);
      const ops = [randomOp(random, width, height, false), ...Array.from({ length: Math.floor(random() * 5) }, () => randomOp(random, width, height, random() < 0.5))];
      const fog = fogOf(...ops);
      const coverage = coverageOfFog(fog);
      const truth = truthMask(width, height, ops);
      const at = Array.from({ length: 25 }, (): [number, number] => [random() * (width + 20) - 10, random() * (height + 20) - 10]);
      const scene = projectForPlayers({ ...sceneWith(fog, at) }, {
        sceneId: 's', rules: RULES, coverage, assets: fakeAssetIds(), mapSize: { width, height },
      });
      for (const [id, sentToken] of Object.entries(scene.tokens)) {
        const box = tokenBounds({ x: sentToken.x, y: sentToken.y, size: sentToken.size }, 1);
        const x0 = Math.max(0, Math.floor(box.x));
        const y0 = Math.max(0, Math.floor(box.y));
        const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil(box.x + box.width)));
        const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil(box.y + box.height)));
        // Without fog nothing is hidden, also off the map; with fog only what lies on the map can be sent.
        if (coverage.hasFog) expect(x0 < width && y0 < height && box.x + box.width > 0 && box.y + box.height > 0, `token ${id} sent off the map`).toBe(true);
        for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) expect(truth[py * width + px], `token ${id} pixel ${px},${py}`).toBe(0);
        sent++;
      }
      hidden += at.length - Object.keys(scene.tokens).length;
    }
    expect(sent).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
  }, 30_000);
});
