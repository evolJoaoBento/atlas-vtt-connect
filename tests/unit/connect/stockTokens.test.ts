import { describe, expect, it, vi } from 'vitest';
import { stockTokensApi, type TokenView } from '../../../src/connect/stockTokens/stockTokens';
import { movementWalls } from '../../../src/connect/stockTokens/ported/movementWalls';
import { reaches } from '../../../src/connect/stockTokens/ported/wallCollision';
import { wallList } from '../../../src/connect/stockTokens/ported/walls';
import real from '../../fake/realStockWalls.json';

const CLERIC = 'tok_1790796966430_ww5p67blm';
const ASSASSIN = 'tok_1790796938884_kznvfixqn';

interface Options {
  lit?: boolean;
  flag?: boolean | null;
  grid?: { snapToGrid?: boolean; size: number } | null;
  hidden?: string[];
  dragging?: boolean;
  noSnapper?: boolean;
  walls?: Record<string, unknown>;
}

/** A view whose scene is the real one (its walls, grid and tokens), with `dropTokens` writing as Atlas's store does. */
function setup(options: Options = {}) {
  const tokens: Record<string, { x: number; y: number; size?: number; isHidden?: boolean }> = structuredClone(real.tokens);
  for (const id of options.hidden ?? []) tokens[id]!.isHidden = true;
  const writes: Array<Array<{ id: string; x: number; y: number }>> = [];
  const state = {
    mapLoaded: true, isMapLoading: false, isDragging: options.dragging ?? false,
    grid: options.grid === undefined ? { ...real.grid } : options.grid,
    lighting: { enabled: options.lit ?? false },
    objects: { tokens, walls: options.walls ?? structuredClone(real.walls) },
    dropTokens: vi.fn((positions: Array<{ id: string; x: number; y: number }>) => {
      writes.push(positions);
      for (const { id, x, y } of positions) {
        tokens[id]!.x = x;
        tokens[id]!.y = y;
      }
    }),
  };
  // A cell centre snap like the GM's drag: cells of the grid's size from its offset.
  const cell = real.grid.size;
  const snapTokenCenter = (x: number, y: number): { x: number; y: number } => ({
    x: Math.round((x - real.grid.offsetX) / cell - 0.5) * cell + real.grid.offsetX + cell / 2,
    y: Math.round((y - real.grid.offsetY) / cell - 0.5) * cell + real.grid.offsetY + cell / 2,
  });
  const view = {
    viewId: 'v1',
    atlasStore: { getState: () => state },
    renderer: options.noSnapper ? {} : { gridSystem: { snapTokenCenter } },
  } as unknown as TokenView;
  let open = true;
  const api = stockTokensApi({
    view: (id) => (open && id === 'v1' ? view : null),
    mapSize: () => ({ width: real.map.width, height: real.map.height }),
    dynamicLighting: () => (options.flag === undefined ? true : options.flag),
  });
  return { api, state, tokens, writes, close: () => { open = false; } };
}

