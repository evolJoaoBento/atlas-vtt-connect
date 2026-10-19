import { describe, expect, it, vi } from 'vitest';
import { createTokensLayer } from '../../../src/app/online/view/layers/tokensLayer';
import { NO_TOKEN_OVERLAY } from '../../../src/app/online/view/layers/layerTypes';
import { createMiniLayer, type MiniFrameEntry, type MiniPainter } from '../../../src/app/online/view/minis/miniLayer';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken } from './sceneFixtures';

const GLB = 'G'.repeat(43);

/** A stand-in for the Tabletop extension's painter: it records what each frame asks for and returns a canvas. */
function fakePainter() {
  const frames: MiniFrameEntry[][] = [];
  const shaken: string[] = [];
  const disposed = vi.fn();
  const picture = { width: 1, height: 1 } as unknown as HTMLCanvasElement;
  const painter: MiniPainter = {
    version: 1,
    create: vi.fn(() => ({
      shake: (id: string) => { shaken.push(id); },
      animating: () => false,
      frame: (entries: readonly MiniFrameEntry[]) => { frames.push([...entries]); return entries.length > 0 ? picture : null; },
      dispose: disposed,
    })),
  };
  return { painter, frames, shaken, picture, disposed };
}

const canvas = (): HTMLCanvasElement => document.createElement('canvas');
const withMini = () => playerScene({ tokens: { a: playerToken({ x: 210, y: 140, rotation: 30, mini: { asset: GLB, scale: 1.2, turn: 90 } }), b: playerToken() } });
const models = (): ArrayBuffer => new ArrayBuffer(8);

describe('minis in the player view', () => {
  it('asks the painter for nothing in a scene without minis', () => {
    const fake = fakePainter();
    const layer = createTokensLayer({ now: () => 0, minis: createMiniLayer({ now: () => 0, painter: () => fake.painter, canvas }) });
    layer.draw(new RecordingSurface(), frame(playerScene({ tokens: { t: playerToken() } }), { models: () => null }));
    expect(fake.painter.create).not.toHaveBeenCalled();
  });

  it('draws the minis over the art and under the bars, where each token is drawn, and wobbles a selected one', () => {
    const fake = fakePainter();
    const layer = createTokensLayer({ now: () => 0, minis: createMiniLayer({ now: () => 0, painter: () => fake.painter, canvas }) });
    const surface = new RecordingSurface();
    layer.draw(surface, frame(withMini(), { models }));
    expect(fake.painter.create).toHaveBeenCalledTimes(1);
    expect(fake.frames.at(-1)).toEqual([{ id: 'a', asset: GLB, x: 210, y: 140, size: expect.any(Number), rotation: 30, turn: 90, scale: 1.2 }]);
    const images = surface.calls.filter((call) => call.op === 'image');
    expect(images.at(-1)).toMatchObject({ image: fake.picture, x: -100, y: -100, width: 1200, height: 1000 });
    layer.draw(new RecordingSurface(), frame(withMini(), { models, overlay: { ...NO_TOKEN_OVERLAY, selected: 'a' } }));
    expect(fake.shaken).toEqual(['a']);
  });

  it('draws nothing without Tabletop, starts when it arrives and lets go of its view when it leaves', () => {
    const fake = fakePainter();
    let painter: MiniPainter | null = null;
    const layer = createTokensLayer({ now: () => 0, minis: createMiniLayer({ now: () => 0, painter: () => painter, canvas }) });
    layer.draw(new RecordingSurface(), frame(withMini(), { models }));
    expect(fake.frames).toHaveLength(0);
    painter = fake.painter;
    layer.draw(new RecordingSurface(), frame(withMini(), { models }));
    expect(fake.frames).toHaveLength(1);
    painter = null;
    layer.draw(new RecordingSurface(), frame(withMini(), { models }));
    expect(fake.disposed).toHaveBeenCalledTimes(1);
    expect(fake.frames).toHaveLength(1);
  });

  it('keeps drawing the scene when the painter throws, and does not ask it again', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const painter: MiniPainter = { version: 1, create: vi.fn(() => { throw new Error('no WebGL'); }) };
    const layer = createTokensLayer({ now: () => 0, minis: createMiniLayer({ now: () => 0, painter: () => painter, canvas }) });
    const surface = new RecordingSurface();
    expect(() => layer.draw(surface, frame(withMini(), { models }))).not.toThrow();
    layer.draw(new RecordingSurface(), frame(withMini(), { models }));
    expect(painter.create).toHaveBeenCalledTimes(1);
    expect(surface.calls.length).toBeGreaterThan(0);
    warn.mockRestore();
  });
});
