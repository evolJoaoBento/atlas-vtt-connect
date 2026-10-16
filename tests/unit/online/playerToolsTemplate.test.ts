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
  it('a drag places the measure shape as a template, drawn while dragged', () => {
    const t = setup();
    t.tools.selectShape('cone');
    t.tools.select('template');
    expect(t.tools.grab({ x: 100, y: 100 }, 'mouse')).toBe(true);
    t.tools.move({ x: 160, y: 100 });
    expect(t.tools.overlay().templates).toEqual([expect.objectContaining({ id: 'draft', shape: 'cone', end: { x: 160, y: 100 } })]);
    t.tools.drop({ x: 160, y: 100 });
    expect(t.changes).toEqual([{ add: { shape: 'cone', start: { x: 100, y: 100 }, end: { x: 160, y: 100 } } }]);
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
