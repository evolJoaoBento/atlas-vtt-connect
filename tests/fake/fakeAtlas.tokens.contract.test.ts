import { describe, expect, it } from 'vitest';
import type { GridState, SceneSnapshot, TokenEntity } from '@atlas-vtt/api-types';
import { createHexLayout, hexCircumradius, nearestHexCenter } from '@atlas-vtt/shared/grid';
import { connectingPlugin, FakeAtlas } from './FakeAtlas';

const GRID: GridState = { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 1, snapToGrid: true };

const token = (id: string, extra: Partial<TokenEntity> = {}): TokenEntity => ({ id, kind: 'token', x: 35, y: 35, imagePath: `art/${id}.png`, size: 1, ...extra }) as TokenEntity;

function scene(grid: Partial<GridState> = {}, loaded = true): Omit<SceneSnapshot, 'viewId'> {
  return {
    mapPath: 'maps/a.atlasmap', loaded, mapSize: { width: 1000, height: 500 }, background: null, grid: { ...GRID, ...grid },
    objects: {
      tokens: {
        a: token('a'), b: token('b', { x: 105 }), big: token('big', { x: 210, y: 210, size: 2 }), hidden: token('hidden', { y: 105, isHidden: true }),
      },
      texts: {}, drawings: {}, fog: {},
    },
    widgets: { settings: { widgets: {}, globalVisible: true, position: 'top', scale: 1 }, values: {} },
    initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
    initiativeTrackerOpen: false, lighting: { enabled: false, ambient: 1 },
  };
}

function setup(grid: Partial<GridState> = {}) {
  const atlas = new FakeAtlas({ capabilities: ['views', 'tokens'] });
  atlas.views.setSnapshot('v1', scene(grid));
  const { tokens, views } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  return { atlas, tokens, views };
}

