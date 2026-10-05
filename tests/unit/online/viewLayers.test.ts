import { describe, expect, it } from 'vitest';
import { cellNumberAnchor, numberCells } from '@atlas-vtt/shared/grid';
import { squareLattice } from '@atlas-vtt/shared/grid';
import { gridLines } from '../../../src/app/online/preview/previewShapes';
import type { PlayerGrid } from '../../../src/app/online/scene/sceneTypes';
import { createDrawingsLayer } from '../../../src/app/online/view/layers/drawingsLayer';
import { createGridLayer } from '../../../src/app/online/view/layers/gridLayer';
import { createMapLayer, MAP_PLACEHOLDER } from '../../../src/app/online/view/layers/mapLayer';
import { createTextsLayer } from '../../../src/app/online/view/layers/textsLayer';
import { decodedImage, frame, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

const text = playerScene().texts.x1!;

describe('map layer', () => {
  it('draws the map image at the map size once it has loaded, a placeholder before', () => {
    const surface = new RecordingSurface();
    const layer = createMapLayer();
    layer.draw(surface, frame(playerScene()));
    expect(surface.calls).toEqual([{ op: 'rect', x: 0, y: 0, width: 1000, height: 800, style: { fill: MAP_PLACEHOLDER } }]);
    surface.clear();
    const art = decodedImage(500, 400);
    layer.draw(surface, frame(playerScene(), { images: (id) => (id === 'map-asset' ? art : null) }));
    expect(surface.calls).toEqual([{ op: 'image', image: art.image, x: 0, y: 0, width: 1000, height: 800, clip: null }]);
  });

  it('draws nothing off screen or without a map size', () => {
    const surface = new RecordingSurface();
    const layer = createMapLayer();
    layer.draw(surface, frame(playerScene(), { visible: { x: 2000, y: 0, width: 100, height: 100 } }));
    layer.draw(surface, frame(playerScene({ map: { asset: 'map-asset', width: 0, height: 0, cellSize: 70 } })));
    expect(surface.calls).toEqual([]);
  });
});

describe('grid layer', () => {
  const grid = playerScene().grid!;

  it('draws square lines over the visible part of the map only, to the edge of its tile', () => {
    const surface = new RecordingSurface();
    const map = { asset: null, width: 100_000, height: 100_000, cellSize: 70 };
    const visible = { x: 5000, y: 5000, width: 1000, height: 300 };
    createGridLayer().draw(surface, frame(playerScene({ map }), { visible }));
    const lines = gridLines(grid, { x: 4096, y: 4096, width: 2048, height: 2048 });
    expect(surface.calls).toEqual([{
      op: 'paths', paths: lines!.segments, closed: false, style: { stroke: '#808080', alpha: 0.5, lineWidth: 1, dash: [] },
    }]);
    expect(lines!.segments.length).toBeLessThan(100);
  });

  it('reuses its lines while the view stays inside a tile, and builds them again past it', () => {
    const surface = new RecordingSurface();
    const layer = createGridLayer();
    const scene = playerScene({ map: { asset: null, width: 100_000, height: 100_000, cellSize: 70 } });
    layer.draw(surface, frame(scene, { visible: { x: 5000, y: 5000, width: 1000, height: 300 } }));
    layer.draw(surface, frame(scene, { visible: { x: 5100, y: 5010, width: 1000, height: 300 } }));
    layer.draw(surface, frame(scene, { visible: { x: 9000, y: 5000, width: 1000, height: 300 } }));
    const [first, second, third] = surface.ops('paths');
    expect(second!.paths[0]![0]).toBe(first!.paths[0]![0]);
    expect(third!.paths[0]![0]).not.toBe(first!.paths[0]![0]);
  });

  it('numbers only the hexes on screen', () => {
    const hexes: PlayerGrid = { ...grid, type: 'hex-vertical', hexNumbers: 'column-row' };
    const surface = new RecordingSurface();
    const layer = createGridLayer();
    layer.draw(surface, frame(playerScene({ grid: hexes })));
    const all = surface.ops('text').length;
    surface.clear();
    layer.draw(surface, frame(playerScene({ grid: hexes }), { visible: { x: 0, y: 0, width: 300, height: 200 } }));
    const some = surface.ops('text');
    expect(some.length).toBeGreaterThan(0);
    expect(some.length).toBeLessThan(all / 3);
    expect(some.every((label) => label.x <= 300 && label.y <= 200)).toBe(true);
  });

  it('dashes in screen pixels and never draws thinner than a device pixel', () => {
    const surface = new RecordingSurface();
    const dashed: PlayerGrid = { ...grid, lineType: 'dashed', lineWidth: 0.1 };
    createGridLayer().draw(surface, frame(playerScene({ grid: dashed }), { zoom: 2, pixel: 0.25 }));
    expect(surface.ops('paths')[0]?.style).toMatchObject({ dash: [3, 2], lineWidth: 0.25 });
  });

  it('numbers hexes when the GM shows them and they are large enough to read', () => {
    const hexes: PlayerGrid = { ...grid, type: 'hex-vertical', hexNumbers: 'column-row', hexNumberOpacity: 0.8 };
    const surface = new RecordingSurface();
    const layer = createGridLayer();
    layer.draw(surface, frame(playerScene({ grid: hexes })));
    const labels = surface.ops('text');
    expect(labels.length).toBeGreaterThan(10);
    expect(labels[0]?.style).toMatchObject({ align: 'center', alpha: 0.8 });
    expect(labels.every((label) => /^\d{4}$/.test(label.text))).toBe(true);
    surface.clear();
    layer.draw(surface, frame(playerScene({ grid: hexes }), { zoom: 0.5 }));
    expect(surface.ops('text')).toEqual([]);
  });

  it('numbers the cells of a square grid in any format, where GridSystem numbers them', () => {
    const squares: PlayerGrid = { ...grid, offsetX: 10, offsetY: 20, cellNumbers: 'letter-number', cellNumberOpacity: 0.5 };
    const surface = new RecordingSurface();
    createGridLayer().draw(surface, frame(playerScene({ grid: squares })));
    const labels = surface.ops('text');
    const expected = numberCells(squareLattice(70, 10, 20), { x: 0, y: 0, width: 1000, height: 800 }, 'letter-number')
      .map((cell) => ({ ...cellNumberAnchor(70, cell.center), text: cell.label }));
    expect(labels.map(({ text: label, x, y }) => ({ text: label, x, y })).sort((a, b) => a.text.localeCompare(b.text)))
      .toEqual(expected.map(({ text: label, x, y }) => ({ text: label, x, y })).sort((a, b) => a.text.localeCompare(b.text)));
    expect(labels.map((label) => label.text)).toContain('A1');
    expect(labels[0]?.style).toMatchObject({ alpha: 0.5 });
  });

  it('reads the older hex numbers of a GM before Atlas 0.5.1 on hex grids only, and the cell numbers over them', () => {
    const draw = (patch: Partial<PlayerGrid>): string[] => {
      const surface = new RecordingSurface();
      createGridLayer().draw(surface, frame(playerScene({ grid: { ...grid, ...patch } })));
      return surface.ops('text').map((label) => label.text);
    };
    // An older GM sent `hexNumbers` on square grids too, where its Atlas drew none.
    expect(draw({ hexNumbers: 'column-row' })).toEqual([]);
    expect(draw({ type: 'hex-vertical', hexNumbers: 'sequential' })).toContain('1');
    // A newer GM's `cellNumbers` decides, also when it says none.
    expect(draw({ type: 'hex-vertical', hexNumbers: 'sequential', cellNumbers: null })).toEqual([]);
    expect(draw({ type: 'hex-vertical', hexNumbers: null, cellNumbers: 'letter-number' })).toContain('A1');
  });

  it('draws the hexes of a large map at the fitted zoom, past the preview cap', () => {
    const hexes: PlayerGrid = { ...grid, type: 'hex-vertical', size: 70 };
    const map = { asset: null, width: 6000, height: 5000, cellSize: 70 };
    const surface = new RecordingSurface();
    const visible = { x: -64, y: -64, width: 6128, height: 5128 };
    createGridLayer().draw(surface, frame(playerScene({ grid: hexes, map }), { visible, zoom: 0.15 }));
    expect(surface.ops('paths')[0]?.paths.length).toBeGreaterThan(5000);
  });

  it('draws no grid when the GM hides it', () => {
    const surface = new RecordingSurface();
    createGridLayer().draw(surface, frame(playerScene({ grid: null })));
    expect(surface.calls).toEqual([]);
  });
});

describe('drawings layer', () => {
  it('draws ink in its order, icon stamps as icons and single points as dots, skipping erasers and what is off screen', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({
      drawings: {
        b: { type: 'pen', order: 2, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }], color: '#ff0000', width: 4, opacity: 1, icon: null },
        a: { type: 'icon', order: 1, points: [{ x: 50, y: 50 }], color: '#00ff00', width: 70, opacity: 0.5, icon: 'flame' },
        c: { type: 'pen', order: 3, points: [{ x: 20, y: 20 }], color: '#0000ff', width: 6, opacity: 1, icon: null },
        d: { type: 'eraser', order: 4, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#000000', width: 10, opacity: 1, icon: null },
        e: { type: 'line', order: 5, points: [{ x: 5000, y: 5000 }, { x: 5100, y: 5000 }], color: '#000000', width: 2, opacity: 1, icon: null },
      },
    });
    createDrawingsLayer().draw(surface, frame(scene));
    expect(surface.calls).toEqual([
      { op: 'icon', name: 'flame', x: 50, y: 50, size: 70, color: '#00ff00', alpha: 0.5 },
      { op: 'paths', paths: [[{ x: 0, y: 0 }, { x: 10, y: 10 }]], closed: false, style: { stroke: '#ff0000', lineWidth: 4, alpha: 1, round: true } },
      { op: 'circle', x: 20, y: 20, radius: 3, style: { fill: '#0000ff', alpha: 1 } },
    ]);
  });
});

