// online-client/ar/arMode.mts
/**
 * Augmented reality on the page: the phone's back camera fills the screen and the 3D board stands on the printed
 * marker sheet in it, tracked as the phone moves. The camera's pictures are searched for the sheet off the page's thread
 * (a worker), a dozen or so times a second; the board's pose glides between findings at the screen's rate.
 *
 * The AR button again leaves it. Its panel sets how big a square of the map is on the table, the camera's field of view (browsers do not tell it), and
 * what stands on the sheet's middle: the map's middle or one of the player's tokens. It also offers the sheet to print.
 */
import type { AugmentedView } from '../../src/app/online/obsidian/playerBoardContract';
import { markerSheetSvg, MARKER_MM } from './markerSheet.mts';
import { coverFrustum, intrinsicsFor } from './sheetPose.mts';
import { PoseEaser, PoseSmoother, SheetTracker, type Tracked } from './sheetTracker.mts';
import type { TrackAnswer, TrackRequest } from './trackerWorker.mts';

/** The board as augmented reality needs it. */
export interface ArBoard {
  setAugmented(view: AugmentedView | null): boolean;
}

export interface ArModeOptions {
  /** The camera, asked for inside the player's tap (as iOS wants). */
  stream: Promise<MediaStream>;
  video: HTMLVideoElement;
  /** The board's element: the camera's picture covers it. */
  boardEl: HTMLElement;
  panel: HTMLElement;
  board(): ArBoard | null;
  /** The player's tokens, to stand one on the sheet's middle. */
  tokens(): Array<{ id: string; name: string }>;
  /** Augmented reality ended (Leave, or the camera stopped). */
  onEnd(): void;
}

interface ArSettings { squareMm: number; fov: number; anchor: string | null }

const SETTINGS_KEY = 'atlas-connect-ar';
const SQUARES_MM = [10, 15, 20, 25, 30, 40, 50];
const DEFAULTS: ArSettings = { squareMm: 25, fov: 65, anchor: null };
/** The longest side of the picture searched for the sheet: big enough to find it at arm's length, small enough to be quick. */
const SEARCH_PX = 640;

function readSettings(): ArSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<ArSettings> | null;
    return {
      squareMm: typeof saved?.squareMm === 'number' && SQUARES_MM.includes(saved.squareMm) ? saved.squareMm : DEFAULTS.squareMm,
      fov: typeof saved?.fov === 'number' && saved.fov >= 40 && saved.fov <= 100 ? saved.fov : DEFAULTS.fov,
      anchor: typeof saved?.anchor === 'string' ? saved.anchor : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings(settings: ArSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A private window: the settings last as long as the page.
  }
}

/** Searches pictures for the sheet in a worker; on the page's thread where workers cannot start. */
class Searcher {
  private worker: Worker | null = null;
  private local: SheetTracker | null = null;
  private waiting: ((answer: Tracked | null) => void) | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL('./trackerWorker.mts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<TrackAnswer>) => this.answer(event.data.tracked);
      this.worker.onerror = () => { this.worker?.terminate(); this.worker = null; this.answer(null); };
    } catch {
      this.worker = null;
    }
  }

  get busy(): boolean {
    return this.waiting !== null;
  }

  search(request: TrackRequest): Promise<Tracked | null> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      if (this.worker) { this.worker.postMessage(request, [request.picture.data.buffer]); return; }
      this.local ??= new SheetTracker();
      let tracked: Tracked | null = null;
      try { tracked = this.local.track(request.picture, request.camera); } catch { tracked = null; }
      this.answer(tracked);
    });
  }

  private answer(tracked: Tracked | null): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.(tracked);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.answer(null);
  }
}

export class ArMode {
  private settings = readSettings();
  private stream: MediaStream | null = null;
  private readonly searcher = new Searcher();
  private readonly smoother = new PoseSmoother();
  private readonly easer = new PoseEaser();
  private readonly grab: HTMLCanvasElement;
  private frameId = 0;
  private last = 0;
  private found = false;
  private ended = false;
  private sheetUrl: string | null = null;
  private status!: HTMLElement;
  private anchorSelect!: HTMLSelectElement;

  constructor(private readonly options: ArModeOptions) {
    this.grab = options.video.ownerDocument.createElement('canvas');
    this.buildPanel();
    this.say('Starting the camera…');
    options.stream.then((stream) => this.begin(stream), (error: unknown) => {
      const name = (error as { name?: string } | null)?.name;
      this.say(name === 'NotAllowedError'
        ? 'The camera was not allowed. Allow it for this page in the browser\'s settings, then try again.'
        : 'The camera could not start. Open the page in Safari or Chrome itself (not inside another app), over https.');
    });
  }

