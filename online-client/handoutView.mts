// online-client/handoutView.mts
/**
 * The image the GM shows players (`PlayerScene.handout`), as Atlas's player window shows one (`ImageDisplayService`,
 * `image-display.scss`, `imageDisplayMotion.ts`, `imageOverlayControls.ts`): over the whole map on a dark scrim, the
 * image at most nine tenths of it with rounded corners, a round close button at the top right. It fades and grows in
 * (from 0.96) once its image is drawn and fades out (to 0.98); the wheel zooms it, dragging pans it, a double-click
 * resets it, and a click beside it or Escape closes it. The player can open it again with its button, which shows
 * while there is a handout. The title is read out, not shown, as Atlas shows none. Shared with the Obsidian scene tab.
 */
import type { DecodedImage } from '../src/app/online/assets/AssetLoader';
import type { PlayerHandout } from '../src/app/online/scene/sceneTypes';
import { toolIconUrl } from '../src/app/online/page/toolIcons';
import { iconElement } from './icons.mts';

export interface HandoutViewOptions {
  panel: HTMLElement;
  title: HTMLElement;
  canvas: HTMLCanvasElement;
  /** "Loading…" while the image is on its way. */
  status: HTMLElement;
  closeButton: HTMLButtonElement;
  /** Opens the panel again; shown while there is a handout. */
  openButton: HTMLButtonElement;
  /** Whether this surface has the keyboard: inside Obsidian other panes' Escape must not close it. The page always does. */
  active?: () => boolean;
}

/** Atlas's motion (`imageDisplayMotion.ts`): in from 0.96 over its slow time, out to 0.98 over its normal one, eased out. */
export const HANDOUT_MOTION = { enterMs: 300, exitMs: 200, enterScale: 0.96, exitScale: 0.98, ease: 'cubic-bezier(0.23, 1, 0.32, 1)' } as const;
/** Atlas's controls (`imageOverlayControls.ts`): a press moving further than this pans instead of closing; the zoom's range. */
const CLICK_TOLERANCE = 5;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;

