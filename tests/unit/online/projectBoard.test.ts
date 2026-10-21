import { describe, expect, it } from 'vitest';
import type { WorldBounds } from '../../../src/app/online/scene/FogCoverage';
import { projectBoard } from '../../../src/app/online/scene/projectBoard';
import type { BoardLook } from '../../../src/app/online/scene/sceneContracts';

/** Everything left of x = 500 is shown; the rest is under fog (or dark). */
const leftHalf = { shows: (bounds: WorldBounds) => bounds.x + bounds.width <= 500 };
const all = { shows: () => true };
const assets = { idFor: (path: string | null | undefined) => (path ? `id:${path}` : null) };

const look: BoardLook = {
  wallHeight: (id) => (id === 'w1' ? 3 : null),
  wallMaterial: (id) => (id === 'w1' ? 'mat/brick' : null),
  doorProp: (id) => (id === 'd1' ? 'minis/door.glb' : null),
  lightHeight: (id) => (id === 'l1' ? 1.5 : null),
  fogHeight: 2,
  ambient: 0.4,
  props: [{ id: 'p1', path: 'minis/barrel.glb', x: 100, y: 100, scale: 1, turn: 90 }, { id: 'p2', path: 'minis/crate.glb', x: 900, y: 100, scale: 1, turn: 0 }],
  materials: [{ id: 'mat/brick', scale: 2, maps: { color: 'mat/brick/c.jpg' } }, { id: 'mat/wood', scale: 1, maps: { color: 'mat/wood/c.jpg' } }],
};

const wall = (id: string, type: string, x: number, extra: Record<string, unknown> = {}) => ({ id, type, p1: { x, y: 0 }, p2: { x: x + 70, y: 0 }, ...extra });

function state(walls: unknown[], lights: unknown[] = [], tokens: Record<string, unknown> = {}) {
  return {
    objects: { walls: Object.fromEntries(walls.map((entry) => [(entry as { id: string }).id, entry])), lights: Object.fromEntries(lights.map((entry) => [(entry as { id: string }).id, entry])), tokens },
    lighting: { enabled: true, ambient: 0.2, ambientColor: '#223344' },
  } as never;
}

describe('projectBoard', () => {
  it('a wall whose middle is under fog is not sent; one in view is, with its look', () => {
    const extras = projectBoard(state([wall('w1', 'solid', 0), wall('w2', 'solid', 600)]), 's1', leftHalf, {}, look, assets);
    expect(extras.walls).toEqual([{ id: 'w1', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, height: 3, material: 'id:mat/brick/c.jpg' }]);
    expect(extras).toMatchObject({ sceneId: 's1', ambient: 0.4, fogHeight: 2, lighting: { enabled: true, ambient: 0.2, ambientColor: '#223344' } });
  });

  it('a closed secret door is plain wall; opened it is a door; closed again plain wall', () => {
    const closed = projectBoard(state([wall('d1', 'secret-door', 0, { closed: true })]), 's1', all, {}, look, assets);
    expect(closed.walls).toEqual([{ id: 'd1', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, height: null, material: null }]);
    const open = projectBoard(state([wall('d1', 'secret-door', 0, { closed: false, direction: 'right' })]), 's1', all, {}, look, assets);
    expect(open.walls[0]).toMatchObject({ type: 'door', door: { open: true, swing: 'right', prop: 'id:minis/door.glb' } });
    const again = projectBoard(state([wall('d1', 'secret-door', 0, { closed: true })]), 's1', all, {}, look, assets);
    expect(again.walls[0]!.type).toBe('solid');
    expect(again.walls[0]!.door).toBeUndefined();
  });

  it('a door keeps its state and prop; glass, curtains and one-way walls keep what draws them', () => {
    const extras = projectBoard(state([wall('d1', 'door', 0, { closed: true, chainId: 'c' }), wall('g', 'solid', 100, { blocks: 'light', limited: true, direction: 'left' })]), 's1', all, {}, look, assets);
    expect(extras.walls[0]).toMatchObject({ type: 'door', door: { open: false, swing: 'left', prop: 'id:minis/door.glb', chainId: 'c' } });
    expect(extras.walls[1]).toMatchObject({ type: 'solid', blocks: 'light', limited: true, direction: 'left' });
  });

  it('a token light goes when its token is not sent; a hidden fixed light is never sent, a fogged one is', () => {
    const lights = [
      { id: 'l1', x: 900, y: 10, emission: { bright: 10, dim: 20, color: '#ff0000', intensity: 1, animation: 'torch' } },
      { id: 'l2', x: 10, y: 10, hidden: true, emission: { bright: 10, dim: 20 } },
    ];
    const tokens = { t1: { id: 't1', x: 50, y: 50, light: { bright: 5, dim: 10 } }, t2: { id: 't2', x: 60, y: 60, light: { bright: 5, dim: 10 } } };
    const extras = projectBoard(state([], lights, tokens), 's1', leftHalf, { t1: {} }, look, assets);
    expect(extras.lights.map((light) => light.id)).toEqual(['l1', 't1']);
    expect(extras.lights[0]).toEqual({ id: 'l1', x: 900, y: 10, height: 1.5, color: '#ff0000', bright: 10, dim: 20, intensity: 1, animation: 'torch', angle: null, rotation: 0, darkness: false, activeBelowAmbient: null });
    const hidden = projectBoard(state([], lights, tokens), 's1', leftHalf, {}, look, assets);
    expect(hidden.lights.map((light) => light.id)).toEqual(['l1']);
  });

  it('in the dark (the frame shows nothing there) walls and props are not sent; a closed frame sends nothing', () => {
    const dark = { shows: () => false };
    const extras = projectBoard(state([wall('w1', 'solid', 0)]), 's1', dark, {}, look, assets);
    expect(extras.walls).toEqual([]);
    expect(extras.props).toEqual([]);
    const closed = projectBoard(state([wall('w1', 'solid', 0)], [{ id: 'l1', x: 1, y: 1, emission: { dim: 5 } }]), 's1', null, {}, look, assets);
    expect([closed.walls, closed.lights, closed.props, closed.materials]).toEqual([[], [], [], []]);
  });

  it('props in view and the materials of the walls sent, by asset id', () => {
    const extras = projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, look, assets);
    expect(extras.props).toEqual([{ id: 'p1', asset: 'id:minis/barrel.glb', x: 100, y: 100, scale: 1, turn: 90 }]);
    expect(extras.materials).toEqual([{ id: 'id:mat/brick/c.jpg', scale: 2, maps: { color: 'id:mat/brick/c.jpg' } }]);
  });

  it('without the GM\'s look the walls come plain, and a file not hashed yet is left out until it is', () => {
    const plain = projectBoard(state([wall('w1', 'solid', 0)]), 's1', all, {}, null, assets);
    expect(plain.walls[0]).toMatchObject({ height: null, material: null });
    expect([plain.props, plain.materials, plain.ambient, plain.fogHeight]).toEqual([[], [], null, null]);
    const unhashed = projectBoard(state([wall('w1', 'solid', 0)]), 's1', all, {}, look, { idFor: () => null });
    expect(unhashed.props).toEqual([]);
    expect(unhashed.materials).toEqual([]);
    expect(unhashed.walls[0]!.material).toBeNull();
  });
});
