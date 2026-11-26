/** The join page on a device whose 3D board died even drawn its leanest: it opens on the 2D map, and 3D waits for a tap. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneSwitch } from '../../../online-client/sceneSwitch.mts';
import type { BoardSceneView } from '../../../src/app/online/obsidian/BoardSceneView';
import type { PlayerBoardFactory } from '../../../src/app/online/obsidian/playerBoardContract';
import type { SceneViewport } from '../../../src/app/online/obsidian/sceneViewport';

function fakeView(): BoardSceneView & SceneViewport {
  return new Proxy({}, {
    get: (_target, name: string) => {
      if (name === 'playsCutscenes' || name === 'firstPerson' || name === 'augmentedReality' || name === 'roomAr') return false;
      if (name === 'seeingFrom') return () => null;
      if (name === 'toolState') return () => ({ tool: 'move' });
      return () => {};
    },
  }) as unknown as BoardSceneView & SceneViewport;
}

function page(gaveOut: boolean) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => document.body.appendChild(document.createElement(tag));
  const factory: PlayerBoardFactory = { version: 1, create: () => { throw new Error('not used: makeBoard is faked'); } };
  let boards = 0;
  let held = 0;
  const dimensionButton = el('button');
  const sw = new SceneSwitch({
    makeMap: fakeView,
    makeBoard: () => { boards++; return fakeView(); },
    loadBoard: () => Promise.resolve(factory),
    boardGaveOut: () => gaveOut,
    onBoardHeld: () => { held++; },
    canvas: el('canvas'), boardEl: el('div'), dimensionButton, eyeButton: el('button'), eyeMenu: el('div'), viewButtons: el('div'),
    requestBoard: () => true, onViewChange: () => {}, tokenName: () => 'T',
  });
  return { sw, dimensionButton, boards: () => boards, held: () => held };
}

describe('SceneSwitch on a device the board died on', () => {
  afterEach(() => { document.body.replaceChildren(); });

  it('opens on the 2D map and says why; the 3D button still shows the board', async () => {
    const p = page(true);
    p.sw.boardOffer(true);
    await vi.waitFor(() => expect(p.held()).toBe(1));
    expect(p.boards()).toBe(0);
    expect(p.dimensionButton.hidden).toBe(false);
    expect(p.dimensionButton.getAttribute('aria-label')).toBe('Show the 3D board');
    p.dimensionButton.click();
    expect(p.boards()).toBe(1);
  });

  it('a device the board did not die on opens on the board, as before', async () => {
    const p = page(false);
    p.sw.boardOffer(true);
    await vi.waitFor(() => expect(p.boards()).toBe(1));
    expect(p.held()).toBe(0);
  });
});
