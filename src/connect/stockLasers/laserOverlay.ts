/**
 * Draws other people's lasers over a map view: a transparent canvas laid over the view's canvas that does not take
 * the pointer, redrawn each frame while a laser shows. Stock Atlas has no remote lasers to ask for, and nothing it
 * draws is reachable, so this is drawn here in screen space from the view's own camera (`viewport.toScreen`).
 */
import { LaserModel, type ShownLaser } from './laserModel';
import type { RemoteLaser } from '@atlas-vtt/api-types';

/** What the overlay reads of a view. */
export interface OverlayTarget {
  /** The view's own canvas, which the overlay lies over. */
  canvas(): HTMLCanvasElement | null;
  /** The world point's place on that canvas, in CSS pixels from its top left; null while the view has no camera. */
  toScreen(x: number, y: number): { x: number; y: number } | null;
  /** The view is still open. */
  isOpen(): boolean;
}

/** Laser line width and head size, in CSS pixels. */
const LINE = 5;
const HEAD = 7;

export class LaserOverlay {
  private readonly model = new LaserModel();
  private element: HTMLCanvasElement | null = null;
  private frame: number | null = null;
  private window: Window | null = null;
  private disposed = false;

  constructor(private readonly target: OverlayTarget, private readonly now: () => number = () => performance.now()) {}

  /** The overlay was taken down (its view closed, or Atlas unloaded): a new one is made for the next laser. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Adds the newest points of a laser and starts drawing. */
  show(laser: RemoteLaser): void {
    if (this.disposed) return;
    this.model.show(laser, this.now());
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.frame !== null) this.window?.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.element?.remove();
    this.element = null;
    this.model.clear();
  }

  private schedule(): void {
    if (this.frame !== null || this.disposed) return;
    const canvas = this.target.canvas();
    const win = canvas?.ownerDocument.defaultView ?? null;
    if (!canvas || !win) return;
    this.window = win;
    this.frame = win.requestAnimationFrame(() => {
      this.frame = null;
      this.draw();
      if (this.model.active && !this.disposed) this.schedule();
    });
  }

  private draw(): void {
    const canvas = this.target.canvas();
    if (!this.target.isOpen() || !canvas) {
      this.dispose();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const shown = this.model.frame(this.now());
    if (shown.length === 0 || rect.width === 0 || rect.height === 0) {
      this.element?.setCssProps({ display: 'none' });
      return;
    }
    const element = this.ensure(canvas);
    const scale = canvas.ownerDocument.defaultView?.devicePixelRatio || 1;
    element.setCssProps({ display: 'block', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const wide = Math.round(rect.width * scale);
    const high = Math.round(rect.height * scale);
    if (element.width !== wide) element.width = wide;
    if (element.height !== high) element.height = high;
    const context = element.getContext('2d');
    if (!context) return;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    for (const laser of shown) this.drawLaser(context, laser);
  }

  private ensure(canvas: HTMLCanvasElement): HTMLCanvasElement {
    if (this.element?.isConnected) return this.element;
    const element = createEl('canvas', { cls: 'atlas-connect-lasers', attr: { 'aria-hidden': 'true' } });
    canvas.ownerDocument.body.appendChild(element);
    this.element = element;
    return element;
  }

  private drawLaser(context: CanvasRenderingContext2D, laser: ShownLaser): void {
    const points = laser.points.flatMap((point) => {
      const place = this.target.toScreen(point.x, point.y);
      return place ? [{ ...place, alpha: point.alpha }] : [];
    });
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = laser.color;
    context.fillStyle = laser.color;
    context.shadowColor = laser.color;
    context.shadowBlur = 10;
    context.lineWidth = LINE;
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!;
      const to = points[index]!;
      context.globalAlpha = Math.max(0, Math.min(1, to.alpha));
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    const head = points.at(-1);
    if (head && laser.live) {
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(head.x, head.y, HEAD, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
    context.shadowBlur = 0;
  }
}
