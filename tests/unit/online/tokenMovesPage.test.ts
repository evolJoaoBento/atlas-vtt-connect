import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapView } from '../../../online-client/mapView.mts';
import { MOVE_REFUSED_TEXT } from '../../../src/app/online/view/TokenMoves';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { controlWorld, type ControlPlayer } from './controlFixtures';

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

/**
 * What `main.mts` does: a `PlayerSession` feeding a `MapView` (`TokenMoves` + `ViewInput`),
 * over the GM's real session, broadcaster and token control host (moves through `tokens.move` of a fake
 * Atlas) on an in-memory network.
 */
async function page() {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<p id="move-notice" hidden></p></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const w = controlWorld();
  let player: ControlPlayer | null = null;
  const view = new MapView({
    canvas, surface: new RecordingSurface(), images: () => null, frames: fakeFrames(), isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: (tokenId, x, y) => player?.session.sendTokenMove(tokenId, x, y) ?? false,
    sendLaser: () => false,
    notice: element('move-notice'),
  });
  w.present();
  player = await w.join('A', {
    onChange: (state) => view.setConnected(state.status === 'admitted'),
    onScene: (scene) => view.setScene(scene),
    onCamera: (camera) => view.setGmCamera(camera),
    onControl: (tokenIds) => view.setControlled(tokenIds),
    onMoveRefused: (tokenId) => view.moveRefused(tokenId),
  });
  view.setConnected(true);
  w.control.set('hero', player.playerId, true);
  await w.tick();
  const previews = (): number => (view as unknown as { moves: { overlay(): { positions: Map<string, unknown> } } }).moves.overlay().positions.size;
  /** Finds the hero on the canvas by the grab cursor the view shows over it. */
  const heroPoint = (): { x: number; y: number } => {
    for (let y = 0; y < 600; y += 3) {
      for (let x = 0; x < 800; x += 3) {
        pointer(canvas, 'pointermove', x, y);
        if (canvas.classList.contains('can-grab')) return { x: x + 2, y: y + 2 };
      }
    }
    throw new Error('the controlled token is not on the canvas');
  };
  return { w, view, canvas, player, previews, heroPoint, notice: element('move-notice') };
}

describe('players moving their tokens on the join page', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('drags with the pointer, snaps in the GM store with one undo step, and settles on the patch', async () => {
    const t = await page();
    expect(t.player.controlLists().at(-1)).toEqual(['hero']);
    const start = t.heroPoint();
    const steps = t.w.undoSteps();
    pointer(t.canvas, 'pointerdown', start.x, start.y);
    pointer(t.canvas, 'pointermove', start.x + 40, start.y + 5);
    pointer(t.canvas, 'pointermove', start.x + 80, start.y + 10);
    expect(t.previews()).toBe(1);
    expect(t.w.token('hero')).toMatchObject({ x: 140, y: 140 });
    pointer(t.canvas, 'pointerup', start.x + 80, start.y + 10);
    const moved = t.w.token('hero')!;
    expect(moved.x).toBeGreaterThan(140);
    expect((moved.x - 35) % 70).toBe(0);
    expect((moved.y - 35) % 70).toBe(0);
    expect(t.w.undoSteps()).toBe(steps + 1);
    // The player still shows the drop spot until the scene update arrives.
    expect(t.previews()).toBe(1);
    await t.w.tick();
    expect(t.player.session.scene?.tokens.hero).toMatchObject({ x: moved.x, y: moved.y });
    expect(t.previews()).toBe(0);
    t.w.undo();
    expect(t.w.token('hero')).toMatchObject({ x: 140, y: 140 });
    t.view.dispose();
    t.w.finish();
  });

  it('puts a token dropped in a held scene back at once, with the notice, not after the timeout', async () => {
    const t = await page();
    const start = t.heroPoint();
    t.w.tabs.getState().setActiveTab(t.w.dungeon);
    expect(t.w.presented.isHeld()).toBe(true);
    pointer(t.canvas, 'pointerdown', start.x, start.y);
    pointer(t.canvas, 'pointermove', start.x + 80, start.y);
    pointer(t.canvas, 'pointerup', start.x + 80, start.y);
    expect(t.player.refusals()).toEqual(['hero']);
    expect(t.previews()).toBe(0);
    expect(t.notice.hidden).toBe(false);
    expect(t.notice.textContent).toBe(MOVE_REFUSED_TEXT);
    expect(t.w.token('hero')).toMatchObject({ x: 140, y: 140 });
    expect(t.w.undoSteps()).toBe(0);
    t.view.dispose();
    t.w.finish();
  });
});
