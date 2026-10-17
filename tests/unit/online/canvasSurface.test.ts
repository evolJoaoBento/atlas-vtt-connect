import { describe, expect, it, vi } from 'vitest';
import { createCanvasSurface } from '../../../src/app/online/view/canvasSurface';

function fakeCanvas(fields: Record<string, unknown> = {}): { canvas: HTMLCanvasElement; calls: string[] } {
  const calls: string[] = [];
  const context = new Proxy(fields, {
    get: (target, key: string) => (key in target ? target[key] : (...args: unknown[]): unknown => {
      calls.push(`${key}(${args.map((arg) => (typeof arg === 'number' || typeof arg === 'string' ? arg : typeof arg)).join(',')})`);
      return key === 'measureText' ? { width: 42 } : undefined;
    }),
    set: (target, key: string, value: unknown) => {
      target[key] = value;
      calls.push(`${key}=${String(value)}`);
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
  return { canvas, calls };
}

describe('canvas surface', () => {
  it('builds rounded rectangles from arcs where roundRect does not exist', () => {
    const { canvas, calls } = fakeCanvas({ roundRect: undefined });
    createCanvasSurface(canvas)!.roundRect(0, 0, 20, 10, 50, { fill: '#000000' });
    expect(calls.filter((call) => call.startsWith('arcTo'))).toHaveLength(4);
    expect(calls).toContain('arcTo(20,0,20,10,5)');
    expect(calls).toContain('fill()');
  });

  it('restores the context when a shape cannot be traced', () => {
    const { canvas, calls } = fakeCanvas();
    const surface = createCanvasSurface(canvas)!;
    expect(() => surface.paths([[{ x: 0, y: 0 }]], false, { stroke: '#ff0000' })).not.toThrow();
    calls.length = 0;
    const throwing = fakeCanvas({ rect: () => { throw new Error('boom'); } });
    expect(() => createCanvasSurface(throwing.canvas)!.rect(0, 0, 1, 1, { fill: '#000000' })).toThrow('boom');
    expect(throwing.calls).toContain('restore()');
  });

  it('sizes the canvas and fills the background', () => {
    const { canvas, calls } = fakeCanvas();
    createCanvasSurface(canvas)!.begin(200, 100, '#000000');
    expect([canvas.width, canvas.height]).toEqual([200, 100]);
    expect(calls).toEqual(expect.arrayContaining(['fillStyle=#000000', 'fillRect(0,0,200,100)']));
  });

  it('erases with destination-out, and strokes ink with round caps', () => {
    const { canvas, calls } = fakeCanvas();
    const surface = createCanvasSurface(canvas)!;
    surface.circle(1, 2, 3, { fill: '#000000', erase: true });
    expect(calls).toEqual(expect.arrayContaining(['globalCompositeOperation=destination-out', `arc(1,2,3,0,${Math.PI * 2})`, 'fill()']));
    calls.length = 0;
    surface.paths([[{ x: 0, y: 0 }, { x: 5, y: 5 }]], false, { stroke: '#ff0000', lineWidth: 4, round: true });
    expect(calls).toEqual(expect.arrayContaining(['lineCap=round', 'moveTo(0,0)', 'lineTo(5,5)', 'lineWidth=4', 'stroke()']));
  });

  it('clips art to its circle, and never draws a negative radius', () => {
    const { canvas, calls } = fakeCanvas();
    const surface = createCanvasSurface(canvas)!;
    surface.image({} as ImageBitmap, -5, -5, 10, 10, { x: 0, y: 0, radius: 5 });
    expect(calls.indexOf('clip()')).toBeLessThan(calls.indexOf('drawImage(object,-5,-5,10,10)'));
    surface.circle(0, 0, -3, { fill: '#000000' });
    expect(calls).toContain(`arc(0,0,0,0,${Math.PI * 2})`);
  });

  it('draws text only through fillText, centred vertically, and measures it in its font', () => {
    const { canvas, calls } = fakeCanvas();
    const surface = createCanvasSurface(canvas)!;
    surface.text('<b>x</b>', 1, 2, { font: '12px serif', color: '#ffffff', align: 'center' });
    expect(calls).toEqual(expect.arrayContaining(['textBaseline=middle', 'fillText(<b>x</b>,1,2)']));
    expect(surface.measureText('abc', '12px serif')).toBe(42);
  });

  it('draws nothing for an icon Atlas does not know', () => {
    const { canvas, calls } = fakeCanvas();
    createCanvasSurface(canvas)!.icon('nope', 0, 0, 10, '#ffffff', 1);
    expect(calls).toEqual([]);
  });
});

describe("Atlas's token ring on the canvas", () => {
  it('draws Atlas\'s stand-in until the texture loads, then the texture tinted by the colour, and says when to draw again', async () => {
    const { whenTokenRingLoaded } = await import('../../../src/app/online/view/canvasSurface');
    const created: Array<{ tag: string; element: unknown; calls?: string[] }> = [];
    const RealImage = window.Image;
    const spy = vi.spyOn(window, 'Image').mockImplementation(function made(this: unknown, width?: number, height?: number) {
      const element = new RealImage(width, height);
      created.push({ tag: 'img', element });
      return element;
    } as unknown as typeof Image);
    const { canvas, calls } = fakeCanvas();
    Object.defineProperty(canvas, 'ownerDocument', { value: document });
    // The tinted copies are bare copies of the surface's canvas.
    Object.defineProperty(canvas, 'cloneNode', { value: () => {
      const tinted = fakeCanvas();
      created.push({ tag: 'canvas', element: tinted.canvas, calls: tinted.calls });
      return tinted.canvas;
    } });
    const surface = createCanvasSurface(canvas)!;

    // Not loaded: a plain ring as wide as the padding (70 − 62) / 2, in the colour; a colour that is not hex is white.
    surface.tokenRing(0, 0, 70, 62, '#E93147');
    expect(calls).toEqual(expect.arrayContaining(['strokeStyle=#e93147', 'lineWidth=4', `arc(0,0,33,0,${Math.PI * 2})`, 'globalAlpha=0.95']));
    calls.length = 0;
    surface.tokenRing(0, 0, 70, 62, 'url(javascript:1)');
    expect(calls).toContain('strokeStyle=#ffffff');

    const redraw = vi.fn();
    whenTokenRingLoaded(redraw);
    const image = created.find((entry) => entry.tag === 'img')!.element as HTMLImageElement;
    expect(image.src).toContain('token-ring');
    image.dispatchEvent(new Event('load'));
    expect(redraw).toHaveBeenCalledOnce();

    // Loaded: the texture, tinted once per colour (multiply, then its own alpha back), drawn at the ring's size.
    calls.length = 0;
    surface.tokenRing(10, 20, 70, 62, '#e93147');
    const tint = created.find((entry) => entry.tag === 'canvas')!;
    expect(tint.calls).toEqual(expect.arrayContaining(['globalCompositeOperation=multiply', 'fillStyle=#e93147', 'globalCompositeOperation=destination-in']));
    expect(calls).toContain('drawImage(object,-25,-15,70,70)');
    expect(calls.filter((call) => call.startsWith('drawImage'))).toHaveLength(1);
    surface.tokenRing(10, 20, 70, 62, '#e93147');
    expect(created.filter((entry) => entry.tag === 'canvas')).toHaveLength(1);
    spy.mockRestore();
  });
});
