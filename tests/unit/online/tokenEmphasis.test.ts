import { describe, expect, it } from 'vitest';
import { createTokensLayer } from '../../../src/app/online/view/layers/tokensLayer';
import { EMPHASIS_MOTION, TokenEmphasis } from '../../../src/app/online/view/layers/tokenEmphasis';
import { HoverCardView } from '../../../online-client/hoverCardView.mts';
import { conditionRows } from '../../../src/app/online/view/tokenHover';
import type { PlayerToken } from '../../../src/app/online/scene/sceneTypes';
import type { TokenOverlay } from '../../../src/app/online/view/layers/layerTypes';
import { frame, RecordingSurface } from './recordingSurface';
import { playerScene, playerToken } from './sceneFixtures';

describe("a token's emphasis, as on Atlas's scene", () => {
  it('eases a selected token towards its selected size over 300 ms, and back while held', () => {
    let now = 0;
    const emphasis = new TokenEmphasis(() => now);
    const step = (selected: boolean): number => {
      emphasis.begin('s');
      const shown = emphasis.frame('t', selected, false).selected;
      emphasis.end();
      return shown;
    };
    expect(step(false)).toBe(0);
    expect(step(true)).toBe(0);
    now = 150;
    const mid = step(true);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    now = EMPHASIS_MOTION.scaleMs;
    expect(step(true)).toBe(1);
    now += 10;
    expect(step(false)).toBeCloseTo(1);
    now += EMPHASIS_MOTION.scaleMs;
    expect(step(false)).toBe(0);
  });

  it('fades the numbers in while hovered or selected, a share of the way each frame, and out again', () => {
    let now = 0;
    const emphasis = new TokenEmphasis(() => now);
    const numbers = (shown: boolean): number => {
      emphasis.begin('s');
      const value = emphasis.frame('t', false, shown).numbers;
      emphasis.end();
      return value;
    };
    numbers(false);
    now = EMPHASIS_MOTION.numbersFrameMs;
    expect(numbers(true)).toBeCloseTo(EMPHASIS_MOTION.numbersStep);
    now = 1000;
    expect(numbers(true)).toBe(1);
    expect(emphasis.animating()).toBe(false);
  });
});

describe('the tokens layer with a selection', () => {
  const bar = { color: '#22c55e', share: 0.5, spent: false, current: 19, max: 27 };
  const draw = (overlay: Partial<TokenOverlay>, now: () => number, layer = createTokensLayer({ now })): RecordingSurface => {
    const surface = new RecordingSurface();
    layer.draw(surface, frame(playerScene({ tokens: { t1: playerToken({ resources: [bar] }) } }), { overlay: { controlled: new Set(), positions: new Map(), ...overlay } }));
    return surface;
  };

  it("shows a bar's numbers on hover as Atlas's label does: current, slash, maximum", () => {
    let now = 0;
    const layer = createTokensLayer({ now: () => now });
    expect(draw({}, () => now, layer).ops('text')).toEqual([]);
    draw({ hovered: 't1' }, () => now, layer);
    now = 1000;
    const texts = draw({ hovered: 't1' }, () => now, layer).ops('text');
    expect(texts.map(({ text, style }) => [text, style.align])).toEqual([['19', 'right'], ['/', 'center'], ['27', 'left']]);
    expect(texts[0]!.style.outline).toEqual({ color: '#000000', width: 2 });
  });

  it('grows a selected token’s bars to a constant size on screen, and draws its UI last', () => {
    let now = 0;
    const layer = createTokensLayer({ now: () => now });
    const scaleOf = (surface: RecordingSurface): number => surface.ops('push').find(({ y }) => y > 100)!.scale;
    const resting = scaleOf(draw({}, () => now, layer));
    draw({ selected: 't1' }, () => now, layer);
    now = 400;
    // At zoom 1 Atlas's selected size is 2.25 screen pixels per UI unit, above the resting size.
    expect(scaleOf(draw({ selected: 't1' }, () => now, layer))).toBeCloseTo(Math.max(resting, 2.25));
  });
});

describe("Atlas's conditions card", () => {
  it('lists a hovered token’s named conditions with their badges, and none without', () => {
    const scene = playerScene({ tokens: {
      t1: playerToken({ conditions: [{ id: 'f', value: 2, name: 'Frightened', color: '#e93147', icon: 'terror' }, { id: 'x', value: null }] as PlayerToken['conditions'] }),
      t2: playerToken(),
    } });
    const rows = conditionRows(scene, 't1');
    expect(rows.map((row) => row.label)).toEqual(['Frightened 2']);
    // The label reads the number, so the card's badge leaves it out.
    expect(rows[0]!.look).toMatchObject({ color: '#e93147', glyph: { icon: 'terror' }, value: null });
    expect(conditionRows(scene, 't2')).toEqual([]);

    const element = document.createElement('div');
    document.body.replaceChildren(element);
    const card = new HoverCardView(element);
    card.showConditions(rows, 100, 50);
    expect(element.hidden).toBe(false);
    expect(element.querySelector('.hover-card-label')?.textContent).toBe('Frightened 2');
    card.showConditions([], 100, 50);
    expect(element.hidden).toBe(true);
  });
});
