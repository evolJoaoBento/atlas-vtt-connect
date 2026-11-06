// online-client/ar/arMode.mts
/**
 * Augmented reality on the page: the phone's back camera fills the screen and the 3D board stands on the printed
 * marker sheet in it, tracked as the phone moves. The camera's pictures are searched for the sheet off the page's thread
 * (a worker), a dozen or so times a second. With the phone's gyroscope (iOS asks first) the markers only place the
 * board and the gyroscope turns it, every frame (`fusion.mts`): far steadier, and it stays put while the markers are
 * briefly out of sight. Without one, the markers' own pose glides between findings at the screen's rate.
 *
 * The AR button again leaves it. Its panel sets how big a square of the map is on the table, the camera's field of view (browsers do not tell it), and
 * what stands on the sheet's middle: the map's middle or one of the player's tokens. It also offers the sheet to print.
 */
import type { AugmentedView } from '../../src/app/online/obsidian/playerBoardContract';
import { CARD_MM, CARD_PAGES, CARDS_PER_PAGE, markerCardsSvg, markerSheetSvg, MARKER_MM } from './markerSheet.mts';
import { MarkerLayout } from './markerLayout.mts';
import { coverFrustum, intrinsicsFor } from './sheetPose.mts';
import { deviceRotation, SensorFusion } from './fusion.mts';
import { PoseEaser, PoseSmoother, SheetTracker, type Detected, type Tracked } from './sheetTracker.mts';
import type { TrackAnswer, TrackRequest } from './trackerWorker.mts';

/** The board as augmented reality needs it. */
export interface ArBoard {
  setAugmented(view: AugmentedView | null): boolean;
}

export interface ArModeOptions {
  /** The camera, asked for inside the player's tap (as iOS wants). */
  stream: Promise<MediaStream>;
  /** Whether the phone's motion sensors may be read (asked for inside the tap too, as iOS wants). */
  motion?: Promise<boolean>;
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
  private waiting: ((answer: Detected[]) => void) | null = null;

  constructor() {
    try {
      this.worker = new Worker(new URL('./trackerWorker.mts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<TrackAnswer>) => this.answer(event.data.markers);
      this.worker.onerror = () => { this.worker?.terminate(); this.worker = null; this.answer([]); };
    } catch {
      this.worker = null;
    }
  }

  get busy(): boolean {
    return this.waiting !== null;
  }

  search(request: TrackRequest): Promise<Detected[]> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      if (this.worker) { this.worker.postMessage(request, [request.picture.data.buffer]); return; }
      this.local ??= new SheetTracker();
      let markers: Detected[] = [];
      try { markers = this.local.detect(request.picture, request.camera); } catch { markers = []; }
      this.answer(markers);
    });
  }

  private answer(markers: Detected[]): void {
    const waiting = this.waiting;
    this.waiting = null;
    waiting?.(markers);
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.answer([]);
  }
}

export class ArMode {
  private settings = readSettings();
  private stream: MediaStream | null = null;
  private readonly searcher = new Searcher();
  private readonly smoother = new PoseSmoother();
  private readonly easer = new PoseEaser();
  private readonly fusion = new SensorFusion();
  private readonly layout = new MarkerLayout();
  private stopMotion: (() => void) | null = null;
  private readonly grab: HTMLCanvasElement;
  private frameId = 0;
  private last = 0;
  private found = false;
  private ended = false;
  private readonly urls: string[] = [];
  private status!: HTMLElement;
  private anchorSelect!: HTMLSelectElement;

  constructor(private readonly options: ArModeOptions) {
    this.grab = options.video.ownerDocument.createElement('canvas');
    this.buildPanel();
    this.say('Starting the camera…');
    void options.motion?.then((allowed) => { if (allowed && !this.ended) this.listenToMotion(); }, () => undefined);
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

  /** The gyroscope's readings, into the fusion. */
  private listenToMotion(): void {
    const win = this.options.video.ownerDocument.defaultView ?? window;
    const read = (event: DeviceOrientationEvent): void => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      const screen = win.screen?.orientation?.angle ?? (win as unknown as { orientation?: number }).orientation ?? 0;
      this.fusion.orient(deviceRotation(event.alpha, event.beta, event.gamma, screen), performance.now());
    };
    win.addEventListener('deviceorientation', read);
    this.stopMotion = () => win.removeEventListener('deviceorientation', read);
  }