const reducedMotion = (doc: Document): boolean => {
  try {
    return doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
};

export class HandoutView {
  /** The handout last shown, so the same one sent again does not open a closed panel. */
  private shownKey: string | null = null;
  private drawn: DecodedImage | null = null;
  private readonly listeners = new AbortController();
  private open = false;
  /** The entrance waits for the image: it plays once the image is drawn. */
  private entering = false;
  private closing: Animation | null = null;
  private zoom = { scale: 1, x: 0, y: 0 };
  private press: { x: number; y: number; outside: boolean; originX: number; originY: number; pointer: number } | null = null;

  constructor(private readonly options: HandoutViewOptions) {
    const { signal } = this.listeners;
    const { panel, canvas } = options;
    panel.hidden = true;
    options.openButton.hidden = true;
    options.openButton.replaceChildren(iconElement(toolIconUrl('image')));
    options.closeButton.replaceChildren(iconElement(toolIconUrl('x')));
    options.closeButton.addEventListener('click', () => this.setOpen(false), { signal });
    options.openButton.addEventListener('click', () => this.setOpen(!this.open), { signal });
    canvas.setAttribute('draggable', 'false');
    panel.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoom.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.zoom.scale * (event.deltaY < 0 ? 1.1 : 0.9)));
      this.applyZoom();
    }, { passive: false, signal });
    panel.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || options.closeButton.contains(event.target as Node)) return;
      const box = canvas.getBoundingClientRect();
      const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      this.press = { x: event.clientX, y: event.clientY, outside, originX: event.clientX - this.zoom.x, originY: event.clientY - this.zoom.y, pointer: event.pointerId };
      panel.classList.add('is-dragging');
      panel.setPointerCapture?.(event.pointerId);
    }, { signal });
    panel.addEventListener('pointermove', (event) => {
      const press = this.press;
      if (!press || event.pointerId !== press.pointer) return;
      this.zoom.x = event.clientX - press.originX;
      this.zoom.y = event.clientY - press.originY;
      this.applyZoom();
    }, { signal });
    const release = (event: PointerEvent): void => {
      const press = this.press;
      if (!press || event.pointerId !== press.pointer) return;
      this.press = null;
      panel.classList.remove('is-dragging');
      // A click beside the image closes it; one that dragged only panned.
      if (press.outside && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= CLICK_TOLERANCE) this.setOpen(false);
    };
    panel.addEventListener('pointerup', release, { signal });
    panel.addEventListener('pointercancel', () => {
      this.press = null;
      panel.classList.remove('is-dragging');
    }, { signal });
    panel.addEventListener('dblclick', () => this.resetZoom(), { signal });
    panel.ownerDocument.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open || options.active?.() === false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setOpen(false);
    }, { capture: true, signal });
  }

  /** The scene's handout and its image now (null while loading). */
  update(handout: PlayerHandout | null | undefined, image: DecodedImage | null): void {
    const { title, status, openButton, canvas } = this.options;
    if (!handout) {
      this.shownKey = null;
      this.drawn = null;
      openButton.hidden = true;
      this.setOpen(false);
      return;
    }
    const key = `${handout.asset ?? ''}\u0000${handout.title}`;
    openButton.hidden = false;
    if (key !== this.shownKey) {
      this.shownKey = key;
      this.drawn = null;
      this.setOpen(true);
    }
    title.textContent = handout.title;
    canvas.setAttribute('aria-label', handout.title || 'Shown image');
    status.hidden = image !== null;
    if (image && image !== this.drawn) this.draw(image);
  }

  dispose(): void {
    this.listeners.abort();
    this.closing?.cancel();
  }

  private setOpen(open: boolean): void {
    const { panel } = this.options;
    this.options.openButton.setAttribute('aria-expanded', String(open));
    if (open === this.open) return;
    this.open = open;
    this.closing?.cancel();
    this.closing = null;
    if (open) {
      this.resetZoom();
      panel.hidden = false;
      panel.classList.remove('is-leaving');
      this.entering = true;
      // A drawn image enters now; one on its way enters once it is drawn, so a large one never pops in partway.
      if (this.drawn) this.playEnter();
      return;
    }
    this.entering = false;
    const fade = typeof panel.animate === 'function'
      ? panel.animate({ opacity: 0 }, { duration: HANDOUT_MOTION.exitMs, easing: HANDOUT_MOTION.ease, fill: 'forwards' })
      : null;
    if (!fade) {
      panel.hidden = true;
      return;
    }
    if (!reducedMotion(panel.ownerDocument)) {
      this.options.canvas.animate({ scale: String(HANDOUT_MOTION.exitScale) }, { duration: HANDOUT_MOTION.exitMs, easing: HANDOUT_MOTION.ease });
    }
    panel.classList.add('is-leaving');
    this.closing = fade;
    void fade.finished.then(() => {
      if (this.closing !== fade) return;
      this.closing = null;
      panel.hidden = true;
      panel.classList.remove('is-leaving');
      fade.cancel();
    }, () => undefined);
  }

  /** The scrim fades in and the image grows into place (Atlas's `playImageEnter`). */
  private playEnter(): void {
    if (!this.entering) return;
    this.entering = false;
    const { panel, canvas } = this.options;
    if (typeof panel.animate !== 'function') return;
    const timing = { duration: HANDOUT_MOTION.enterMs, easing: HANDOUT_MOTION.ease };
    panel.animate([{ opacity: 0 }, { opacity: 1 }], timing);
    const from = reducedMotion(panel.ownerDocument) ? { opacity: 0 } : { opacity: 0, scale: String(HANDOUT_MOTION.enterScale) };
    canvas.animate([from, { opacity: 1, scale: '1' }], timing);
  }

  private resetZoom(): void {
    this.zoom = { scale: 1, x: 0, y: 0 };
    this.applyZoom();
  }

  private applyZoom(): void {
    const { canvas } = this.options;
    canvas.style.setProperty('--handout-x', `${this.zoom.x}px`);
    canvas.style.setProperty('--handout-y', `${this.zoom.y}px`);
    canvas.style.setProperty('--handout-scale', String(this.zoom.scale));
  }

  private draw(image: DecodedImage): void {
    const { canvas } = this.options;
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, image.width, image.height);
    context.drawImage(image.image, 0, 0, image.width, image.height);
    this.drawn = image;
    this.playEnter();
  }
}
