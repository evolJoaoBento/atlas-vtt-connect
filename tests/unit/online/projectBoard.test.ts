import { describe, expect, it } from 'vitest';
import type { WorldBounds } from '../../../src/app/online/scene/FogCoverage';
import { projectBoard } from '../../../src/app/online/scene/projectBoard';
import type { BoardLook } from '../../../src/app/online/scene/sceneContracts';
import { isBoardExtras } from '../../../src/app/online/scene/boardValidation';
import { BOARD_WATER_LIMITS } from '../../../src/app/online/scene/boardTypes';

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
    // Atlas's scene lighting is the board's one light level: the GM's own ambient and tint went with fusion 4E.
    expect(extras).not.toHaveProperty('ambient');
    expect(extras).not.toHaveProperty('tint');
    expect(extras).toMatchObject({ sceneId: 's1', fogHeight: 2, wallThickness: 0.3, lighting: { enabled: true, ambient: 0.2, ambientColor: '#223344' } });
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

  it('a turned door is valid, a door whose hinge is no side is not', () => {
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

  it("the scene's water goes as outlines (Atlas's liquids, as Tabletop reads them) with its motion; what is no outline, or too much of it, does not", () => {
    const motion = { kind: 'flow', amount: 0.5, direction: 45, tint: '#2a6f8a', clarity: 0.7 };
    const areas = [{ polygon: [0, 0, 0, 70, 70, 70], holes: [[10, 30, 10, 40, 20, 40]] }, { polygon: [100, 0, 100, 10, 110, 10] }];
    const sent = projectBoard(state([wall('w1', 'solid', 0)]), 's1', leftHalf, {}, { ...look, water: { areas, motion } }, assets);
    expect(sent.water).toEqual({ areas, motion });
    expect(isBoardExtras(sent)).toBe(true);
    // Rings that are none are left out, with their area when it is the outline; numbers that are none never go.
    const odd = projectBoard(state([]), 's1', leftHalf, {}, { ...look, water: { areas: [{ polygon: [0, 0, 1, 1] }, { polygon: [0, 0, 0, 70, 70, Number.NaN] }, { polygon: [0, 0, 0, 70, 70, 70], holes: [[1, 2, 3], 'x'] }] as never, motion } }, assets);
    expect(odd.water).toEqual({ areas: [{ polygon: [0, 0, 0, 70, 70, 70] }], motion });
    // More outline than a scene's water may send (as text, like its old mask): the areas that still fit go, in order.
    const small = Array.from({ length: 600 }, (_, k) => k);
    const wide = Array.from({ length: 4096 }, (_, k) => 100000.25 + k);
    expect(JSON.stringify(wide).length * 2).toBeGreaterThan(BOARD_WATER_LIMITS.scene);
    const many = projectBoard(state([]), 's1', leftHalf, {}, { ...look, water: { areas: [{ polygon: small }, { polygon: wide }, { polygon: wide }, { polygon: [5, 5, 5, 9, 9, 9] }], motion } }, assets);
    expect(many.water!.areas!.map((area) => area.polygon.length)).toEqual([600, 4096, 6]);
    // A ring of more corners than Atlas keeps is no ring.
    expect(projectBoard(state([]), 's1', leftHalf, {}, { ...look, water: { areas: [{ polygon: [...wide, 1, 2] }], motion } }, assets).water).toBeUndefined();
    // With no outline left and no mask there is no water.
    expect(projectBoard(state([]), 's1', leftHalf, {}, { ...look, water: { areas: [], motion } }, assets).water).toBeUndefined();
    expect(isBoardExtras({ ...sent, water: { areas: [{ polygon: [0, 0, 1] }] } })).toBe(false);
    expect(isBoardExtras({ ...sent, water: { areas: [{ polygon: [0, 0, 0, 70, 70, '70'] }] } })).toBe(false);
    expect(isBoardExtras({ ...sent, water: { areas: [{ polygon: [0, 0, 0, 70, 70, 70], holes: [[1, 1]] }] } })).toBe(false);
    expect(isBoardExtras({ ...sent, water: { motion } })).toBe(false);
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
    expect([plain.props, plain.materials, plain.fogHeight]).toEqual([[], [], null]);
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

    it("a level Atlas fitted to the scene's grid goes with its fit, and a fit that is none is refused", () => {
      const fit = { x: 0.7, y: 0.7, offset: { x: 200, y: 100 } };
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, layers: [{ ...upstairs, grid: { ...upstairs.grid, mapStretch: fit } }] }, assets);
      expect(extras.layers![0]!.grid).toEqual({ size: 70, offsetX: 5, offsetY: 6, mapStretch: fit });
      expect(isBoardExtras(extras)).toBe(true);
      for (const junk of [{ x: 0, y: 1 }, { x: 1, y: 'a' }, { x: 1, y: 1, rotation: 30 }, { x: 1, y: 1, offset: { x: -5, y: 0 } }, { x: 1e6, y: 1 }]) {
        const bad = projectBoard(state([]), 's1', all, {}, { ...look, layers: [{ ...upstairs, grid: { ...upstairs.grid, mapStretch: junk as never } }] }, assets);
        expect(isBoardExtras(bad), JSON.stringify(junk)).toBe(false);
      }
    });

    it('a stacked scene goes with its water, as outlines', () => {
      const water = { areas: [{ polygon: [0, 0, 0, 70, 70, 70] }], motion: { kind: 'still', amount: 0.3, direction: 90, tint: '#2a6f8a', clarity: 0.5 } };
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, layers: [{ ...upstairs, water }] }, assets);
      expect(extras.layers![0]!.water).toEqual(water);
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

  describe('raised shapes and the ground', () => {
    const roof = { id: 'roof', outline: [{ x: 100, y: 100, h: 0 }, { x: 300, y: 100, h: 0 }, { x: 300, y: 300, h: 0 }], inner: [{ x: 200, y: 200, h: 2.456 }], material: 'mat/wood', sides: 'mat/brick' as const };
    const far = { id: 'far', outline: [{ x: 700, y: 100, h: 0 }, { x: 900, y: 100, h: 1 }, { x: 900, y: 300, h: 0 }], inner: [] };
    const ground = { mode: 'horizon' as const, material: 'mat/wood', noise: 'dunes', strength: 0.7, fog: 55, margin: 12, tile: 3, water: { kind: 'waves', amount: 0.4, direction: 45, tint: '#2D6B78', clarity: 0.5 } };

    it('a shape players see any of goes, with its corners as x, y, h and its materials by asset id; one under fog does not', () => {
      const extras = projectBoard(state([]), 's1', leftHalf, {}, { ...look, shapes: [roof, far] }, assets);
      expect(extras.shapes).toEqual([{ id: 'roof', outline: [100, 100, 0, 300, 100, 0, 300, 300, 0], inner: [200, 200, 2.46], material: 'id:mat/wood/c.jpg', sides: 'id:mat/brick/c.jpg' }]);
      expect(extras.materials.map((entry) => entry.id).sort()).toEqual(['id:mat/brick/c.jpg', 'id:mat/wood/c.jpg']);
      expect(isBoardExtras(extras)).toBe(true);
    });

    it('a shape whose material is not hashed yet wears the map image, its sides plain; a broken one does not go', () => {
      const unhashed = { idFor: (path: string | null | undefined) => (path?.startsWith('mat/') ? null : path ? `id:${path}` : null) };
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, shapes: [roof, { ...far, outline: far.outline.slice(0, 2) }, { ...far, id: 'nan', outline: [...far.outline, { x: Number.NaN, y: 0, h: 0 }] }] }, unhashed);
      expect(extras.shapes).toEqual([{ id: 'roof', outline: [100, 100, 0, 300, 100, 0, 300, 300, 0], inner: [200, 200, 2.46], sides: true }]);
    });

    it("a stacked scene's shapes go whole, as its walls do", () => {
      const upstairs = { elevation: 3, stands: { x: 0, y: 0, turn: 0 }, image: 'maps/up.png', grid: { size: 70, offsetX: 0, offsetY: 0 }, walls: [], lights: [], props: [], materials: [{ id: 'mat/wood', scale: 1, maps: { color: 'mat/wood/c.jpg' } }], fogHeight: null, wallThickness: null, shapes: [roof, far] };
      const extras = projectBoard(state([]), 's1', leftHalf, {}, { ...look, layers: [upstairs] }, assets);
      expect(extras.layers![0]!.shapes!.map((shape) => shape.id)).toEqual(['roof', 'far']);
      expect(isBoardExtras(extras)).toBe(true);
    });

    it('the ground goes whatever players see, its material by asset id; the plain map board with no extra board does not', () => {
      const extras = projectBoard(state([]), 's1', { shows: () => false }, {}, { ...look, ground }, assets);
      expect(extras.ground).toEqual({ ...ground, material: 'id:mat/wood/c.jpg', water: { ...ground.water, tint: '#2d6b78' } });
      expect(isBoardExtras(extras)).toBe(true);
      expect(projectBoard(state([]), 's1', all, {}, { ...look, ground: { ...ground, mode: 'board', margin: 0 } }, assets)).not.toHaveProperty('ground');
      expect(projectBoard(state([]), 's1', all, {}, { ...look, ground: { ...ground, mode: 'board', margin: 5 } }, assets).ground).toMatchObject({ mode: 'board', margin: 5 });
      // Out of range, it is held to its range.
      expect(projectBoard(state([]), 's1', all, {}, { ...look, ground: { ...ground, fog: 400, tile: 0, strength: -1, noise: 'lava' } }, assets).ground).toMatchObject({ fog: 100, tile: 1, strength: 0, noise: 'rolling' });
    });

    it('a shape whose id the players would refuse, or a height that rounds onto the limit, is not sent', () => {
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, shapes: [{ ...far, id: 'x'.repeat(300) }, { ...far, id: 'tall', inner: [{ x: 800, y: 200, h: 999.996 }] }, far] }, assets);
      expect(extras.shapes!.map((shape) => shape.id)).toEqual(['far']);
      expect(isBoardExtras(extras)).toBe(true);
    });

    it("a level whose shapes would not fit still goes, without its shapes", () => {
      const roofs = Array.from({ length: 150 }, (_, i) => ({ ...roof, id: `roof-${i}`, outline: Array.from({ length: 40 }, (_, k) => ({ x: 100 + k, y: 100 + i, h: 1.25 })) }));
      const level = (n: number) => ({ elevation: n, stands: { x: 0, y: 0, turn: 0 }, image: `maps/l${n}.png`, grid: { size: 70, offsetX: 0, offsetY: 0 }, walls: [], lights: [], props: [], materials: [], fogHeight: null, wallThickness: null, shapes: roofs });
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, layers: [level(1), level(2), level(3), level(4)] }, assets);
      expect(extras.layers!.map((layer) => layer.elevation)).toEqual([1, 2, 3, 4]);
      expect(extras.layers!.some((layer) => layer.shapes === undefined)).toBe(true);
      expect(JSON.stringify(extras.layers).length).toBeLessThan(115 * 1024);
      expect(isBoardExtras(extras)).toBe(true);
    });

    it('the checks refuse broken shapes and ground', () => {
      const extras = projectBoard(state([]), 's1', all, {}, { ...look, shapes: [roof], ground }, assets);
      expect(isBoardExtras(extras)).toBe(true);
      const shape = extras.shapes![0]!;
      for (const bad of [{ ...shape, outline: [0, 0, 0, 1, 1, 1] }, { ...shape, outline: [0, 0, 0, 1, 1, 1, 2, 2] }, { ...shape, inner: [0, 0, 5000] }, { ...shape, sides: false }, { ...shape, material: '' }]) {
        expect(isBoardExtras({ ...extras, shapes: [bad] }), JSON.stringify(bad)).toBe(false);
      }
      for (const bad of [{ ...extras.ground!, mode: 'lava' }, { ...extras.ground!, margin: 500 }, { ...extras.ground!, noise: 'x' }, { ...extras.ground!, water: { ...extras.ground!.water, tint: 'red' } }]) {
        expect(isBoardExtras({ ...extras, ground: bad }), JSON.stringify(bad)).toBe(false);
      }
    });
  });
});
