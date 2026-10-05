import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from '../../../online-client/mapView.mts';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { toolsWorld } from './toolsFixtures';
import type { ControlPlayer } from './controlFixtures';

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

/** What `main.mts` does for the tools: a `MapView` whose laser goes through a real `PlayerSession` to the GM. */
async function page(extra: Partial<ConstructorParameters<typeof MapView>[0]> = {}) {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<p id="move-notice" hidden></p></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const w = toolsWorld();
  let player: ControlPlayer | null = null;
  const view = new MapView({
    canvas, surface: new RecordingSurface(), images: () => null, frames: fakeFrames(), isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: (tokenId, x, y) => player?.session.sendTokenMove(tokenId, x, y) ?? false,
    sendLaser: (points, lifted, dt, color) => player?.session.sendLaser(points, lifted, dt, color) ?? false,
    notice: element('move-notice'),
    ...extra,
  });
  w.present();
  const seen: string[] = [];
  player = await w.join('A', {
    onChange: (state) => {
      view.setConnected(state.status === 'admitted');
      view.setPlayers(state.players.map((entry) => entry.playerId), state.playerId);
    },
    onScene: (scene) => view.setScene(scene),
    onLaser: (laser) => view.receiveLaser(laser),
  });
  const other = await w.join('B');
  w.gm.use({ onMessage: (_player, message) => { seen.push(message.type); } });
  return { w, view, canvas, seen, player: player!, other };
}

/** A move whose frame the browser merged with earlier moves, as a mouse reports many a frame. */
function mergedMove(target: EventTarget, earlier: Array<[number, number, number]>, x: number, y: number, time: number): void {
  const coalesced = earlier.map(([ex, ey, et]) => {
    const e = new MouseEvent('pointermove', { clientX: ex, clientY: ey, button: 0 });
    Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'mouse' }, timeStamp: { value: et } });
    return e;
  });
  const event = new MouseEvent('pointermove', { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, {
    pointerId: { value: 1 }, pointerType: { value: 'mouse' }, timeStamp: { value: time }, getCoalescedEvents: { value: () => coalesced },
  });
  target.dispatchEvent(event);
}

describe('the player tools on the join page', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('never sends a measurement, and sends the laser to the other players until it is let go', async () => {
    const { w, view, canvas, seen, player, other } = await page();
    view.selectTool('measure');
    pointer(canvas, 'pointerdown', 300, 300);
    pointer(canvas, 'pointermove', 400, 300);
    pointer(canvas, 'pointerup', 400, 300);
    expect(seen).toEqual([]);
    view.selectTool('laser');
    pointer(canvas, 'pointerdown', 300, 300);
    pointer(canvas, 'pointermove', 400, 300);
    pointer(canvas, 'pointerup', 400, 300);
    await vi.advanceTimersByTimeAsync(100);
    expect(new Set(seen)).toEqual(new Set(['laser']));
    const relayed = w.lasersOf(other);
    expect(relayed.every((laser) => laser.from === player.playerId)).toBe(true);
    expect(relayed.at(-1)?.lifted).toBe(true);
    w.finish();
  });

  it("sends the laser's merged pointer moves, each with its own time", async () => {
    const { w, view, canvas, other } = await page();
    view.selectTool('laser');
    pointer(canvas, 'pointerdown', 300, 300);
    mergedMove(canvas, [[340, 300, 1010], [380, 300, 1020]], 420, 300, 1030);
    await vi.advanceTimersByTimeAsync(100);
    const sent = w.lasersOf(other).flatMap((laser) => laser.points.map((point, index) => ({ x: point.x, dt: laser.dt?.[index] })));
    const xs = sent.map((point) => point.x);
    expect(xs).toHaveLength(new Set(xs).size);
    expect(xs.length).toBeGreaterThanOrEqual(4);
    const gaps = sent.slice(-2).map((point) => point.dt);
    expect(gaps).toEqual([10, 10]);
    w.finish();
  });

  it('sends the laser in the picked color, remembers the pick and tells the toolbar', async () => {
    const remembered: string[] = [];
    let changes = 0;
    const { w, view, canvas, other } = await page({
      laserColor: '#ffffff', onLaserColor: (color) => remembered.push(color), onToolsChange: () => { changes += 1; },
    });
    expect(view.toolState().laserColor).toBe('#ffffff');
    view.selectLaserColor('#00A9FF');
    expect(remembered).toEqual(['#00a9ff']);
    expect(view.toolState()).toMatchObject({ tool: 'laser', laserColor: '#00a9ff' });
    expect(changes).toBeGreaterThan(0);
    pointer(canvas, 'pointerdown', 300, 300);
    pointer(canvas, 'pointermove', 400, 300);
    pointer(canvas, 'pointerup', 400, 300);
    await vi.advanceTimersByTimeAsync(100);
    expect(w.lasersOf(other).every((laser) => laser.color === '#00a9ff')).toBe(true);
    expect(w.shown().at(-1)?.color).toBe('#00a9ff');
    view.selectLaserColor('#123456');
    expect(remembered).toHaveLength(1);
    w.finish();
  });
});