describe('FakeAtlas follows the tokens cases', () => {
  it('C-tok-1: refusals and one undo step', () => {
    const atlas = new FakeAtlas({ capabilities: ['views', 'tokens'] });
    atlas.views.setSnapshot('v1', scene({}, false));
    const { tokens, views } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    expect(tokens.move('v1', [{ tokenId: 'a', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'not-loaded' });
    atlas.views.setSnapshot('v1', scene());
    expect(tokens.move('v1', [{ tokenId: 'zzz', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'unknown-token' });
    expect(tokens.move('v1', [{ tokenId: 'hidden', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'hidden' });
    expect(tokens.move('v1', [{ tokenId: 'a', x: Number.NaN, y: 0 }])).toEqual({ ok: false, reason: 'invalid-position' });
    expect(tokens.move('v1', [{ tokenId: 'a', x: 140, y: 140 }, { tokenId: 'zzz', x: 0, y: 0 }])).toEqual({ ok: false, reason: 'unknown-token' });
    expect(views.snapshot('v1')!.objects.tokens.a!.x).toBe(35);
    expect(atlas.tokens.undoSteps('v1')).toBe(0);
    const result = tokens.move('v1', [{ tokenId: 'a', x: 150, y: 150 }, { tokenId: 'b', x: 220, y: 80 }]);
    expect(result).toEqual({ ok: true, positions: { a: { x: 175, y: 175 }, b: { x: 245, y: 105 } } });
    expect(atlas.tokens.undoSteps('v1')).toBe(1);
    atlas.tokens.undo('v1');
    expect(atlas.tokens.undoSteps('v1')).toBe(0);
    expect(views.snapshot('v1')!.objects.tokens.a!.x).toBe(35);
    expect(views.snapshot('v1')!.objects.tokens.b!.x).toBe(105);
    expect(tokens.move('v1', [{ tokenId: 'hidden', x: 0, y: 0 }], { allowHidden: true }).ok).toBe(true);
  });

  it('C-tok-2: snapPoint as the GM drag: unchanged without grid or snapping, corners for a 2x2 footprint (size 1.5), a switched-off grid still snaps', () => {
    const { atlas, tokens } = setup();
    expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 35, y: 35 });
    expect(tokens.snapPoint('v1', { x: 60, y: 60 }, 1.5)).toEqual({ x: 70, y: 70 });
    expect(tokens.snapPoint('v1', { x: 60, y: 60 }, 2)).toEqual({ x: 35, y: 35 });
    atlas.views.update('v1', { grid: { ...GRID, visible: false } });
    expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 35, y: 35 });
    atlas.views.update('v1', { grid: { ...GRID, enabled: false } });
    expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 35, y: 35 });
    atlas.views.update('v1', { grid: { ...GRID, snapToGrid: false } });
    expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 10, y: 10 });
    atlas.views.update('v1', { grid: null });
    expect(tokens.snapPoint('v1', { x: 10, y: 10 }, 1)).toEqual({ x: 10, y: 10 });
    expect(tokens.snapPoint('nope', { x: 10, y: 10 }, 1)).toEqual({ x: 10, y: 10 });
  });

  it('snaps hex grids to a hex centre, and a Large token to a corner three hexes share', () => {
    for (const type of ['hex-vertical', 'hex-horizontal'] as const) {
      const { tokens } = setup({ type, size: 70, offsetX: 13, offsetY: 29 });
      const layout = createHexLayout(type, 70, 13, 29);
      const point = { x: 301.3, y: 402.7 };
      expect(tokens.snapPoint('v1', point, 1)).toEqual(nearestHexCenter(layout, point));
      expect(tokens.snapPoint('v1', point, 2)).toEqual(nearestHexCenter(layout, point));
      const corner = tokens.snapPoint('v1', point, 1.5);
      expect(corner).not.toEqual(nearestHexCenter(layout, point));
      // A shared corner is one circumradius from the nearest hex centre.
      const nearest = nearestHexCenter(layout, corner);
      expect(Math.hypot(nearest.x - corner.x, nearest.y - corner.y)).toBeCloseTo(hexCircumradius(70), 6);
    }
  });

  it('keeps the final position on the map and snapped, unless told not to; the stack rises; arguments are checked', () => {
    const { atlas, tokens, views } = setup();
    expect(tokens.move('v1', [{ tokenId: 'a', x: -500, y: 9999 }])).toEqual({ ok: true, positions: { a: { x: 35, y: 455 } } });
    expect(tokens.move('v1', [{ tokenId: 'a', x: -500, y: 9999 }], { clampToMap: false, snap: false })).toEqual({ ok: true, positions: { a: { x: -500, y: 9999 } } });
    const layers = views.snapshot('v1')!.objects.tokens;
    expect(layers.a!.layer).toBeGreaterThan(layers.b!.layer ?? 0);
    expect(() => tokens.move('v1', 'a' as never)).toThrow(/moves/);
    expect(() => tokens.snapPoint('v1', { x: Number.NaN, y: 0 }, 1)).toThrow(/point/);
    expect(() => tokens.snapPoint('v1', { x: 0, y: 0 }, 0)).toThrow(/tokenSize/);
    atlas.views.close('v1');
    expect(tokens.move('v1', [{ tokenId: 'a', x: 1, y: 1 }])).toEqual({ ok: false, reason: 'not-loaded' });
  });

  it('refuses malformed options before anything else, as Atlas does', () => {
    const { tokens } = setup();
    expect(() => tokens.move('v1', [], 5 as never)).toThrow(/options/);
    expect(() => tokens.move('v1', [], [] as never)).toThrow(/options/);
    expect(() => tokens.move('v1', [], { snap: 'yes' } as never)).toThrow(/snap/);
    expect(() => tokens.move('nobody', [], { clampToMap: 1 } as never)).toThrow(/clampToMap/);
    expect(() => tokens.move('v1', [{ tokenId: 'a', x: 1, y: 1 }], { allowHidden: null } as never)).toThrow(/allowHidden/);
  });
});
