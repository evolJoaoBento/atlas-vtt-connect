import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapView } from '../../../online-client/mapView.mts';
import { MOVE_REFUSED_TEXT, REFUSED_NOTICE_MS } from '../../../src/app/online/view/TokenMoves';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

function pointer(target: EventTarget, type: string, x: number, y: number): void {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  target.dispatchEvent(event);
}

function setup() {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button">Follow GM</button>',
    '<button id="fit-map" type="button">Fit map</button></div>',
    '<p id="move-notice" hidden></p>',
    '<button id="menu-button" type="button">Menu</button></section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const frames = fakeFrames();
  const surface = new RecordingSurface();
  const sent: Array<[string, number, number]> = [];
  const view = new MapView({
    canvas, surface, images: () => null, frames, isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: (tokenId, x, y) => {
      sent.push([tokenId, x, y]);
      return true;
    },
    sendLaser: () => true,
    notice: element('move-notice'),
  });
  return {
    view, canvas, surface, frames, sent, notice: element('move-notice'),
    buttons: element('view-buttons'), follow: element<HTMLButtonElement>('follow-gm'), menu: element('menu-button'),
  };
}

/**
 * `playerScene`'s 1000 × 800 map fits the 800 × 600 canvas at zoom 0.71 around (500, 400),
 * so t1, at world (100, 100), is at canvas (116, 87).
 */
function withToken(t: ReturnType<typeof setup>): void {
  t.view.setScene(playerScene());
  t.view.setConnected(true);
  t.view.setControlled(['t1']);
}

describe('MapView', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('watches the pixel ratio once however often it measures, and stops on dispose', () => {
    const listeners = new Set<() => void>();
    const matchMedia = vi.fn((query: string) => ({
      matches: false, media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    const t = setup();
    t.view.measure();
    t.view.measure();
    t.view.measure();
    expect(listeners.size).toBe(1);
    vi.stubGlobal('devicePixelRatio', 3);
    t.view.measure();
    expect(listeners.size).toBe(1);
    t.view.dispose();
    expect(listeners.size).toBe(0);
  });

  it('breaks away on a drag on the map, and Follow GM brings it back', () => {
    const t = setup();
    t.view.setScene(playerScene());
    expect(t.buttons.hidden).toBe(true);
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    pointer(t.canvas, 'pointerup', 160, 100);
    expect(t.buttons.hidden).toBe(false);
    t.follow.click();
    expect(t.buttons.hidden).toBe(true);
  });

  it('does not move the map for a gesture that starts on a button', () => {
    const t = setup();
    t.view.setScene(playerScene());
    pointer(t.menu, 'pointerdown', 100, 100);
    pointer(t.menu, 'pointermove', 300, 100);
    pointer(t.canvas, 'pointermove', 320, 100);
    pointer(t.canvas, 'pointerup', 320, 100);
    expect(t.buttons.hidden).toBe(true);
  });

  it('draws the scene in the next frame at the canvas size', () => {
    const t = setup();
    t.view.setScene(playerScene());
    t.frames.run();
    expect(t.surface.ops('begin')[0]).toMatchObject({ width: 800, height: 600 });
    expect(t.surface.ops('drawLayer')).toHaveLength(1);
  });

  it('hides Follow GM and Fit map when no scene is shown', () => {
    const t = setup();
    t.view.setScene(playerScene());
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    t.view.setScene(null);
    expect(t.buttons.hidden).toBe(true);
  });
  it('stops listening once disposed', () => {
    const t = setup();
    t.view.setScene(playerScene());
    t.view.dispose();
    pointer(t.canvas, 'pointerdown', 100, 100);
    pointer(t.canvas, 'pointermove', 160, 100);
    expect(t.buttons.hidden).toBe(true);
  });

  it('drags a controlled token with the mouse and sends one move on release, still following the GM', () => {
    const t = setup();
    withToken(t);
    pointer(t.canvas, 'pointerdown', 116, 87);
    pointer(t.canvas, 'pointermove', 166, 87);
    pointer(t.canvas, 'pointermove', 216, 87);
    expect(t.sent).toEqual([]);
    pointer(t.canvas, 'pointerup', 216, 87);
    expect(t.sent).toHaveLength(1);
    const [tokenId, x, y] = t.sent[0]!;
    expect(tokenId).toBe('t1');
    expect(x).toBeCloseTo(100 + 100 / 0.71);
    expect(y).toBeCloseTo(100);
    expect(t.buttons.hidden).toBe(true);
  });

  it('shows a grab hand over a controlled token, and grabbing while it is held', () => {
    const t = setup();
    withToken(t);
    pointer(t.canvas, 'pointermove', 116, 87);
    expect(t.canvas.classList.contains('can-grab')).toBe(true);
    pointer(t.canvas, 'pointermove', 600, 500);
    expect(t.canvas.classList.contains('can-grab')).toBe(false);
    pointer(t.canvas, 'pointermove', 116, 87);
    pointer(t.canvas, 'pointerdown', 116, 87);
    expect(t.canvas.classList.contains('is-grabbing')).toBe(true);
    expect(t.canvas.classList.contains('can-grab')).toBe(false);
    pointer(t.canvas, 'pointerup', 116, 87);
    expect(t.canvas.classList.contains('is-grabbing')).toBe(false);
  });

  it('cancels a drag on Escape and sends nothing', () => {
    const t = setup();
    withToken(t);
    pointer(t.canvas, 'pointerdown', 116, 87);
    pointer(t.canvas, 'pointermove', 216, 87);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    pointer(t.canvas, 'pointerup', 216, 87);
    expect(t.sent).toEqual([]);
  });

  it('shows "Move not allowed." for a few seconds after a refusal', () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      withToken(t);
      t.view.moveRefused('t1');
      expect(t.notice.hidden).toBe(false);
      expect(t.notice.textContent).toBe(MOVE_REFUSED_TEXT);
      vi.advanceTimersByTime(REFUSED_NOTICE_MS);
      expect(t.notice.hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds a waypoint on Space during a drag, and presses no focused button', () => {
    const t = setup();
    withToken(t);
    let pressed = 0;
    t.menu.addEventListener('click', () => { pressed++; });
    t.menu.focus();
    pointer(t.canvas, 'pointerdown', 116, 87);
    expect(document.activeElement).not.toBe(t.menu);
    pointer(t.canvas, 'pointermove', 216, 87);
    const space = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    document.body.dispatchEvent(space);
    expect(space.defaultPrevented).toBe(true);
    pointer(t.canvas, 'pointermove', 216, 187);
    t.frames.run();
    // (105, 105) → (245, 105) → (245, 245): four cells of 5 ft.
    expect(t.surface.ops('text').map((call) => call.text)).toContain('20ft');
    expect(pressed).toBe(0);
  });

  it('measures with the Measure tool without breaking away, and Escape returns to Move', () => {
    const t = setup();
    t.view.setScene(playerScene());
    t.view.setConnected(true);
    t.view.selectTool('measure');
    expect(t.canvas.dataset.tool).toBe('measure');
    pointer(t.canvas, 'pointerdown', 116, 87);
    pointer(t.canvas, 'pointermove', 216, 87);
    t.frames.run();
    expect(t.surface.ops('text').map((call) => call.text)).toContain('10ft');
    expect(t.buttons.hidden).toBe(true);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(t.view.toolState().tool).toBe('move');
    expect(t.canvas.dataset.tool).toBe('move');
  });
});
