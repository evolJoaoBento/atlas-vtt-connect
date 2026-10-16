import { describe, expect, it } from 'vitest';
import { DARKNESS_FOG_ID } from '../../../src/app/online/scene/darknessFog';
import { CONTROLLED_RING_COLOR, createTokensLayer, DOWNED_VEIL, TOKEN_MARKER_COLOR, TURN_RING_COLOR } from '../../../src/app/online/view/layers/tokensLayer';
import { NEUTRAL_BADGE_COLOR } from '../../../src/app/online/view/layers/tokenUiDrawing';
import type { PlayerToken } from '../../../src/app/online/scene/sceneTypes';
import type { TokenOverlay } from '../../../src/app/online/view/layers/layerTypes';
import { decodedImage, frame, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken } from './sceneFixtures';

const art = decodedImage(200, 100);
const images = (id: string | null): typeof art | null => (id === 'asset-1' ? art : null);

function draw(tokens: Record<string, PlayerToken>, withImages = false): RecordingSurface {
  const surface = new RecordingSurface();
  // No fight: the turn ring has its own test.
  createTokensLayer().draw(surface, frame({ ...playerScene({ tokens }), initiative: null }, withImages ? { images } : {}));
  return surface;
}

describe('tokens layer', () => {
  it("clips the art to its circle, cover-fit, and draws Atlas's ring texture over it at Atlas's size", () => {
    expect(draw({ t1: playerToken() }, true).calls).toEqual([
      { op: 'push', x: 100, y: 100, rotation: 0, scale: 1 },
      { op: 'image', image: art.image, x: -62, y: -31, width: 124, height: 62, clip: { x: 0, y: 0, radius: 31 } },
      // The art's 62 plus the 4 px stroke on each side, as SpriteFactory.createTokenRing sizes its sprite.
      { op: 'tokenRing', x: 0, y: 0, diameter: 70, artSize: 62, color: '#ffffff' },
      { op: 'pop' },
    ]);
  });

  it('draws the ring in the colour the GM chose for the token', () => {
    expect(draw({ t1: playerToken({ ring: '#e93147' }) }, true).ops('tokenRing')).toEqual([
      { op: 'tokenRing', x: 0, y: 0, diameter: 70, artSize: 62, color: '#e93147' },
    ]);
  });

  it('draws a marker until the art has loaded, turned by the rotation, without a ring when it is off', () => {
    expect(draw({ t1: playerToken({ rotation: 90, ring: null }) }).calls).toEqual([
      { op: 'push', x: 100, y: 100, rotation: expect.closeTo(Math.PI / 2), scale: 1 },
      { op: 'circle', x: 0, y: 0, radius: 31, style: { fill: TOKEN_MARKER_COLOR } },
      { op: 'pop' },
    ]);
  });

  it('draws the nameplate and the resource bars below the token at the resting UI size, in the colours it was sent', () => {
    const resources = [{ color: '#22c55e', share: 0.7, spent: false }, { color: '#3b82f6', share: 0.25, spent: false }];
    const surface = draw({ t1: playerToken({ name: 'Hero', resources }) });
    expect(surface.ops('push')[1]).toEqual({ op: 'push', x: 100, y: 131, rotation: 0, scale: 1 });
    const fills = surface.ops('roundRect').flatMap(({ style }) => (style.fill ? [style.fill] : []));
    expect(fills).toEqual(['#2a2a2a', '#1a1a1a', '#22c55e', '#1a1a1a', '#3b82f6']);
    const first = surface.ops('roundRect').find(({ style }) => style.fill === '#22c55e')!;
    expect(first).toMatchObject({ x: -30.625, y: 3.375, height: 7.25 });
    expect(first.width).toBeCloseTo(61.25 * 0.7);
    const second = surface.ops('roundRect').find(({ style }) => style.fill === '#3b82f6')!;
    expect(second).toMatchObject({ y: 15.375, height: 7.25 });
    expect(second.width).toBeCloseTo(61.25 * 0.25);
    expect(surface.ops('roundRect').find(({ style }) => style.fill === '#2a2a2a')).toMatchObject({ x: -20, y: -14, width: 40, height: 14 });
    // No numbers: the player window shows a bar and nothing else
    expect(surface.ops('text')).toEqual([{ op: 'text', text: 'Hero', x: 0, y: 0, style: expect.objectContaining({ align: 'center', alpha: 0.85 }) }]);
  });

  it('draws only the first two bars, as the window does, and none for a token without any', () => {
    const bar = (color: string): { color: string; share: number; spent: boolean } => ({ color, share: 1, spent: false });
    const surface = draw({ t1: playerToken({ resources: [bar('#111111'), bar('#222222'), bar('#333333')] }), t2: playerToken({ x: 300 }) });
    const fills = surface.ops('roundRect').flatMap(({ style }) => (style.fill ? [style.fill] : []));
    expect(fills).toEqual(['#1a1a1a', '#111111', '#1a1a1a', '#222222']);
  });

  it('darkens the bar whose spending defeats the token, and leaves it empty', () => {
    const surface = draw({ t1: playerToken({ resources: [{ color: '#ef4444', share: 0, spent: true }] }) });
    const fills = surface.ops('roundRect').map(({ style }) => style);
    expect(fills).toContainEqual({ fill: '#000000', alpha: 0.4 });
    expect(fills.filter((style) => style.fill === '#ef4444')).toEqual([]);
  });

  it('greys a downed token out and marks it with a skull, upright, whether or not it shows a bar', () => {
    const surface = draw({ t1: playerToken({ rotation: 90, downed: true }) }, true);
    expect(surface.ops('circle').find(({ style }) => style.fill === DOWNED_VEIL.color)).toMatchObject({ x: 100, y: 100, style: { alpha: DOWNED_VEIL.alpha } });
    expect(surface.calls.filter((call) => call.op === 'icon')).toEqual([
      expect.objectContaining({ op: 'icon', name: 'skull', x: 100, y: 100 }),
    ]);
    expect(draw({ t1: playerToken() }).calls.some((call) => call.op === 'icon')).toBe(false);
  });

  it('draws neutral condition badges on the ring with the value in a pip, the last slot counting the rest', () => {
    const conditions = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id, value: index === 1 ? 2 : null }));
    const surface = draw({ t1: playerToken({ conditions }) });
    expect(surface.ops('circle').filter(({ style }) => style.fill === NEUTRAL_BADGE_COLOR)).toHaveLength(2);
    expect(surface.ops('text').map(({ text }) => text)).toEqual(['2', '+3']);
    const badges = surface.ops('push').slice(1);
    expect(badges).toHaveLength(3);
    expect(badges.every(({ x, y }) => Math.hypot(x - 100, y - 100) > 32 && Math.hypot(x - 100, y - 100) < 34)).toBe(true);
  });

  it('draws tokens lowest layer first and skips those off screen', () => {
    const surface = draw({
      a: playerToken({ x: 100, layer: 2 }), b: playerToken({ x: 200, layer: 1 }), c: playerToken({ x: 9000, layer: 0 }),
    });
    expect(surface.ops('push').map(({ x }) => x)).toEqual([200, 100]);
  });

  it('rings the tokens this player controls, outside their own ring', () => {
    const surface = new RecordingSurface();
    createTokensLayer().draw(surface, frame(playerScene({ tokens: { t1: playerToken(), t2: playerToken({ x: 300 }) } }), {
      overlay: { controlled: new Set(['t1']), positions: new Map() },
    }));
    expect(surface.ops('circle').filter(({ style }) => style.stroke === CONTROLLED_RING_COLOR)).toEqual([
      { op: 'circle', x: 100, y: 100, radius: 39, style: { stroke: CONTROLLED_RING_COLOR, lineWidth: 4 } },
    ]);
  });

  it('draws a dragged or waiting token, with its nameplate, where the player put it', () => {
    const surface = new RecordingSurface();
    createTokensLayer().draw(surface, frame(playerScene({ tokens: { t1: playerToken({ name: 'Hero' }) } }), {
      overlay: { controlled: new Set(['t1']), positions: new Map([['t1', { x: 400, y: 300 }]]) },
    }));
    expect(surface.ops('push')[0]).toMatchObject({ x: 400, y: 300 });
    expect(surface.ops('push').map(({ x }) => x)).not.toContain(100);
  });

  it("glides a moved token as Atlas does, and keeps a dragged one under the pointer", () => {
    let now = 0;
    const layer = createTokensLayer({ now: () => now });
    const at = (tokens: Record<string, PlayerToken>, overlay?: TokenOverlay): number => {
      const surface = new RecordingSurface();
      layer.draw(surface, frame(playerScene({ tokens }), overlay ? { overlay } : {}));
      return surface.ops('push')[0]!.x;
    };
    expect(at({ t1: playerToken({ x: 100 }) })).toBe(100);
    expect(layer.animating?.()).toBe(false);
    // Atlas's glide: about two thirds of the way left behind every 50 ms, there within a few frames.
    expect(at({ t1: playerToken({ x: 300 }) })).toBe(100);
    expect(layer.animating?.()).toBe(true);
    now = 50;
    expect(at({ t1: playerToken({ x: 300 }) })).toBeCloseTo(300 - 200 * Math.exp(-1));
    for (let i = 0; i < 20; i++) {
      now += 50;
      at({ t1: playerToken({ x: 300 }) });
    }
    expect(at({ t1: playerToken({ x: 300 }) })).toBe(300);
    expect(layer.animating?.()).toBe(false);
    // Dragged: straight under the pointer.
    expect(at({ t1: playerToken({ x: 300 }) }, { controlled: new Set(['t1']), positions: new Map([['t1', { x: 900, y: 100 }]]), held: 't1' })).toBe(900);
    // Dropped there and snapped by the GM a little away: it slides the rest of the way.
    expect(at({ t1: playerToken({ x: 910 }) })).toBe(900);
    // A frame steps by at most 100 ms.
    now += 300;
    expect(at({ t1: playerToken({ x: 910 }) })).toBeCloseTo(910 - 10 * Math.exp(-2));
    for (let i = 0; i < 6; i++) {
      now += 50;
      at({ t1: playerToken({ x: 910 }) });
    }
    expect(at({ t1: playerToken({ x: 910 }) })).toBe(910);
  });

  it("puts another's token in place at once on a lit scene, where a glide would show players where it came from", () => {
    let now = 0;
    const layer = createTokensLayer({ now: () => now });
    const dark = { [DARKNESS_FOG_ID]: { type: 'rectangle' as const, erase: false, order: 1, x: 0, y: 0, width: 1, height: 1 } };
    const at = (x: number, controlled: ReadonlySet<string>): number => {
      const surface = new RecordingSurface();
      layer.draw(surface, frame({ ...playerScene({ tokens: { t1: playerToken({ x }) } }), fog: dark }, { overlay: { controlled, positions: new Map(), held: null } }));
      return surface.ops('push')[0]!.x;
    };
    at(100, new Set());
    expect(at(300, new Set())).toBe(300);
    expect(layer.animating?.()).toBe(false);
    // The player's own token still glides.
    expect(at(500, new Set(['t1']))).toBe(300);
    expect(layer.animating?.()).toBe(true);
  });

  it("rings the token whose turn it is, for every player", () => {
    const surface = new RecordingSurface();
    createTokensLayer().draw(surface, frame(playerScene({ tokens: { t1: playerToken(), t2: playerToken({ x: 300 }) } })));
    expect(surface.ops('circle').filter(({ style }) => style.stroke === TURN_RING_COLOR).map(({ x }) => x)).toEqual([100]);
  });

  it('never draws a token smaller than a pixel, even under half a cell', () => {
    const [marker] = draw({ t1: playerToken({ size: 0.5 }) }).ops('circle');
    expect(marker?.radius).toBe(0.5);
  });
});
