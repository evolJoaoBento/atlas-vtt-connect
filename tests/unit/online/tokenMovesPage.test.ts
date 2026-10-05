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
 * over the GM's real session, broadcaster and control lists on an in-memory network. The GM's move
 * handler is `controlWorld`'s stand-in (it takes a controlled token's move as sent and refuses any
 * other); the snapping, undo step and held-scene refusal of the real handler are B10's (`tokens.move`).
 */
async function page(controlled = 'hero') {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<p id="move-notice" hidden></p></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const w = controlWorld({ scene: true });
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
  w.control.set(controlled, player.playerId, true);
  await vi.advanceTimersByTimeAsync(300);
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

  it('drags with the pointer, sends one drop, and shows the drop spot until the scene update', async () => {
    const t = await page();
    expect(t.player.controlLists().at(-1)).toEqual(['hero']);
    const start = t.heroPoint();
    pointer(t.canvas, 'pointerdown', start.x, start.y);
    pointer(t.canvas, 'pointermove', start.x + 40, start.y + 5);
    pointer(t.canvas, 'pointermove', start.x + 80, start.y + 10);
    expect(t.previews()).toBe(1);
    expect(t.w.moves).toEqual([]);
    pointer(t.canvas, 'pointerup', start.x + 80, start.y + 10);
    expect(t.w.moves).toHaveLength(1);
    expect(t.w.moves[0]).toMatchObject({ playerId: t.player.playerId, tokenId: 'hero' });
    expect(t.w.moves[0]!.x).toBeGreaterThan(140);
    // The player still shows the drop spot until the scene update arrives.
    expect(t.previews()).toBe(1);
    t.view.dispose();
    t.w.finish();
  });

  it('puts a token the GM refuses back at once, with the notice, not after the timeout', async () => {
    const t = await page('ally');
    // The GM's handler refuses this drop (a held scene, in the real one): the stand-in answers as it would.
    t.w.gm.use({
      onMessage: (player, message) => {
        if (message.type === 'token-move') t.w.gm.send(player.playerId, { v: 1, type: 'token-move-refused', tokenId: message.tokenId });
      },
    });
    const start = t.heroPoint();
    pointer(t.canvas, 'pointerdown', start.x, start.y);
    pointer(t.canvas, 'pointermove', start.x + 80, start.y);
    expect(t.previews()).toBe(1);
    pointer(t.canvas, 'pointerup', start.x + 80, start.y);
    expect(t.player.received.flatMap((message) => (message.type === 'token-move-refused' ? [message.tokenId] : []))).toEqual(['ally']);
    expect(t.previews()).toBe(0);
    expect(t.notice.hidden).toBe(false);
    expect(t.notice.textContent).toBe(MOVE_REFUSED_TEXT);
    t.view.dispose();
    t.w.finish();
  });
});
