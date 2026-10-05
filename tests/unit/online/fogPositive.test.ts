import { describe, expect, it } from 'vitest';
import type { Character, DrawingStroke, FogOperation, SceneSnapshot, TextElement } from '@atlas-vtt/api-types';
import { pinSize } from '@atlas-vtt/shared/draw';
import { drawingBounds, textBounds, tokenBounds } from '../../../src/app/online/scene/objectBounds';
import type { ProjectionContext } from '../../../src/app/online/scene/projectForPlayers';
import { playerSafePayload, type PayloadContext } from '../../../src/app/online/sharing/model/buildMapPayload';
import { axialToPixel, createHexLayout, pixelToAxial } from '@atlas-vtt/shared/grid';
import { coverageOfFog, fakeAssetIds, projectForPlayers, snapshotOf } from './sceneFixtures';
import { mapFile, sourceOf } from './sharing/mapFileFixture';

// Ruling F-POS (refined): on a fogged scene a text, drawing or pin reaches players only if every fog cell its in-map
// bounds touch is proven revealed, a token if any is (the player window draws a token whose part shows). The partial
// cell at a map edge that is not a multiple of 8 counts as fogged unless revealed, space outside the map counts as
// fogged, and a fogged map of unknown size sends nothing.

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

function sharedPins(
  fog: Record<string, FogOperation>, at: ReadonlyArray<readonly [number, number]>, size = MAP, options: { hex?: boolean; grid?: unknown } = {},
): number[][] {
  const pins = Object.fromEntries(at.map(([x, y]) => [`${x}_${y}`, { id: `${x}_${y}`, kind: 'pin', x, y, notePath: 'Notes/Inn.md', ...(options.hex ? { hex: true } : {}) }]));
  const context: PayloadContext = {
    rules: RULES, collectionGrid: null, coneAngle: 90, initiativeRules: { mode: 'turn-order', roll: '1d20', firstSide: 'players' },
    images: { fingerprints: new Map(), size }, noteItem: () => 'n'.repeat(22), linked: ['n'.repeat(22)], isFile: () => false,
  };
  return playerSafePayload(sourceOf(mapFile({ grid: options.grid ?? null, objects: { fog, pins } as never })), 'Inn', context)!.pins.map((pin) => [pin.x, pin.y]);
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

  it('sends a half-revealed token, but not a half-revealed text, drawing or pin', () => {
    const fog = fogOf(rect(0, 0, 700, 700), rect(400, 200, 300, 300, true));
    // 400 lies on a cell edge: the cell left of it is fogged, the one right of it revealed.
    expect(project(fog, [[400, 350]])).toEqual({ tokens: ['400_350'], texts: [], drawings: [] });
    expect(sharedPins(fog, [[400, 350]])).toEqual([]);
  });

  it('hides a token whose drawn footprint is wholly fogged, though its raw footprint reaches a revealed cell', () => {
    // 30,000 px map, fogged but for its top-left corner. A size-1000 token at the centre covers the corner as the GM
    // holds it (70,000 px wide), but players draw it as size 100 (7,000 px), wholly under fog.
    const big = { width: 30_000, height: 30_000 };
    const fog = fogOf(rect(0, 0, 30_000, 30_000), rect(0, 0, 1_000, 1_000, true));
    const scene = (tokenSize: number, gridSize: number, at = 15_000): SceneSnapshot => {
      const base = snapshotOf({ mapSize: big, grid: { enabled: true, size: gridSize, type: 'square', offsetX: 0, offsetY: 0 } as never });
      return { ...base, objects: { ...base.objects, fog, tokens: { huge: token('huge', at, at, tokenSize) } } };
    };
    const sent = (snapshot: SceneSnapshot) => projectForPlayers(snapshot, { sceneId: 's', rules: RULES, coverage: coverageOfFog(fog), assets: fakeAssetIds(), mapSize: big }).tokens;
    expect(sent(scene(1_000, 70))).toEqual({});
    // The same for a cell players draw smaller: a 24,000 px grid is sent as 10,000.
    expect(sent(scene(1, 24_000, 12_500))).toEqual({});
    // Its raw footprint does reach the revealed corner: only the drawn one hides it.
    expect(coverageOfFog(fog).revealsSome(tokenBounds({ x: 15_000, y: 15_000, size: 1_000 }, 70), big)).toBe(true);
    expect(coverageOfFog(fog).revealsSome(tokenBounds({ x: 12_500, y: 12_500, size: 1 }, 24_000), big)).toBe(true);
    // A token whose drawn footprint reaches the corner is sent.
    expect(Object.keys(sent({ ...scene(1, 70), objects: { ...scene(1, 70).objects, tokens: { near: token('near', 500, 500, 1) } } }))).toEqual(['near']);
  });

  it('hides a token only in the edge strip, and one straddling the map edge and the strip', () => {
    const fog = fogOf(rect(0, 0, 700, 700), rect(400, 200, 300, 300, true));
    // Revealed up to 696; 696–704 is the partial edge cell, still fogged, and past 700 is off the map.
    expect(project(fog, [[698, 350], [700, 350], [700.4, 350]]).tokens).toEqual([]);
    expect(project(fog, [[695, 350]]).tokens).toEqual(['695_350']);
  });

  it('checks a hex-linked pin over the hex Atlas highlights for it: its point revealed, its hex fogged, it is hidden', () => {
    const grid = { enabled: true, type: 'hex-vertical', size: 70, offsetX: 0, offsetY: 0 };
    const layout = createHexLayout('hex-vertical', 70, 0, 0);
    const point = { x: 340, y: 340 };
    const centre = axialToPixel(layout, pixelToAxial(layout, point));
    // Erased: whole cells around the point's badge, but not the whole hex.
    const fog = fogOf(rect(0, 0, 700, 700), rect(296, 296, 88, 88, true));
    expect(Math.hypot(centre.x - point.x, centre.y - point.y)).toBeGreaterThan(0);
    expect(sharedPins(fog, [[point.x, point.y]], MAP, { hex: true, grid })).toEqual([]);
    // The same pin not linked to its hex is its badge alone, which is revealed.
    expect(sharedPins(fog, [[point.x, point.y]], MAP, { grid })).toEqual([[340, 340]]);
    // Its whole hex revealed (with the badge at the hex's centre), the linked pin is sent.
    const open = fogOf(rect(0, 0, 700, 700), rect(Math.floor((centre.x - 80) / 8) * 8, Math.floor((centre.y - 80) / 8) * 8, 168, 168, true));
    expect(sharedPins(open, [[point.x, point.y]], MAP, { hex: true, grid })).toEqual([[340, 340]]);
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
  it('every pixel of a sent text, drawing and pin in the map is unfogged, and some pixel of a sent token, on maps not 8-aligned', () => {
    const random = seeded(2026);
    const sentUnderFog = { token: 0, text: 0, drawing: 0, pin: 0 };
    let hidden = 0;
    for (let run = 0; run < 120; run++) {
      const width = 40 + 8 * Math.floor(random() * 25) + (random() < 0.9 ? 1 + Math.floor(random() * 7) : 0);
      const height = 40 + 8 * Math.floor(random() * 25) + 1 + Math.floor(random() * 7);
      const map = { width, height };
      const ops = [randomOp(random, width, height, false), ...Array.from({ length: Math.floor(random() * 5) }, () => randomOp(random, width, height, random() < 0.5))];
      const fog = fogOf(...ops);
      const coverage = coverageOfFog(fog);
      const truth = truthMask(width, height, ops);
      const at = Array.from({ length: 25 }, (): [number, number] => [random() * (width + 20) - 10, random() * (height + 20) - 10]);
      // Half the items are tiny, half 10–80 px across.
      const large = (): boolean => random() < 0.5;
      const base = snapshotOf({ mapSize: map, grid: { enabled: true, size: 1, type: 'square', offsetX: 0, offsetY: 0 } as never });
      const snapshot: SceneSnapshot = {
        ...base,
        objects: {
          ...base.objects, fog,
          tokens: Object.fromEntries(at.map(([x, y], i) => [`t${i}`, token(`t${i}`, x, y, large() ? 10 + random() * 70 : 0.01)])),
          texts: Object.fromEntries(at.map(([x, y], i) => [`x${i}`, { ...text(`x${i}`, x, y), fontSize: large() ? 6 + random() * 24 : 1, text: 'x'.repeat(1 + Math.floor(random() * 4)) }])),
          drawings: Object.fromEntries(at.map(([x, y], i) => [`d${i}`, {
            ...drawing(`d${i}`, x, y), width: large() ? 1 + random() * 8 : 0.5,
            points: Array.from({ length: 1 + Math.floor(random() * 3) }, () => ({ x: x + (random() - 0.5) * 60, y: y + (random() - 0.5) * 60 })),
          }])),
        },
      };
      const scene = projectForPlayers(snapshot, { sceneId: 's', rules: RULES, coverage, assets: fakeAssetIds(), mapSize: map });
      const inMap = (box: { x: number; y: number; width: number; height: number }): number[] => {
        const x0 = Math.max(0, Math.floor(box.x));
        const y0 = Math.max(0, Math.floor(box.y));
        const x1 = Math.min(width, Math.max(x0 + 1, Math.ceil(box.x + box.width)));
        const y1 = Math.min(height, Math.max(y0 + 1, Math.ceil(box.y + box.height)));
        // A pixel only partly under the box counts whole: the truth is checked on every pixel the box touches.
        const pixels: number[] = [];
        for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) pixels.push(py * width + px);
        // Without fog nothing is hidden, also off the map; with fog only what lies on the map can be sent.
        if (coverage.hasFog) expect(x0 < width && y0 < height && box.x + box.width > 0 && box.y + box.height > 0, 'sent off the map').toBe(true);
        return pixels;
      };
      const every = (kind: keyof typeof sentUnderFog, id: string, box: { x: number; y: number; width: number; height: number }): void => {
        expect(inMap(box).filter((pixel) => truth[pixel] !== 0), `${kind} ${id}`).toEqual([]);
        if (coverage.hasFog) sentUnderFog[kind]++;
      };
      for (const [id, sentToken] of Object.entries(scene.tokens)) {
        const pixels = inMap(tokenBounds({ x: sentToken.x, y: sentToken.y, size: sentToken.size }, 1));
        if (pixels.length > 0 || coverage.hasFog) expect(pixels.some((pixel) => truth[pixel] === 0), `token ${id}`).toBe(true);
        if (coverage.hasFog) sentUnderFog.token++;
      }
      for (const [id, sentText] of Object.entries(scene.texts)) every('text', id, textBounds(sentText as unknown as TextElement));
      for (const [id, sentDrawing] of Object.entries(scene.drawings)) every('drawing', id, drawingBounds(sentDrawing));
      const pins = sharedPins(fog, at, map);
      for (const [x, y] of pins) every('pin', `${x},${y}`, { x: x! - pinSize.badgeRadius, y: y! - pinSize.badgeRadius, width: 2 * pinSize.badgeRadius, height: 2 * pinSize.badgeRadius });
      hidden += 4 * at.length - Object.keys(scene.tokens).length - Object.keys(scene.texts).length - Object.keys(scene.drawings).length - pins.length;
    }
    for (const kind of ['token', 'text', 'drawing', 'pin'] as const) expect(sentUnderFog[kind], kind).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
  }, 60_000);
});