describe('texts layer', () => {
  it('draws a text centred on its position, its background grown by the padding at the text opacity', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({ texts: { x1: { ...text, backgroundColor: '#ffffff', padding: 0, opacity: 0.5 } } });
    createTextsLayer().draw(surface, frame(scene));
    expect(surface.calls).toEqual([
      { op: 'push', x: 50, y: 50, rotation: 0, scale: 1 },
      {
        op: 'rect', x: -44, y: expect.closeTo(-22.4), width: 88, height: expect.closeTo(44.8),
        style: { fill: '#ffffff', alpha: 0.5 },
      },
      { op: 'text', text: 'Tavern', x: 0, y: expect.closeTo(0), style: { font: '24px serif', color: '#000000', align: 'center' } },
      { op: 'pop' },
    ]);
  });

  it('rotates, scales and aligns its lines like Atlas, in its bold and italic font', () => {
    const surface = new RecordingSurface();
    const scene = playerScene({ texts: { x1: { ...text, text: 'A\nBB', align: 'left', rotation: 90, scale: 2, bold: true, italic: true } } });
    createTextsLayer().draw(surface, frame(scene));
    expect(surface.ops('push')[0]).toEqual({ op: 'push', x: 50, y: 50, rotation: expect.closeTo(Math.PI / 2), scale: 2 });
    expect(surface.ops('text').map(({ text: line, x, y, style }) => [line, x, y, style.font])).toEqual([
      ['A', -12, expect.closeTo(-14.4), 'italic bold 24px serif'],
      ['BB', -12, expect.closeTo(14.4), 'italic bold 24px serif'],
    ]);
  });

  it('skips texts off screen', () => {
    const surface = new RecordingSurface();
    createTextsLayer().draw(surface, frame(playerScene({ texts: { x1: { ...text, x: 5000 } } })));
    expect(surface.calls).toEqual([]);
  });
});
