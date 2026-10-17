import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalLaserEvent, RemoteLaser } from '@atlas-vtt/api-types';
import { LASER_LIMITS, LaserModel, checkedLaser } from '../../../src/connect/stockLasers/laserModel';
import { LaserOverlay } from '../../../src/connect/stockLasers/laserOverlay';
import { stockLasersApi, type LaserView } from '../../../src/connect/stockLasers/stockLasers';

const laser = (extra: Partial<RemoteLaser> = {}): RemoteLaser => ({ from: 'ana', color: '#ff0000', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], lifted: false, ...extra });

describe('the lasers of other people', () => {
  describe('laserModel', () => {
    it('keeps what the API contract says and refuses the rest, naming the field', () => {
      expect(() => checkedLaser(null)).toThrow(/"from"/);
      expect(() => checkedLaser(laser({ from: '' }))).toThrow(/"from"/);
      expect(() => checkedLaser(laser({ color: 'red' }))).toThrow(/"color"/);
      expect(() => checkedLaser({ ...laser(), lifted: 'no' })).toThrow(/"lifted"/);
      expect(() => checkedLaser({ ...laser(), points: 'x' })).toThrow(/"points"/);
      expect(() => checkedLaser(laser({ points: [{ x: Number.NaN, y: 1 }] }))).toThrow(/"points"/);
      expect(() => checkedLaser({ ...laser(), points: [null] })).toThrow(/"points"/);
      expect(() => checkedLaser({ ...laser(), dt: ['a'] })).toThrow(/"dt"/);
      const long = Array.from({ length: 100 }, (_, index) => ({ x: index, y: 0 }));
      const checked = checkedLaser({ ...laser(), points: long, dt: long.map((_, index) => index) });
      // Only the newest 64 points count, and each gap stays with its point.
      expect(checked.points).toHaveLength(LASER_LIMITS.points);
      expect(checked.points[0]!.x).toBe(36);
      expect(checked.dt?.[0]).toBe(36);
    });

    it('shows points fading out over the trail, and lets a laser go with its last point', () => {
      const model = new LaserModel();
      model.show(laser({ points: [{ x: 1, y: 1 }] }), 1000);
      const [fresh] = model.frame(1000);
      expect(fresh!.points[0]!.alpha).toBe(1);
      expect(fresh!.live).toBe(true);
      const [half] = model.frame(1000 + LASER_LIMITS.trailMs / 2);
      expect(half!.points[0]!.alpha).toBeCloseTo(0.5, 5);
      model.show(laser({ points: [{ x: 3, y: 3 }], lifted: true }), 1200);
      expect(model.frame(1200)[0]!.live).toBe(false);
      expect(model.frame(1000 + LASER_LIMITS.trailMs + 1)[0]!.points).toHaveLength(1);
      expect(model.frame(1200 + LASER_LIMITS.trailMs + 1)).toEqual([]);
      expect(model.active).toBe(false);
    });

    it('lets go of a laser that is not heard from for a second, and spaces points by the gaps it was told', () => {
      const model = new LaserModel();
      model.show(laser({ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], dt: [0, 100, 100] }), 5000);
      const [now] = model.frame(5000);
      expect(now!.points.map((point) => Math.round(point.alpha * 1000) / 1000)).toEqual([
        Math.round((1 - 200 / LASER_LIMITS.trailMs) * 1000) / 1000, Math.round((1 - 100 / LASER_LIMITS.trailMs) * 1000) / 1000, 1,
      ]);
      expect(model.frame(5000 + LASER_LIMITS.silenceMs + 1)[0]!.live).toBe(false);
    });

    it('caps a gap, the lasers at once and the points kept', () => {
      const model = new LaserModel();
      model.show(laser({ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], dt: [0, 100000] }), 10000);
      // The gap counts at most two seconds, so the older point is already gone from the trail.
      expect(model.frame(10000)[0]!.points).toHaveLength(1);
      const many = new LaserModel();
      for (let index = 0; index < LASER_LIMITS.lasers + 5; index++) many.show(laser({ from: `p${index}` }), 0);
      expect(many.frame(0)).toHaveLength(LASER_LIMITS.lasers);
      const long = new LaserModel();
      for (let index = 0; index < 10; index++) long.show(laser({ points: Array.from({ length: 64 }, () => ({ x: 1, y: 1 })) }), 0);
      expect(long.frame(0)[0]!.points.length).toBeLessThanOrEqual(LASER_LIMITS.kept);
    });

    it('takes a laser of another colour as the same laser', () => {
      const model = new LaserModel();
      model.show(laser(), 0);
      model.show(laser({ color: '#00ff00' }), 10);
      const shown = model.frame(10);
      expect(shown).toHaveLength(1);
      expect(shown[0]!.color).toBe('#00ff00');
    });
  });

  describe('onLocal', () => {
    /** Atlas's laser pointer renderer as it is: its methods are on the prototype, and a point too near the last is not added. */
    class FakePointer {
      trailPoints: Array<{ x: number; y: number }> = [];
      isPointing = false;
      redraws = 0;
      addTrailPoint(x: number, y: number): void {
        const last = this.trailPoints.at(-1);
        if (last && Math.hypot(x - last.x, y - last.y) < 2) return;
        this.trailPoints.push({ x, y });
      }
      redraw(): void {
        this.redraws++;
      }
    }

    function setup(options: { pointer?: unknown } = {}) {
      const pointer = options.pointer === undefined ? new FakePointer() : options.pointer;
      const view: LaserView = { viewId: 'v1', renderer: { laserPointerRenderer: pointer } };
      let open = true;
      const added: Array<() => void> = [];
      const api = stockLasersApi({
        view: (id) => (open && id === 'v1' ? view : null),
        add: (dispose) => { added.push(dispose); return () => { const at = added.indexOf(dispose); if (at >= 0) added.splice(at, 1); dispose(); }; },
      });
      return { api, pointer: pointer as FakePointer, close: () => { open = false; }, unload: () => { for (const dispose of added.splice(0)) dispose(); } };
    }

    it('hears each point of the GM\'s laser and its being let go, with Atlas\'s own methods still running first', () => {
      const t = setup();
      const events: LocalLaserEvent[] = [];
      t.api.onLocal('v1', (event) => events.push(event));
      t.pointer.isPointing = true;
      t.pointer.addTrailPoint(10, 10);
      // Too near the last point: Atlas adds none, so nothing is said.
      t.pointer.addTrailPoint(10.5, 10.5);
      t.pointer.addTrailPoint(30, 30);
      t.pointer.redraw();
      expect(events).toEqual([{ kind: 'point', x: 10, y: 10 }, { kind: 'point', x: 30, y: 30 }]);
      t.pointer.isPointing = false;
      t.pointer.redraw();
      expect(events.at(-1)).toEqual({ kind: 'lift' });
      // Atlas's own redraw ran each time.
      expect(t.pointer.redraws).toBe(2);
      t.pointer.redraw();
      expect(events.filter((event) => event.kind === 'lift')).toHaveLength(1);
      expect(Object.isFrozen(events[0])).toBe(true);
    });

    it('puts Atlas\'s methods back with the last listener, and hooks once for many', () => {
      const t = setup();
      const first: string[] = [];
      const second: string[] = [];
      const stopFirst = t.api.onLocal('v1', (event) => first.push(event.kind));
      const stopSecond = t.api.onLocal('v1', (event) => second.push(event.kind));
      t.pointer.isPointing = true;
      t.pointer.addTrailPoint(1, 1);
      expect(first).toEqual(['point']);
      expect(second).toEqual(['point']);
      expect(Object.hasOwn(t.pointer, 'addTrailPoint')).toBe(true);
      stopFirst();
      t.pointer.addTrailPoint(50, 50);
      expect(first).toEqual(['point']);
      expect(second).toEqual(['point', 'point']);
      stopSecond();
      expect(Object.hasOwn(t.pointer, 'addTrailPoint')).toBe(false);
      expect(Object.hasOwn(t.pointer, 'redraw')).toBe(false);
      t.pointer.addTrailPoint(90, 90);
      expect(second).toHaveLength(2);
    });

    it('lets go of everything when Atlas unloads, and one failing listener harms nobody', () => {
      const t = setup();
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const heard: string[] = [];
      t.api.onLocal('v1', () => { throw new Error('listener'); });
      t.api.onLocal('v1', (event) => heard.push(event.kind));
      t.pointer.addTrailPoint(1, 1);
      expect(heard).toEqual(['point']);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
      t.unload();
      expect(Object.hasOwn(t.pointer, 'addTrailPoint')).toBe(false);
    });

    it('hears nothing, and never throws, where the renderer is not as expected', () => {
      for (const pointer of [undefined, null, {}, { trailPoints: [], isPointing: true }, { trailPoints: 'x', isPointing: true, addTrailPoint: () => undefined, redraw: () => undefined }]) {
        const t = setup({ pointer });
        expect(() => t.api.onLocal('v1', () => undefined)()).not.toThrow();
      }
      expect(() => setup().api.onLocal('nope', () => undefined)()).not.toThrow();
      expect(() => setup().api.onLocal('v1', 'x' as never)()).not.toThrow();
    });
  });

  describe('show', () => {
    it('throws for a malformed laser, also for a view that is not there, and does nothing for one', () => {
      const api = stockLasersApi({ view: () => null, add: () => () => undefined });
      expect(() => api.show('nope', laser({ color: 'red' }))).toThrow(/"color"/);
      expect(() => api.show('nope', laser())).not.toThrow();
    });
  });

  describe('overlay', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    function overlayOf(isOpen = () => true) {
      const canvas = document.createElement('canvas');
      document.body.appendChild(canvas);
      canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 400, height: 300, right: 410, bottom: 320, x: 10, y: 20, toJSON: () => ({}) });
      const frames: Array<() => void> = [];
      const win = canvas.ownerDocument.defaultView!;
      vi.spyOn(win, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(() => callback(0)); return frames.length; });
      vi.spyOn(win, 'cancelAnimationFrame').mockImplementation(() => undefined);
      const calls: string[] = [];
      const context = new Proxy({} as Record<string, unknown>, {
        get: (target, name: string) => (name in target ? target[name] : (...args: unknown[]) => { calls.push(`${name}(${args.join(',')})`); }),
        set: (target, name: string, value) => { target[name] = value; return true; },
      });
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
      let now = 0;
      const places: Array<[number, number]> = [];
      const overlay = new LaserOverlay({ canvas: () => canvas, toScreen: (x, y) => { places.push([x, y]); return { x: x * 2, y: y * 2 }; }, isOpen }, () => now);
      const step = (): void => { frames.splice(0).forEach((frame) => frame()); };
      return { overlay, step, places, calls, advance: (ms: number) => { now += ms; }, canvas, frames };
    }

    it('lays a canvas over the view, right after its canvas, while a laser shows, and takes it away when nothing is left', () => {
      const t = overlayOf();
      Object.defineProperty(t.canvas, 'offsetLeft', { value: 10 });
      Object.defineProperty(t.canvas, 'offsetTop', { value: 20 });
      t.overlay.show(laser());
      expect(document.querySelector('.atlas-connect-lasers')).toBeNull();
      t.step();
      const element = document.querySelector<HTMLElement>('.atlas-connect-lasers')!;
      expect(element).not.toBeNull();
      // Beside the map's canvas, below the view's panels: placed in their shared containing block.
      expect(element.previousElementSibling).toBe(t.canvas);
      expect(element.style.position).toBe('absolute');
      expect(element.style.left).toBe('10px');
      expect(element.style.top).toBe('20px');
      expect(element.style.display).toBe('block');
      // The points of the laser, placed by the view's own camera: one line between them, and the glowing head.
      expect(t.places).toEqual([[1, 1], [2, 2]]);
      expect(t.calls).toEqual(expect.arrayContaining(['moveTo(2,2)', 'lineTo(4,4)', 'arc(4,4,7,0,6.283185307179586)']));
      t.advance(LASER_LIMITS.trailMs + 1);
      t.overlay.show(laser({ from: 'bea', points: [], lifted: true }));
      t.step();
      expect(element.style.display).toBe('none');
      t.overlay.dispose();
      expect(document.querySelector('.atlas-connect-lasers')).toBeNull();
    });

    it('is gone with its view, and a new laser after that makes a new one', () => {
      let open = true;
      const t = overlayOf(() => open);
      t.overlay.show(laser());
      t.step();
      open = false;
      t.overlay.show(laser());
      t.step();
      expect(document.querySelector('.atlas-connect-lasers')).toBeNull();
      expect(t.overlay.isDisposed).toBe(true);
    });
  });
});
