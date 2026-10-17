import { describe, expect, it } from 'vitest';
import type { ScenePoint } from '../../../src/app/online/scene/sceneTypes';
import { TokenMoves } from '../../../src/app/online/view/TokenMoves';
import { PlayerTools, type TemplateChange } from '../../../src/app/online/view/tools/PlayerTools';
import { playerScene } from './sceneFixtures';

function setup() {
  const identity = (point: ScenePoint): ScenePoint => ({ x: point.x, y: point.y });
  const moves = new TokenMoves({ toWorld: identity, send: () => true, onChange: () => {} });
  const changes: TemplateChange[] = [];
  const pinged: Array<[number, number]> = [];
  const tools = new PlayerTools({
    moves, toWorld: identity, zoom: () => 1, now: () => 0, sendLaser: () => true, onChange: () => {},
    sendTemplate: (change) => { changes.push(change); return true; },
    sendPing: (x, y) => { pinged.push([x, y]); return true; },
  });
  const scene = playerScene();
  tools.setScene(scene);
  tools.setPlayers(['me'], 'me');
  tools.setConnected(true);
  return { tools, changes, pinged, sceneId: scene.sceneId };
}

describe("the player's Template and Ping tools", () => {
  it("a drag places the Template tool's own shape, drawn while dragged with its size", () => {
    const t = setup();
    t.tools.selectShape('line');
    t.tools.selectTemplateShape('cone');
    expect(t.tools.tool).toBe('template');
    expect(t.tools.grab({ x: 100, y: 100 }, 'mouse')).toBe(true);
    t.tools.move({ x: 160, y: 100 });
    expect(t.tools.overlay().templates).toEqual([expect.objectContaining({ id: 'draft', shape: 'cone', start: { x: 105, y: 105 }, end: { x: 175, y: 105 }, label: '5ft' })]);
    t.tools.drop({ x: 160, y: 100 });
    // Snapped to cell centres, as a measurement is while the GM snaps to the grid.
    expect(t.changes).toEqual([{ add: { shape: 'cone', start: { x: 105, y: 105 }, end: { x: 175, y: 105 } } }]);
    expect(t.tools.overlay().templates).toEqual([]);
  });

  it("a tap removes the player's own template under it, never someone else's", () => {
    const t = setup();
    t.tools.receiveTemplates(t.sceneId, [
      { id: 't1', owner: 'other', shape: 'circle', start: { x: 100, y: 100 }, end: { x: 150, y: 100 }, color: '#ff0000' },
      { id: 't2', owner: 'me', shape: 'circle', start: { x: 300, y: 100 }, end: { x: 350, y: 100 }, color: '#00ff00' },
    ]);
    t.tools.select('template');
    t.tools.grab({ x: 110, y: 100 }, 'mouse');
    t.tools.drop({ x: 110, y: 100 });
    t.tools.grab({ x: 310, y: 100 }, 'mouse');
    t.tools.drop({ x: 310, y: 100 });
    expect(t.changes).toEqual([{ remove: 't2' }]);
  });

  it('a tap the map hands over as a tap, not a drop, removes the template under it', () => {
    const t = setup();
    t.tools.receiveTemplates(t.sceneId, [{ id: 't1', owner: 'me', shape: 'circle', start: { x: 300, y: 100 }, end: { x: 350, y: 100 }, color: '#00ff00' }]);
    t.tools.select('template');
    t.tools.grab({ x: 310, y: 100 }, 'mouse');
    t.tools.tap({ x: 310, y: 100 });
    expect(t.changes).toEqual([{ remove: 't1' }]);
    expect(t.tools.overlay().templates.map((template) => template.id)).toEqual(['t1']);
  });

  it('a tap a little beside a thin line still removes it', () => {
    const t = setup();
    t.tools.receiveTemplates(t.sceneId, [{ id: 't1', owner: 'me', shape: 'line', start: { x: 100, y: 100 }, end: { x: 300, y: 100 }, color: '#00ff00' }]);
    t.tools.select('template');
    t.tools.grab({ x: 200, y: 110 }, 'mouse');
    t.tools.drop({ x: 200, y: 110 });
    expect(t.changes).toEqual([{ remove: 't1' }]);
  });

  it("clears the player's own templates in one ask, offered only while they have some", () => {
    const t = setup();
    expect(t.tools.hasOwnTemplates()).toBe(false);
    expect(t.tools.clearOwnTemplates()).toBe(false);
    t.tools.receiveTemplates(t.sceneId, [{ id: 't1', owner: 'me', shape: 'square', start: { x: 0, y: 0 }, end: { x: 70, y: 70 }, color: '#00ff00' }]);
    expect(t.tools.hasOwnTemplates()).toBe(true);
    expect(t.tools.clearOwnTemplates()).toBe(true);
    expect(t.changes).toEqual([{ clear: true }]);
  });

  it('labels a square with its side and snaps its corners to the grid while snapping is on', () => {
    const t = setup();
    const scene = playerScene();
    t.tools.setScene({ ...scene, measurement: { ...scene.measurement, snapToGrid: true } });
    t.tools.selectTemplateShape('square');
    t.tools.grab({ x: 72, y: 68 }, 'mouse');
    t.tools.move({ x: 208, y: 141 });
    const [draft] = t.tools.overlay().templates;
    expect(draft).toMatchObject({ shape: 'square', start: { x: 70, y: 70 }, end: { x: 210, y: 140 } });
    expect(draft!.label).toMatch(/10/);
  });

  it('a ping tap pings once, shown here at once', () => {
    const t = setup();
    t.tools.select('ping');
    t.tools.grab({ x: 40, y: 50 }, 'mouse');
    t.tools.drop({ x: 40, y: 50 });
    expect(t.pinged).toEqual([[40, 50]]);
    expect(t.tools.overlay().pings.length).toBeGreaterThan(0);
    expect(t.tools.isAnimating()).toBe(true);
  });
});