describe('tokens on a stock Atlas', () => {
  describe('snapPoint', () => {
    it('snaps a token to where the GM\'s drag puts it, and leaves a point alone without a grid, with snapping off, or for an unknown view', () => {
      const { api } = setup();
      const snapped = api.snapPoint('v1', { x: 133.3, y: 171.7 }, 1);
      expect(Object.isFrozen(snapped)).toBe(true);
      expect(snapped.x).not.toBe(133.3);
      expect(api.snapPoint('nope', { x: 1.5, y: 2.5 }, 1)).toEqual({ x: 1.5, y: 2.5 });
      expect(setup({ grid: null }).api.snapPoint('v1', { x: 1.5, y: 2.5 }, 1)).toEqual({ x: 1.5, y: 2.5 });
      expect(setup({ grid: { snapToGrid: false, size: 25 } }).api.snapPoint('v1', { x: 1.5, y: 2.5 }, 1)).toEqual({ x: 1.5, y: 2.5 });
      expect(setup({ noSnapper: true }).api.snapPoint('v1', { x: 1.5, y: 2.5 }, 1)).toEqual({ x: 1.5, y: 2.5 });
    });

    it('throws for a point or a size that is not numbers', () => {
      const { api } = setup();
      expect(() => api.snapPoint('v1', { x: Number.NaN, y: 1 }, 1)).toThrow(/point/);
      expect(() => api.snapPoint('v1', { x: 1, y: 1 }, 0)).toThrow(/tokenSize/);
      expect(() => api.snapPoint('v1', null as never, 1)).toThrow(/point/);
    });
  });

  describe('move', () => {
    it('moves tokens as one write, snapped, and answers where they landed', () => {
      const { api, writes, tokens } = setup();
      const result = api.move('v1', [{ tokenId: CLERIC, x: 200, y: 200 }, { tokenId: ASSASSIN, x: 300, y: 300 }]);
      expect(result.ok).toBe(true);
      expect(writes).toHaveLength(1);
      expect(writes[0]).toHaveLength(2);
      if (result.ok) {
        expect(result.positions[CLERIC]).toEqual({ x: tokens[CLERIC]!.x, y: tokens[CLERIC]!.y });
        expect(Object.isFrozen(result.positions)).toBe(true);
      }
      // Snapped to cell centres, not to where the player let go.
      expect(tokens[CLERIC]!.x).not.toBe(200);
    });

    it('does not snap when asked not to, or where the grid does not snap', () => {
      const raw = setup();
      raw.api.move('v1', [{ tokenId: CLERIC, x: 200.5, y: 201.5 }], { snap: false });
      expect(raw.tokens[CLERIC]).toMatchObject({ x: 200.5, y: 201.5 });
      const off = setup({ grid: { snapToGrid: false, size: 25 } });
      off.api.move('v1', [{ tokenId: CLERIC, x: 200.5, y: 201.5 }]);
      expect(off.tokens[CLERIC]).toMatchObject({ x: 200.5, y: 201.5 });
    });

    it('checks in the order the API says, and writes nothing when any check fails', () => {
      const t = setup({ hidden: [CLERIC] });
      expect(t.api.move('nope', [{ tokenId: CLERIC, x: 1, y: 1 }])).toEqual({ ok: false, reason: 'not-loaded' });
      expect(t.api.move('v1', [{ tokenId: 'missing', x: 1, y: 1 }, { tokenId: CLERIC, x: 1, y: 1 }])).toEqual({ ok: false, reason: 'unknown-token' });
      expect(t.api.move('v1', [{ tokenId: CLERIC, x: 1, y: 1 }])).toEqual({ ok: false, reason: 'hidden' });
      expect(t.api.move('v1', [{ tokenId: ASSASSIN, x: Number.NaN, y: 1 }])).toEqual({ ok: false, reason: 'invalid-position' });
      expect(t.api.move('v1', [{ tokenId: ASSASSIN, x: 2e9, y: 1 }])).toEqual({ ok: false, reason: 'invalid-position' });
      expect(t.api.move('v1', [{ tokenId: ASSASSIN, x: 10, y: 10 }, { tokenId: CLERIC, x: 1, y: 1 }])).toEqual({ ok: false, reason: 'hidden' });
      expect(t.writes).toEqual([]);
      expect(t.api.move('v1', [{ tokenId: CLERIC, x: 100, y: 100 }], { allowHidden: true }).ok).toBe(true);
    });

    it('refuses a token named like an object\'s own method, a view that is loading, one the GM is dragging in, and a closed view', () => {
      const t = setup();
      expect(t.api.move('v1', [{ tokenId: 'constructor', x: 1, y: 1 }])).toEqual({ ok: false, reason: 'unknown-token' });
      expect(t.api.move('v1', [{ tokenId: '__proto__', x: 1, y: 1 }])).toEqual({ ok: false, reason: 'unknown-token' });
      t.state.isMapLoading = true;
      expect(t.api.move('v1', [{ tokenId: CLERIC, x: 1, y: 1 }])).toEqual({ ok: false, reason: 'not-loaded' });
      t.state.isMapLoading = false;
      // The GM's own drop would join a player's write in one undo step.
      expect(setup({ dragging: true }).api.move('v1', [{ tokenId: CLERIC, x: 1, y: 1 }])).toEqual({ ok: false, reason: 'not-loaded' });
      t.close();
      expect(t.api.move('v1', [{ tokenId: CLERIC, x: 1, y: 1 }])).toEqual({ ok: false, reason: 'not-loaded' });
      expect(t.writes).toEqual([]);
    });

    it('fails closed where it has no grid snapping to ask, but not where nothing snaps', () => {
      expect(setup({ noSnapper: true }).api.move('v1', [{ tokenId: CLERIC, x: 100, y: 100 }])).toEqual({ ok: false, reason: 'not-loaded' });
      expect(setup({ noSnapper: true }).api.move('v1', [{ tokenId: CLERIC, x: 100, y: 100 }], { snap: false }).ok).toBe(true);
      expect(setup({ noSnapper: true, grid: null }).api.move('v1', [{ tokenId: CLERIC, x: 100, y: 100 }]).ok).toBe(true);
    });

    it('keeps a token on the map unless told not to, and a token named twice moves to its last place', () => {
      const t = setup();
      t.api.move('v1', [{ tokenId: CLERIC, x: 5000, y: 5000 }]);
      expect(t.tokens[CLERIC]!.x).toBeLessThanOrEqual(real.map.width);
      expect(t.tokens[CLERIC]!.y).toBeLessThanOrEqual(real.map.height);
      const free = setup();
      free.api.move('v1', [{ tokenId: CLERIC, x: 5000, y: 5000 }], { clampToMap: false });
      expect(free.tokens[CLERIC]!.x).toBeGreaterThan(real.map.width);
      const twice = setup();
      twice.api.move('v1', [{ tokenId: CLERIC, x: 100, y: 100 }, { tokenId: CLERIC, x: 300, y: 300 }]);
      expect(twice.tokens[CLERIC]!.x).toBeGreaterThan(250);
      expect(twice.writes[0]).toHaveLength(1);
    });

    it('throws for moves that are no list and for malformed options', () => {
      const { api } = setup();
      expect(() => api.move('v1', 'x' as never)).toThrow(/moves/);
      expect(() => api.move('v1', [], 'x' as never)).toThrow(/options/);
      expect(() => api.move('v1', [], { snap: 'yes' } as never)).toThrow(/snap/);
    });

    describe('on a scene players see lit', () => {
      // The real map: a room whose south wall has an opening between x 220 and x 423.
      const THROUGH_WALL = { tokenId: CLERIC, x: 100, y: 600 };

      it('stops a token before the first wall in its way, where an unlit scene lets it through', () => {
        const lit = setup({ lit: true });
        const result = lit.api.move('v1', [THROUGH_WALL], { snap: false });
        expect(result.ok).toBe(true);
        // The room's south wall lies at y 441: the token rests inside the room, before it.
        expect(lit.tokens[CLERIC]!.y).toBeLessThan(441);
        const unlit = setup({ lit: false });
        unlit.api.move('v1', [THROUGH_WALL], { snap: false });
        expect(unlit.tokens[CLERIC]!.y).toBeCloseTo(600, 5);
      });

      it('lets a token through an opening in the walls', () => {
        const lit = setup({ lit: true });
        lit.api.move('v1', [{ tokenId: CLERIC, x: 320, y: 560 }], { snap: false });
        expect(lit.tokens[CLERIC]).toMatchObject({ x: 320, y: 560 });
      });

      it('does not stop where Atlas shows the scene unlit (the lighting experiment is off), but does where it cannot tell', () => {
        const off = setup({ lit: true, flag: false });
        off.api.move('v1', [THROUGH_WALL], { snap: false });
        expect(off.tokens[CLERIC]!.y).toBeCloseTo(600, 5);
        const unknown = setup({ lit: true, flag: null });
        unknown.api.move('v1', [THROUGH_WALL], { snap: false });
        expect(unknown.tokens[CLERIC]!.y).toBeLessThan(441);
      });

      it('never lets a token slip through a joint the drawing left open', () => {
        // Two walls meeting with a hair of gap: Atlas's lighting seals it, so a token is stopped there too.
        const joint = {
          a: { id: 'a', kind: 'wall', type: 'solid', p1: { x: 0, y: 300 }, p2: { x: 295, y: 300 } },
          b: { id: 'b', kind: 'wall', type: 'solid', p1: { x: 297, y: 300 }, p2: { x: 600, y: 300 } },
        };
        const lit = setup({ lit: true, walls: joint });
        lit.tokens[CLERIC]!.x = 296;
        lit.tokens[CLERIC]!.y = 100;
        lit.api.move('v1', [{ tokenId: CLERIC, x: 296, y: 500 }], { snap: false });
        expect(lit.tokens[CLERIC]!.y).toBeLessThan(300);
        // A gap wider than the lighting seals is an opening: the same walls let a token through.
        const open = { a: joint.a, b: { ...joint.b, p1: { x: 380, y: 300 } } };
        const wide = setup({ lit: true, walls: open });
        wide.tokens[CLERIC]!.x = 330;
        wide.tokens[CLERIC]!.y = 100;
        wide.api.move('v1', [{ tokenId: CLERIC, x: 330, y: 500 }], { snap: false });
        expect(wide.tokens[CLERIC]!.y).toBeGreaterThan(300);
      });

      it('reads a wall that is no wall as none, as Atlas does', () => {
        const odd = setup({ lit: true, walls: { x: { id: 'x', p1: { x: 'a' } } } });
        expect(odd.api.move('v1', [THROUGH_WALL], { snap: false }).ok).toBe(true);
      });
    });
  });

  describe('the ported wall code', () => {
    it('reads the real walls as Atlas does and finds the opening', () => {
      const walls = movementWalls(wallList(real.walls), real.map);
      // The five drawn walls and the bridges the lighting seals the joints with.
      expect(walls.lines.length).toBeGreaterThanOrEqual(5 * 4);
      expect(reaches(walls, { x: 185, y: 309 }, { x: 320, y: 560 })).toBe(true);
      expect(reaches(walls, { x: 185, y: 309 }, { x: 100, y: 600 })).toBe(false);
    });
  });
});