  /** While the gyroscope turns the view, how long the board stays put without the markers: the turn is still the phone's. */
  private static readonly FUSED_HOLD_MS = 2500;

  private frame(time: number): void {
    this.frameId = 0;
    if (this.ended) return;
    const dt = this.last === 0 ? 0 : Math.min(0.1, (time - this.last) / 1000);
    this.last = time;
    this.search();
    const now = performance.now();
    const eased = this.easer.step(dt).pose;
    const fused = this.fusion.sensing(now) && this.fusion.tracking(now, ArMode.FUSED_HOLD_MS) ? this.fusion.pose(now, dt) : null;
    const pose = fused ?? eased;
    // What steadies the board, for a look in the page's inspector (and the tests): the gyroscope, or the markers alone.
    this.options.boardEl.dataset.arSteadiedBy = fused ? 'gyroscope' : 'markers';
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
    const taken = performance.now();
    void this.searcher.search({ picture: { width, height, data: image.data }, camera }).then((markers) => {
      if (this.ended) return;
      const tracked = this.layout.observe(markers, camera, width);
      if (tracked) this.fusion.found(tracked.pose.rotation, tracked.sheet, tracked.seen, camera, taken);
      this.tracked(tracked);
    });
  }

  private tracked(tracked: Tracked | null): void {
    if (this.ended) return;
    const now = performance.now();
    const pose = this.smoother.next(tracked?.pose ?? null, now);
    const { boardEl } = this.options;
    const fused = this.fusion.sensing(now) && this.fusion.tracking(now, ArMode.FUSED_HOLD_MS);
    if (pose || fused) {
      if (pose) this.easer.aim(pose);
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

  /** Forgets where the markers lie: the next sheet or card seen holds the map's middle. */
  private placeAgain(): void {
    this.layout.reset();
    this.fusion.reset();
    this.smoother.reset();
    this.easer.aim(null);
    this.found = false;
    this.options.boardEl.classList.add('is-ar-searching');
    this.say('Point the camera at the sheet or card the map\'s middle should stand on.');
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

    const link = (svg: string, file: string, words: string, label: string): HTMLAnchorElement => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      this.urls.push(url);
      const anchor = make('a', { href: url, download: file, target: '_blank', rel: 'noopener', textContent: words });
      anchor.setAttribute('aria-label', label);
      return anchor;
    };
    const prints = make('div', { className: 'ar-prints' });
    prints.append(link(markerSheetSvg(), 'atlas-ar-marker-sheet.svg', 'Marker sheet (A4)', `Marker sheet to print on A4 at 100%: each black square is ${MARKER_MM} mm`));
    for (let page = 0; page < CARD_PAGES; page++) {
      const first = page * CARDS_PER_PAGE + 1;
      prints.append(link(markerCardsSvg(page), `atlas-ar-cards-${first}-${first + CARDS_PER_PAGE - 1}.svg`, `Marker cards ${first}–${first + CARDS_PER_PAGE - 1}`, `Marker cards to print on A4 at 100% and cut out: each black square is ${CARD_MM} mm`));
    }
    const restart = make('button', { type: 'button', className: 'secondary', textContent: 'Place again' });
    restart.setAttribute('aria-label', 'Forget where the sheet and cards lie: the next one seen holds the map\'s middle');
    restart.addEventListener('click', () => this.placeAgain());

    const settings = make('details', { className: 'ar-settings' });
    settings.append(make('summary', { textContent: 'AR settings' }), field('A square on the table', square), field('Camera view', fovRow), field('On the first marker seen', this.anchorSelect), prints, restart);

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
    this.stopMotion?.();
    this.stopMotion = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    const { video, boardEl, panel } = this.options;
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    boardEl.classList.remove('is-ar', 'is-ar-searching', 'is-ar-lost');
    delete boardEl.dataset.arSteadiedBy;
    panel.hidden = true;
    panel.replaceChildren();
    for (const url of this.urls.splice(0)) URL.revokeObjectURL(url);
    this.options.board()?.setAugmented(null);
    this.options.onEnd();
  }
}
