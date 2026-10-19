import { describe, expect, it, vi } from 'vitest';
import { createTokensLayer } from '../../../src/app/online/view/layers/tokensLayer';
import { NO_TOKEN_OVERLAY } from '../../../src/app/online/view/layers/layerTypes';
import { createMiniLayer } from '../../../src/app/online/view/minis/miniLayer';
import type { MiniFrameEntry, MiniRenderer } from '../../../src/app/online/view/minis/miniRenderer';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken } from './sceneFixtures';
import { settle } from './assetFixtures';

const GLB = 'G'.repeat(43);

/** A stand-in for the three.js renderer: it records what each frame asks for and returns a canvas. */
function fakeRenderer() {
  const frames: MiniFrameEntry[][] = [];
  const shaken: string[] = [];
  const picture = { width: 1, height: 1 } as unknown as HTMLCanvasElement;
  class Fake {
    shake(id: string): void { shaken.push(id); }
    animating(): boolean { return false; }
    frame(entries: readonly MiniFrameEntry[]): HTMLCanvasElement | null { frames.push([...entries]); return entries.length > 0 ? picture : null; }
    dispose(): void {}
  }
  const load = vi.fn(async () => ({ MiniRenderer: Fake as unknown as new (canvas: HTMLCanvasElement, loaded: () => void) => MiniRenderer }));
  return { load, frames, shaken, picture };
}

describe('minis in the player view', () => {
  it('never loads three.js for a scene without minis', () => {
    const fake = fakeRenderer();
    const layer = createTokensLayer({ now: () => 0, minis: createMiniLayer({ now: () => 0, load: fake.load, canvas: () => document.createElement('canvas') }) });
    layer.draw(new RecordingSurface(), frame(playerScene({ tokens: { t: playerToken() } }), { models: () => null }));
    expect(fake.load).not.toHaveBeenCalled();
  });

  it('draws the minis over the art and under the bars, where each token is drawn, and wobbles a selected one', async () => {
    const fake = fakeRenderer();
    const minis = createMiniLayer({ now: () => 0, load: fake.load, canvas: () => document.createElement('canvas') });
    const layer = createTokensLayer({ now: () => 0, minis });
    const scene = playerScene({ tokens: { a: playerToken({ x: 210, y: 140, rotation: 30, mini: { asset: GLB, scale: 1.2, turn: 90 } }), b: playerToken() } });
    const models = (): ArrayBuffer => new ArrayBuffer(8);
    layer.draw(new RecordingSurface(), frame(scene, { models }));
    expect(fake.load).toHaveBeenCalledTimes(1);
    await settle();
    expect(layer.animating?.()).toBe(true); // three.js arrived: draw again
    const surface = new RecordingSurface();
    layer.draw(surface, frame(scene, { models }));
    expect(fake.frames.at(-1)).toEqual([{ id: 'a', asset: GLB, x: 210, y: 140, size: expect.any(Number), rotation: 30, turn: 90, scale: 1.2 }]);
    const images = surface.calls.filter((call) => call.op === 'image');
    expect(images.at(-1)).toMatchObject({ image: fake.picture, x: -100, y: -100, width: 1200, height: 1000 });
    layer.draw(new RecordingSurface(), frame(scene, { models, overlay: { ...NO_TOKEN_OVERLAY, selected: 'a' } }));
    expect(fake.shaken).toEqual(['a']);
  });
});
