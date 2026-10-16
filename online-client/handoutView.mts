// online-client/handoutView.mts
/**
 * The image the GM shows players (`PlayerScene.handout`): a panel over the map with its title and the image, drawn on
 * a canvas from the loaded asset. A new handout opens the panel; the player can close it and open it again with its
 * button, which shows while there is a handout. Shared with the Obsidian scene tab.
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
}

export class HandoutView {
  /** The handout last shown, so the same one sent again does not open a closed panel. */
  private shownKey: string | null = null;
  private drawn: DecodedImage | null = null;
  private readonly listeners = new AbortController();

  constructor(private readonly options: HandoutViewOptions) {
    const { signal } = this.listeners;
    options.panel.hidden = true;
    options.openButton.hidden = true;
    options.openButton.replaceChildren(iconElement(toolIconUrl('image')));
    options.closeButton.addEventListener('click', () => this.setOpen(false), { signal });
    options.openButton.addEventListener('click', () => this.setOpen(options.panel.hidden), { signal });
  }

  /** The scene's handout and its image now (null while loading). */
  update(handout: PlayerHandout | null | undefined, image: DecodedImage | null): void {
    const { panel, title, status, openButton } = this.options;
    if (!handout) {
      this.shownKey = null;
      this.drawn = null;
      panel.hidden = true;
      openButton.hidden = true;
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
    status.hidden = image !== null;
    if (image && image !== this.drawn) this.draw(image);
  }

  dispose(): void {
    this.listeners.abort();
  }

  private setOpen(open: boolean): void {
    this.options.panel.hidden = !open;
    this.options.openButton.setAttribute('aria-expanded', String(open));
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
  }
}