  private begin(stream: MediaStream): void {
    if (this.ended) { for (const track of stream.getTracks()) track.stop(); return; }
    this.stream = stream;
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => this.end());
    const { video, boardEl } = this.options;
    video.srcObject = stream;
    video.hidden = false;
    boardEl.classList.add('is-ar', 'is-ar-searching');
    video.play().catch(() => undefined);
    this.say('Point the camera at the marker sheet.');
    this.frameId = window.requestAnimationFrame((time) => this.frame(time));
  }

  private frame(time: number): void {
    this.frameId = 0;
    if (this.ended) return;
    const dt = this.last === 0 ? 0 : Math.min(0.1, (time - this.last) / 1000);
    this.last = time;
    this.search();
    const { pose } = this.easer.step(dt);
    const board = this.options.board();
    if (pose && board) {
      const frustum = this.frustum();
      if (frustum) board.setAugmented({ rotation: pose.rotation, translation: pose.translation, frustum, squareMm: this.settings.squareMm, anchor: this.anchor() });
    }
    this.frameId = window.requestAnimationFrame((next) => this.frame(next));
  }

  /** The token on the sheet's middle: the chosen one while it is still the player's. */
  private anchor(): string | null {
    const anchor = this.settings.anchor;
    return anchor !== null && this.options.tokens().some((token) => token.id === anchor) ? anchor : null;
  }

  /** What the screen shows of the camera's picture, as tangents. */
  private frustum(): AugmentedView['frustum'] | null {
    const { video, boardEl } = this.options;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height || !boardEl.clientWidth || !boardEl.clientHeight) return null;
    return coverFrustum(intrinsicsFor(width, height, this.settings.fov), width, height, boardEl.clientWidth, boardEl.clientHeight);
  }

  /** Hands the newest picture to the searcher when it is free. */
  private search(): void {
    const { video } = this.options;
    if (this.searcher.busy || video.readyState < 2 || !video.videoWidth) return;
    const scale = Math.min(1, SEARCH_PX / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    if (this.grab.width !== width) this.grab.width = width;
    if (this.grab.height !== height) this.grab.height = height;
    const context = this.grab.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0, width, height);
    const image = context.getImageData(0, 0, width, height);
    const camera = intrinsicsFor(width, height, this.settings.fov);
    void this.searcher.search({ picture: { width, height, data: image.data }, camera }).then((tracked) => this.tracked(tracked));
  }

  private tracked(tracked: Tracked | null): void {
    if (this.ended) return;
    const pose = this.smoother.next(tracked?.pose ?? null, performance.now());
    const { boardEl } = this.options;
    if (pose) {
      this.easer.aim(pose);
      if (!this.found) {
        this.found = true;
        boardEl.classList.remove('is-ar-searching', 'is-ar-lost');
      }
      if (tracked) this.say('');
    } else if (this.found) {
      // Out of sight a while: the board stays where it was, faint, until the sheet is found again.
      this.found = false;
      boardEl.classList.add('is-ar-lost');
      this.say('Point the camera at the marker sheet again.');
    }
  }

  private say(words: string): void {
    this.status.textContent = words;
    this.status.hidden = words === '';
  }

  private buildPanel(): void {
    const { panel } = this.options;
    const doc = panel.ownerDocument;
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(doc.createElement(tag), props);
    const field = (label: string, control: HTMLElement): HTMLElement => {
      const wrap = make('label', { className: 'ar-field' });
      wrap.append(make('span', { textContent: label }), control);
      return wrap;
    };

    this.status = make('p', { className: 'ar-status' });
    this.status.setAttribute('role', 'status');

    const square = make('select');
    for (const size of SQUARES_MM) square.append(make('option', { value: String(size), textContent: `${size} mm`, selected: size === this.settings.squareMm }));
    square.addEventListener('change', () => this.change({ squareMm: Number(square.value) }));

    const fov = make('input', { type: 'range', min: '40', max: '100', step: '1', value: String(this.settings.fov) });
    fov.setAttribute('aria-label', 'Camera field of view');
    const fovValue = make('output', { textContent: `${this.settings.fov}°` });
    fov.addEventListener('input', () => { fovValue.textContent = `${fov.value}°`; this.change({ fov: Number(fov.value) }); });
    const fovRow = make('span', { className: 'ar-range' });
    fovRow.append(fov, fovValue);

    this.anchorSelect = make('select');
    this.anchorSelect.addEventListener('change', () => this.change({ anchor: this.anchorSelect.value === '' ? null : this.anchorSelect.value }));
    this.fillAnchors();

    this.sheetUrl = URL.createObjectURL(new Blob([markerSheetSvg()], { type: 'image/svg+xml' }));
    const sheet = make('a', { href: this.sheetUrl, download: 'atlas-ar-marker-sheet.svg', target: '_blank', rel: 'noopener', textContent: 'Marker sheet to print' });
    sheet.setAttribute('aria-label', `Marker sheet to print on A4 at 100%: each black square is ${MARKER_MM} mm`);

    const settings = make('details', { className: 'ar-settings' });
    settings.append(make('summary', { textContent: 'AR settings' }), field('A square on the table', square), field('Camera view', fovRow), field('On the sheet\'s middle', this.anchorSelect), sheet);

    panel.replaceChildren(this.status, settings);
    panel.hidden = false;
  }

  /** The anchor's choices: the map's middle, and the player's tokens. */
  fillAnchors(): void {
    const select = this.anchorSelect;
    const doc = select.ownerDocument;
    const tokens = this.options.tokens();
    const options = [{ id: '', name: 'Map middle' }, ...tokens];
    select.replaceChildren(...options.map((token) => Object.assign(doc.createElement('option'), { value: token.id, textContent: token.name, selected: token.id === (this.anchor() ?? '') })));
  }

  private change(change: Partial<ArSettings>): void {
    this.settings = { ...this.settings, ...change };
    saveSettings(this.settings);
  }

  /** Whether augmented reality is still on. */
  get active(): boolean {
    return !this.ended;
  }

  /** Ends augmented reality: the camera stops and the board takes its usual camera again. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.frameId) window.cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.searcher.dispose();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    const { video, boardEl, panel } = this.options;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    boardEl.classList.remove('is-ar', 'is-ar-searching', 'is-ar-lost');
    panel.hidden = true;
    panel.replaceChildren();
    if (this.sheetUrl) URL.revokeObjectURL(this.sheetUrl);
    this.sheetUrl = null;
    this.options.board()?.setAugmented(null);
    this.options.onEnd();
  }
}
