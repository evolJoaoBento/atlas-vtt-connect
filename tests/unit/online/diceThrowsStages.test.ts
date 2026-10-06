import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { contexts } = vi.hoisted(() => ({ contexts: { count: 0 } }));
// jsdom has no WebGL: a stand-in renderer counts the contexts the page makes. The stages are Atlas's own
// `DiceRenderer`s (their canvases are counted below), drawing through it.
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    shadowMap = { enabled: false, type: 0, autoUpdate: true, needsUpdate: false };
    toneMapping = 0;
    constructor() { contexts.count++; }
    setPixelRatio(): void {}
    setSize(): void {}
    setViewport(): void {}
    setRenderTarget(): void {}
    render(): void {}
    dispose(): void {}
    forceContextLoss(): void {}
    getRenderTarget(): null { return null; }
  }
  class FakePmrem {
    fromScene(): { texture: object; dispose(): void } { return { texture: {}, dispose: () => {} }; }
    dispose(): void {}
  }
  return { ...three, WebGLRenderer: FakeWebGLRenderer, PMREMGenerator: FakePmrem };
});

import { diceThrows, PAGE_STAGES } from '../../../online-client/dice3d/diceThrows.mts';
import { sceneFromRolls, throwStyle } from '@atlas-vtt/shared/dice3d';
import type { DiceRollResult } from '@atlas-vtt/shared/rules';

const roll = (id: string): Parameters<typeof diceThrows.throwRoll>[1] => {
  const result: DiceRollResult = { id, timestamp: 0, formula: '1d20', rolls: [{ die: 'd20', value: 7, max: 20 }], modifiers: 0, total: 7, crit: null };
  return { result, scene: sceneFromRolls(result.rolls)!, style: throwStyle('full'), reduced: false };
};

describe("the join page's dice stages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no 2D context either: the stages and the dice faces draw nowhere, and say nothing.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('makes at most two, the stage on screen and one spare, drawn by one WebGL context, however many rolls come', async () => {
    // Atlas's stages make their canvases through its DOM host (the page installs `browserDomHost`, as `tests/setup/atlasDomHost.ts` does), so count what the document makes.
    const canvases: HTMLCanvasElement[] = [];
    const create = document.createElement.bind(document) as (tag: string) => HTMLElement;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = create(tag);
      if (tag === 'canvas') canvases.push(element as HTMLCanvasElement);
      return element;
    }) as typeof document.createElement);
    for (let i = 0; i < 6; i++) {
      expect(diceThrows.throwRoll(document.body, roll(`r${i}`))).toBe(true);
      await vi.advanceTimersByTimeAsync(4000);
    }
    expect(PAGE_STAGES).toBe(2);
    expect(canvases.filter((canvas) => canvas.className === 'atlas-dice-stage__canvas')).toHaveLength(PAGE_STAGES);
    expect(contexts.count).toBe(1);
    expect(document.querySelectorAll('.dice-throw').length).toBeLessThanOrEqual(1);
  });
});
