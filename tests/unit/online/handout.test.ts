import { describe, expect, it } from 'vitest';
import { HandoutView } from '../../../online-client/handoutView.mts';
import { sceneAssetIds } from '../../../src/app/online/assets/assetIds';
import { Handouts } from '../../../src/app/online/handouts';
import { decodedImage } from './recordingSurface';
import { fakeAssetIds, fingerprint, projectForPlayers, snapshotOf } from './sceneFixtures';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import { playerScene } from './sceneFixtures';

const ASSET = fingerprint(7);

function view() {
  document.body.replaceChildren();
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] => document.body.appendChild(document.createElement(tag));
  const parts = { panel: make('section'), title: make('h2'), canvas: make('canvas'), status: make('p'), closeButton: make('button'), openButton: make('button') };
  return { view: new HandoutView(parts), ...parts };
}

describe('handouts', () => {
  it('go to players as a scene field, which lets their image through', () => {
    const scene = { ...playerScene(), handout: { asset: ASSET, title: 'Map of the cellar' } };
    expect(sceneAssetIds(scene)).toContain(ASSET);
    const handouts = new Handouts();
    let heard = 0;
    handouts.subscribe(() => { heard += 1; });
    handouts.show({ path: 'art/cellar.png', title: 'x'.repeat(300) });
    expect(handouts.current()?.title).toHaveLength(120);
    expect(heard).toBe(1);
  });

  it("are projected only where the session has them, never with the image's path", () => {
    const context = { sceneId: 's', rules: { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true }, coverage: FogCoverage.EMPTY, assets: fakeAssetIds(), mapSize: { width: 100, height: 100 } };
    const state = snapshotOf({});
    expect(projectForPlayers(state, context as never)).not.toHaveProperty('handout');
    expect(projectForPlayers(state, { ...context, handout: null } as never).handout).toBeNull();
    const shown = projectForPlayers(state, { ...context, handout: { path: 'SECRET/cellar.png', title: 'Cellar' } } as never);
    expect(shown.handout?.title).toBe('Cellar');
    expect(JSON.stringify(shown)).not.toContain('SECRET');
  });

  it('open when a new one arrives, close (once faded out) and open again, and go when the GM takes it away', async () => {
    const t = view();
    const faded = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
    t.view.update({ asset: ASSET, title: 'Cellar' }, null);
    expect(t.panel.hidden).toBe(false);
    expect(t.status.hidden).toBe(false);
    t.closeButton.click();
    await faded();
    expect(t.panel.hidden).toBe(true);
    t.view.update({ asset: ASSET, title: 'Cellar' }, decodedImage(40, 20));
    expect(t.panel.hidden).toBe(true);
    expect(t.openButton.hidden).toBe(false);
    t.openButton.click();
    expect(t.panel.hidden).toBe(false);
    expect([t.canvas.width, t.canvas.height]).toEqual([40, 20]);
    t.view.update(null, null);
    await faded();
    expect(t.panel.hidden).toBe(true);
    expect(t.openButton.hidden).toBe(true);
  });

  it("close on Escape and on a click beside the image, as Atlas's image display, and zoom with the wheel", async () => {
    const t = view();
    const faded = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
    t.view.update({ asset: ASSET, title: 'Cellar' }, decodedImage(40, 20));
    expect(t.canvas.getAttribute('aria-label')).toBe('Cellar');
    t.panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
    expect(t.canvas.style.getPropertyValue('--handout-scale')).toBe('1.1');
    t.panel.dispatchEvent(new MouseEvent('dblclick'));
    expect(t.canvas.style.getPropertyValue('--handout-scale')).toBe('1');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await faded();
    expect(t.panel.hidden).toBe(true);
    t.openButton.click();
    // jsdom lays nothing out: the image's box is empty, so a press anywhere is beside it.
    const press = (type: string, x: number): void => {
      const event = new MouseEvent(type, { clientX: x, clientY: 10, button: 0, bubbles: true }) as MouseEvent & { pointerId: number };
      Object.defineProperty(event, 'pointerId', { value: 1 });
      t.panel.dispatchEvent(event);
    };
    press('pointerdown', 10);
    press('pointermove', 60);
    press('pointerup', 60);
    // Dragged: only panned.
    expect(t.canvas.style.getPropertyValue('--handout-x')).toBe('50px');
    await faded();
    expect(t.panel.hidden).toBe(false);
    press('pointerdown', 10);
    press('pointerup', 12);
    await faded();
    expect(t.panel.hidden).toBe(true);
  });
});
