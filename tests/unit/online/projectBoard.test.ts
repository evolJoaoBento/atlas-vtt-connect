import { describe, expect, it } from 'vitest';
import type { WorldBounds } from '../../../src/app/online/scene/FogCoverage';
import { projectBoard } from '../../../src/app/online/scene/projectBoard';
import type { BoardLook } from '../../../src/app/online/scene/sceneContracts';
import { isBoardExtras } from '../../../src/app/online/scene/boardValidation';

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
  wallThickness: 0.3,
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
    expect(extras).toMatchObject({ sceneId: 's1', ambient: 0.4, fogHeight: 2, wallThickness: 0.3, lighting: { enabled: true, ambient: 0.2, ambientColor: '#223344' } });
  });

  it('a door under fog is not sent with its prop, and the same door in view is (Atlas 0.7.0: door icons under fog are hidden)', () => {
    const asked: string[] = [];
    const recording = { idFor: (path: string | null | undefined) => { if (path) asked.push(path); return path ? `id:${path}` : null; } };
    const fogged = projectBoard(state([wall('d1', 'door', 600, { closed: true })]), 's1', leftHalf, {}, look, recording);
    expect(fogged.walls).toEqual([]);
    expect(asked).not.toContain('minis/door.glb');
    const seen = projectBoard(state([wall('d1', 'door', 0, { closed: true })]), 's1', leftHalf, {}, look, recording);
    expect(seen.walls[0]).toMatchObject({ type: 'door', door: { prop: 'id:minis/door.glb' } });
  });

  it('a closed secret door is plain wall; opened it is a door; closed again plain wall', () => {
    const closed = projectBoard(state([wall('d1', 'secret-door', 0, { closed: true, direction: 'left', limited: true })]), 's1', all, {}, look, assets);
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

  it("a window (a wall that stops only tokens) goes as one, with the opening the GM set on Tabletop's board", () => {
    const windowed: BoardLook = { ...look, windowOf: (id) => (id === 'w' ? { bottom: 0.5, top: 1.5 } : null) };
    const extras = projectBoard(state([wall('w', 'solid', 0, { blocks: 'movement' }), wall('v', 'solid', 100, { blocks: 'movement' }), wall('d', 'door', 200, { blocks: 'movement' })]), 's1', all, {}, windowed, assets);
    expect(extras.walls[0]).toMatchObject({ blocks: 'movement', window: { bottom: 0.5, top: 1.5 } });
    expect(extras.walls[1]!.blocks).toBe('movement');
    expect(extras.walls[1]!.window).toBeUndefined();
    expect(extras.walls[2]!.blocks).toBeUndefined();
    expect(isBoardExtras(extras)).toBe(true);
    expect(isBoardExtras({ ...extras, walls: [{ ...extras.walls[0]!, window: { bottom: 2, top: 1 } }] })).toBe(false);
  });

  it("a wall's own width on Tabletop's board goes with it", () => {
    const extras = projectBoard(state([wall('w', 'solid', 0), wall('v', 'solid', 100)]), 's1', all, {}, { ...look, wallWidth: (id) => (id === 'w' ? 0.3 : null) }, assets);
    expect(extras.walls[0]!.width).toBe(0.3);
    expect(extras.walls[1]!.width).toBeUndefined();
    expect(isBoardExtras(extras)).toBe(true);
    expect(isBoardExtras({ ...extras, walls: [{ ...extras.walls[0]!, width: 0 }] })).toBe(false);
  });

  it('a token light goes when its token is not sent; a hidden fixed light is never sent, nor one under fog', () => {
    const lights = [
      { id: 'l1', x: 900, y: 10, emission: { bright: 10, dim: 20, color: '#ff0000', intensity: 1, animation: 'torch' } },
      { id: 'l2', x: 10, y: 10, hidden: true, emission: { bright: 10, dim: 20 } },
    ];
    const tokens = { t1: { id: 't1', x: 50, y: 50, light: { bright: 5, dim: 10 } }, t2: { id: 't2', x: 60, y: 60, light: { bright: 5, dim: 10 } } };
    const extras = projectBoard(state([], lights, tokens), 's1', leftHalf, { t1: {} }, look, assets);
    expect(extras.lights.map((light) => light.id)).toEqual(['t1']);
    const shown = projectBoard(state([], lights, tokens), 's1', all, {}, look, assets);
    expect(shown.lights[0]).toEqual({ id: 'l1', x: 900, y: 10, height: 1.5, color: '#ff0000', bright: 10, dim: 20, intensity: 1, animation: 'torch', angle: null, rotation: 0, darkness: false, activeBelowAmbient: null });
    const hidden = projectBoard(state([], lights, tokens), 's1', leftHalf, {}, look, assets);
    expect(hidden.lights.map((light) => light.id)).toEqual([]);
  });

  it('a door the GM turned carries how, and an unturned one carries nothing; a secret door closed carries nothing', () => {
    const turned: BoardLook = { ...look, doorFlip: (id) => (id === 'd1' ? { hinge: true, side: true } : id === 'd2' ? { hinge: true, side: false } : { hinge: false, side: false }) };
    const extras = projectBoard(state([wall('d1', 'door', 0, { closed: true }), wall('d2', 'door', 100, { closed: false }), wall('d3', 'door', 200, { closed: true }), wall('s', 'secret-door', 300, { closed: true })]), 's1', all, {}, turned, assets);
    expect(extras.walls[0]!.door).toMatchObject({ hinge: true, side: true });
    expect(extras.walls[1]!.door).toMatchObject({ hinge: true });
    expect(extras.walls[1]!.door).not.toHaveProperty('side');
    expect(extras.walls[2]!.door).not.toHaveProperty('hinge');
    expect(extras.walls[3]!.door).toBeUndefined();
    expect(isBoardExtras(extras)).toBe(true);
    // A Tabletop that does not know turned doors sends none.
    expect(projectBoard(state([wall('d1', 'door', 0, { closed: true })]), 's1', all, {}, look, assets).walls[0]!.door).not.toHaveProperty('hinge');
  });

  it('the daylight tint goes when the GM set one; extras with or without it, and a turned door, are valid; a bad colour is not', () => {
    expect(projectBoard(state([]), 's1', all, {}, { ...look, tint: '#ffcc88' }, assets).tint).toBe('#ffcc88');
    expect(projectBoard(state([]), 's1', all, {}, { ...look, tint: null }, assets)).not.toHaveProperty('tint');
    expect(projectBoard(state([]), 's1', all, {}, look, assets)).not.toHaveProperty('tint');
    const extras = projectBoard(state([]), 's1', all, {}, { ...look, tint: '#ffcc88' }, assets);
    expect(isBoardExtras(extras)).toBe(true);
    expect(isBoardExtras({ ...extras, tint: 'red' })).toBe(false);
    expect(isBoardExtras({ ...extras, tint: null })).toBe(true);
    const door = projectBoard(state([wall('d1', 'door', 0, { closed: true })]), 's1', all, {}, look, assets);
    expect(isBoardExtras({ ...door, walls: [{ ...door.walls[0], door: { ...door.walls[0]!.door, hinge: false } }] })).toBe(false);
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

  it('a solid prop goes as solid, so tokens stand on it on the players boards', () => {
    const solid = { ...look, props: [{ ...look.props[0]!, solid: true }] };
    const extras = projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, solid, assets);
    expect(extras.props).toEqual([{ id: 'p1', asset: 'id:minis/barrel.glb', x: 100, y: 100, scale: 1, turn: 90, solid: true }]);
  });

  it('a raised prop goes with its height', () => {
    const raised = { ...look, props: [{ ...look.props[0]!, lift: 1.5 }] };
    const extras = projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, raised, assets);
    expect(extras.props[0]).toMatchObject({ lift: 1.5 });
  });

  it('the Upper layers look of the GM goes to players, and an unknown one does not', () => {
    expect(projectBoard(state([]), 's1', all, {}, { ...look, layerLook: 'faded' }, assets).layerLook).toBe('faded');
    expect(projectBoard(state([]), 's1', all, {}, { ...look, layerLook: 'glass' as 'faded' }, assets)).not.toHaveProperty('layerLook');
    expect(projectBoard(state([]), 's1', null, {}, { ...look, layerLook: 'hidden' as 'faded' }, assets)).not.toHaveProperty('layerLook');
  });

  it('the painted water of the scene goes with its motion; water too long to send, or a broken mask, does not', () => {
    const water = { mask: { width: 40, height: 30, data: 'AQID' }, motion: { kind: 'flow', amount: 0.5, direction: 45, tint: '#2a6f8a', clarity: 0.7 } };
    const sent = projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, { ...look, water }, assets);
    expect(sent.water).toEqual(water);
    expect(isBoardExtras(sent)).toBe(true);
    const huge = projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, { ...look, water: { mask: { width: 40, height: 30, data: 'A'.repeat(200 * 1024) } } }, assets);
    expect(huge.water).toBeUndefined();
    expect(isBoardExtras({ ...sent, water: { mask: { width: 0, height: 30, data: 'AQID' } } })).toBe(false);
    expect(isBoardExtras({ ...sent, water: { mask: { width: 40, height: 30, data: '<script>' } } })).toBe(false);
    expect(isBoardExtras({ ...sent, water: { ...water, motion: { ...water.motion, tint: 'red' } } })).toBe(false);
  });

  it('a material carries its tuning, and one as made carries none', () => {
    const tuning = { relief: 1.5, occlusion: 1, shine: 0.2, depth: 0.8, displace: 0.5, outward: 0.3 };
    const tuned = { ...look, materials: [{ id: 'mat/brick', scale: 2, maps: { color: 'mat/brick/c.jpg' }, tuning }, { id: 'mat/wood', scale: 1, maps: { color: 'mat/wood/c.jpg' } }] };
    const extras = projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, tuned, assets);
    expect(extras.materials[0]?.tuning).toEqual(tuning);
    expect(projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, look, assets).materials[0]).not.toHaveProperty('tuning');
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
  describe('stacked scenes', () => {
    const upstairs: NonNullable<BoardLook['layers']>[number] = {
      elevation: 3, stands: { x: 10, y: 20, turn: 90 }, image: 'maps/up.png', grid: { size: 70, offsetX: 5, offsetY: 6 },
      walls: [
        { id: 'a', type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, closed: true, direction: null, blocks: null, limited: false, chain: null, height: 2, material: 'mat/brick', doorProp: null, flip: { hinge: false, side: false } },
        { id: 'd', type: 'door', p1: { x: 70, y: 0 }, p2: { x: 140, y: 0 }, closed: false, direction: 'right', blocks: null, limited: false, chain: 'c', height: null, material: null, doorProp: 'minis/door.glb', flip: { hinge: true, side: true } },
        { id: 's', type: 'secret-door', p1: { x: 140, y: 0 }, p2: { x: 210, y: 0 }, closed: true, direction: 'left', blocks: null, limited: true, chain: null, height: null, material: null, doorProp: 'minis/door.glb', flip: { hinge: true, side: false } },
      ],
      lights: [{ id: 'l', x: 5, y: 5, height: 1, bright: 20, dim: 40, color: '#ffaa00', intensity: 1, animation: 'torch', angle: null, rotation: 0, darkness: false, activeBelowAmbient: null }],
      props: [{ id: 'p', path: 'minis/barrel.glb', x: 1, y: 2, scale: 1, turn: 0 }],
      materials: [{ id: 'mat/brick', scale: 2, maps: { color: 'mat/brick/c.jpg' } }],
      fogHeight: 2, wallThickness: null,
    };

    it('a scene stacked with the map goes as its floor, walls, doors, lights and props, by asset id, at its height and place', () => {
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, layers: [upstairs] }, assets);
      expect(extras.layers).toHaveLength(1);
      const layer = extras.layers![0]!;
      expect(layer).toMatchObject({ id: 'layer-1', elevation: 3, stands: { x: 10, y: 20, turn: 90 }, image: 'id:maps/up.png', grid: { size: 70, offsetX: 5, offsetY: 6 }, fogHeight: 2 });
      expect(layer.walls[0]).toMatchObject({ id: 'a', type: 'solid', height: 2, material: 'id:mat/brick/c.jpg' });
      expect(layer.walls[1]).toMatchObject({ type: 'door', direction: 'right', door: { open: true, swing: 'right', prop: 'id:minis/door.glb', chainId: 'c', hinge: true, side: true } });
      expect(layer.props).toEqual([{ id: 'p', asset: 'id:minis/barrel.glb', x: 1, y: 2, scale: 1, turn: 0 }]);
      expect(layer.lights[0]).toMatchObject({ id: 'l', color: '#ffaa00', animation: 'torch' });
      expect(extras.materials.map((entry) => entry.id)).toContain('id:mat/brick/c.jpg');
      expect(isBoardExtras(extras)).toBe(true);
    });

    it('a stacked scene goes with its painted water', () => {
      const water = { mask: { width: 40, height: 30, data: 'AQID' }, motion: { kind: 'still', amount: 0.3, direction: 90, tint: '#2a6f8a', clarity: 0.5 } };
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, layers: [{ ...upstairs, water }] }, assets);
      expect(extras.layers![0]!.water).toEqual(water);
      expect(isBoardExtras(extras)).toBe(true);
    });

    it('a closed secret door of a stacked scene is plain wall and keeps nothing that sets it apart', () => {
      const wall = projectBoard(state([]), 's1', all, {}, { ...look, layers: [upstairs] }, assets).layers![0]!.walls[2]!;
      expect(wall).toEqual({ id: 's', type: 'solid', p1: { x: 140, y: 0 }, p2: { x: 210, y: 0 }, height: null, material: null });
    });

    it('a scene whose floor is not hashed yet is left out until it is; no layers means no key', () => {
      const unhashed = { idFor: (path: string | null | undefined) => (path === 'maps/up.png' ? null : path ? `id:${path}` : null) };
      expect(projectBoard(state([]), 's1', all, {}, { ...look, layers: [upstairs] }, unhashed)).not.toHaveProperty('layers');
      expect(projectBoard(state([]), 's1', all, {}, look, assets)).not.toHaveProperty('layers');
    });

    it('nothing is sent of a stack when the frame cannot be read, and the layers are capped by size', () => {
      expect(projectBoard(state([]), 's1', null, {}, { ...look, layers: [upstairs] }, assets)).not.toHaveProperty('layers');
      const wide = { ...upstairs, walls: Array.from({ length: 400 }, (_, i) => ({ ...upstairs.walls[0]!, id: `wall-${i}-${'x'.repeat(60)}` })) };
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, layers: [wide, wide, wide, wide, wide, wide] }, assets);
      expect(extras.layers!.length).toBeLessThan(6);
      expect(JSON.stringify(extras.layers).length).toBeLessThan(115 * 1024);
    });
  });
});
