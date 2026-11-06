// online-client/ar/arMode.mts
/**
 * Augmented reality on the page: the 3D board standing on the table in the phone's camera picture.
 *
 * Room tracking (Android with ARCore, WebXR's immersive AR): the phone tracks the room itself, at the screen's rate. The
 * player points at the table and taps to put the board down; nothing need be printed.
 *
 * Printed markers (every phone; iPhones have no room tracking in the browser):
 * - Calibration first: the camera's field of view, which browsers do not tell, measured from a mat page or the A4 sheet
 *   seen at a slant (`calibrate.mts`); kept per camera, so once.
 * - The camera's pictures are searched for markers off the page's thread (a worker), a dozen or so times a second; the
 *   sheet, mat pages and cards are placed as they are seen together (`markerLayout.mts`).
 * - With the gyroscope the markers only place the board and the gyroscope turns it (`fusion.mts`); and the camera's
 *   picture is drawn behind the board in the 3D view, each picture with the pose for the moment it was taken, so the
 *   two never part. Without one, the markers' own pose glides between findings over the live video.
 *
 * The AR button leaves. The panel holds the settings: a square's size on the table, what stands on the first marker,
 * the field of view (and calibrating again), the printouts, and the tracking's numbers for a look.
 */
import type { ArPose } from '../../src/app/online/tools/arViews';
import { VIEW_EVERY_MS, ViewSender } from './viewSender.mts';
import type { AugmentedView, RoomPlace } from '../../src/app/online/obsidian/playerBoardContract';
import { readArSettings, saveArSettings, SQUARES_MM, type ArSettings, type Tracking } from './arPrefs.mts';
import { keepFov, keptFov } from './calibrate.mts';
import { CalibrationWizard } from './calibrationWizard.mts';
import { CAMERA_LAG_MS, deviceRotation, SensorFusion } from './fusion.mts';
import { MarkerLayout } from './markerLayout.mts';
import { CARD_MM, CARD_PAGES, CARDS_PER_PAGE, MAT_MM, MAT_PAGES, markerCardsSvg, markerMatSvg, markerSheetSvg, MARKER_MM } from './markerSheet.mts';
import { coverCrop, coverFrustum, intrinsicsFor, type Intrinsics } from './sheetPose.mts';
import { PoseEaser, PoseSmoother, SheetTracker, type Detected, type Tracked } from './sheetTracker.mts';
import type { TrackAnswer, TrackRequest } from './trackerWorker.mts';

/** The board as augmented reality needs it. */
export interface ArBoard {
  setAugmented(view: AugmentedView | null): boolean;
  readonly roomAr?: boolean;
  startRoomAr?(session: unknown, onFrame: ((frame: unknown, space: unknown) => void) | null): Promise<boolean>;
  placeRoomAr?(place: RoomPlace | null): void;
  stopRoomAr?(): void;
  roomStats?(): { frames: number; intervalMs: number; workMs: number; errors: number; lastError: string } | null;
  arViewer?(): ArPose | null;
}

export interface ArModeOptions {
  /** The camera (printed markers), asked for inside the player's tap as iOS wants; null on the room tracking path. */
  stream: Promise<MediaStream> | null;
  /** Whether the phone's motion sensors may be read (asked for inside the tap too, as iOS wants). */
  motion?: Promise<boolean>;
  /** Room tracking's WebXR session, asked for inside the tap; absent for printed markers. */
  session?: Promise<unknown> | null;
  /** Whether this phone and board could track the room (the panel offers to switch). */
  roomCapable?: boolean;
  video: HTMLVideoElement;
  /** Room tracking's DOM overlay (see-through while it shows). */
  overlay?: HTMLElement;
  /** The board's element: the camera's picture covers it. */
  boardEl: HTMLElement;
  /** The AR button's menu: the settings, opened by the button while AR is on. */
  panel: HTMLElement;
  board(): ArBoard | null;
  /** The player's tokens, to stand one on the first marker (or the placed point). */
  tokens(): Array<{ id: string; name: string }>;
  /** Augmented reality ended (Leave, or the camera or session stopped). */
  onEnd(): void;
  /** The player chose the other tracking in the menu (a tap: AR starts again with it there and then). */
  onSwitch?(tracking: Tracking): void;
  /** Tells the GM where the camera is (the eye on the GM's board); null when not tracking. False when it cannot go. */
  sendView?(pose: ArPose | null): boolean;
}

/** The longest side of the picture searched for markers: big enough to read them at arm's length, small enough to be quick. */
const SEARCH_PX = 640;
/** The longest side of the camera picture drawn behind the board. */
const FRAME_PX = 1280;
/** How long the gyroscope carries the board without the markers before it shows faint (the place is the last found). */
const FUSED_HOLD_MS = 400;
/** The camera picture asked for. */
const VIDEO = { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } as const;

/** Searches pictures for markers in a worker; on the page's thread where workers cannot start. */
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

/** How the camera picture is cut and scaled: from the video, to the picture drawn behind the board, to the one searched. */
interface Geometry {
  videoWidth: number;
  videoHeight: number;
  crop: { x: number; y: number; width: number; height: number };
  /** Video pixels to drawn-picture pixels, and drawn to searched. */
  frameScale: number;
  searchScale: number;
  frameWidth: number;
  frameHeight: number;
  searchWidth: number;
  searchHeight: number;
}

type Phase = 'starting' | 'calibrating' | 'placing' | 'tracking';

/** The minimal WebXR this file uses (the page's TypeScript has no WebXR types). */
interface XrSessionLike extends EventTarget {
  end(): Promise<void>;
  requestReferenceSpace(type: string): Promise<unknown>;
  requestHitTestSource?(options: { space: unknown }): Promise<{ cancel(): void }> | undefined;
}
interface XrFrameLike {
  getHitTestResults(source: unknown): Array<{ getPose(space: unknown): { transform: { position: { x: number; y: number; z: number } } } | null }>;
  getViewerPose(space: unknown): { transform: { position: { x: number; y: number; z: number } }; emulatedPosition?: boolean } | null;
}

export class ArMode {
  private settings: ArSettings = readArSettings();
  private ended = false;
  private readonly urls: string[] = [];
  /** What to do now, over the top of the picture. */
  private readonly hint: HTMLElement;
  /** The tracking's numbers, in a corner. */
  private readonly debugBox: HTMLPreElement;
  private anchorSelect!: HTMLSelectElement;
  private fovLabel: HTMLElement | null = null;
  private wizard: CalibrationWizard | null = null;
  private readonly doc: Document;

  // ── Printed markers ──
  private stream: MediaStream | null = null;
  private readonly searcher = new Searcher();
  private readonly smoother = new PoseSmoother();
  private readonly easer = new PoseEaser();
  private readonly fusion = new SensorFusion();
  private readonly layout = new MarkerLayout();
  private phase: Phase = 'starting';
  private fov: number;
  private cameraKey = '';
  private readonly frame: HTMLCanvasElement;
  private readonly grab: HTMLCanvasElement;
  private videoFrameId = 0;
  private animationId = 0;
  private lastFrame = 0;
  private found = false;
  private stopMotion: (() => void) | null = null;
  private sweepUntil = 0;
  private readonly stats = { searches: 0, since: performance.now(), rate: 0, markers: [] as number[], error: 0, mode: 'markers', place: [0, 0, 0] };

  // ── Room tracking ──
  private session: XrSessionLike | null = null;
  private hitSource: { cancel(): void } | null = null;
  private preview: { position: number[]; yaw: number } | null = null;
  private placed = false;
  private stopUi: (() => void) | null = null;
  private roomTimer = 0;

  // ── The GM's eye ──
  private readonly viewSender: ViewSender | null;
  private viewTimer = 0;

  constructor(private readonly options: ArModeOptions) {
    this.doc = options.video.ownerDocument;
    this.frame = this.doc.createElement('canvas');
    this.grab = this.doc.createElement('canvas');
    this.fov = this.settings.fov;
    const overlay = this.overlay();
    this.hint = Object.assign(this.doc.createElement('p'), { className: 'ar-hint', hidden: true });
    this.hint.setAttribute('role', 'status');
    this.debugBox = Object.assign(this.doc.createElement('pre'), { className: 'ar-debug', hidden: !this.settings.debug });
    overlay.append(this.hint, this.debugBox);
    const room = options.session ?? null;
    this.buildPanel(room !== null);
    // Where the camera is, for the GM's board, ten times a second at most.
    this.viewSender = options.sendView ? new ViewSender((pose) => options.sendView?.(pose) ?? false) : null;
    if (this.viewSender) this.viewTimer = window.setInterval(() => this.sendView(), VIEW_EVERY_MS);
    if (room) {
      this.say('Starting room tracking…');
      room.then((session) => this.beginRoom(session as XrSessionLike), (error: unknown) => {
        console.warn('[Atlas VTT Connect] Room tracking could not start; using printed markers:', error);
        this.fallBackToMarkers();
      });
      return;
    }
    this.beginMarkers(options.stream, options.motion);
  }

  private sendView(): void {
    if (this.ended || !this.viewSender) return;
    let pose: ArPose | null = null;
    try {
      pose = this.options.board()?.arViewer?.() ?? null;
    } catch {
      pose = null;
    }
    this.viewSender.update(pose, performance.now());
  }

  /** Whether augmented reality is still on. */
  get active(): boolean {
    return !this.ended;
  }

  // ── Printed markers ─────────────────────────────────────────────────────────

  private beginMarkers(stream: Promise<MediaStream> | null, motion: Promise<boolean> | undefined): void {
    this.say('Starting the camera…');
    void motion?.then((allowed) => { if (allowed && !this.ended) this.listenToMotion(); }, () => undefined);
    const camera = stream ?? Promise.reject(new Error('No camera asked for'));
    camera.then((media) => this.startCamera(media), (error: unknown) => {
      const name = (error as { name?: string } | null)?.name;
      this.say(name === 'NotAllowedError'
        ? 'The camera was not allowed. Allow it for this page in the browser\'s settings, then try again.'
        : 'The camera could not start. Open the page in Safari or Chrome itself (not inside another app), over https.');
    });
  }

  /** Room tracking would not start: the printed markers instead (the camera asked for now, outside the tap: Android allows it). */
  private fallBackToMarkers(): void {
    if (this.ended) return;
    this.buildPanel(false);
    const media = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
    const stream = typeof media?.getUserMedia === 'function' ? media.getUserMedia({ video: VIDEO, audio: false }) : null;
    const win = this.doc.defaultView as (Window & { DeviceOrientationEvent?: unknown }) | null;
    this.beginMarkers(stream, Promise.resolve(win?.DeviceOrientationEvent !== undefined));
  }

  private startCamera(stream: MediaStream): void {
    if (this.ended) { for (const track of stream.getTracks()) track.stop(); return; }
    this.stream = stream;
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => this.end());
    const { video, boardEl } = this.options;
    video.srcObject = stream;
    video.hidden = false;
    boardEl.classList.add('is-ar', 'is-ar-searching');
    video.play().catch(() => undefined);
    this.schedule();
  }

  /** The gyroscope's readings, into the fusion. */
  private listenToMotion(): void {
    const win = this.doc.defaultView ?? window;
    const read = (event: DeviceOrientationEvent): void => {
      if (event.alpha === null || event.beta === null || event.gamma === null) return;
      const screen = win.screen?.orientation?.angle ?? (win as unknown as { orientation?: number }).orientation ?? 0;
      this.fusion.orient(deviceRotation(event.alpha, event.beta, event.gamma, screen), performance.now());
    };
    win.addEventListener('deviceorientation', read);
    this.stopMotion = () => win.removeEventListener('deviceorientation', read);
  }

  /** The next camera picture: as it comes, where the browser says (with when it was taken), else the next screen frame. */
  private schedule(): void {
    if (this.ended) return;
    const video = this.options.video as HTMLVideoElement & { requestVideoFrameCallback?: (callback: (now: number, meta: { captureTime?: number }) => void) => number };
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.videoFrameId = video.requestVideoFrameCallback((now, meta) => this.onPicture(meta.captureTime));
    } else {
      this.animationId = window.requestAnimationFrame(() => this.onPicture(undefined));
    }
  }

  /** How the picture is cut for this screen, now. */
  private geometry(): Geometry | null {
    const { video, boardEl } = this.options;
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight || !boardEl.clientWidth || !boardEl.clientHeight || video.readyState < 2) return null;
    const crop = coverCrop(videoWidth, videoHeight, boardEl.clientWidth, boardEl.clientHeight);
    const frameScale = Math.min(1, FRAME_PX / Math.max(crop.width, crop.height));
    const frameWidth = Math.max(1, Math.round(crop.width * frameScale));
    const frameHeight = Math.max(1, Math.round(crop.height * frameScale));
    const searchScale = Math.min(1, SEARCH_PX / Math.max(frameWidth, frameHeight));
    return {
      videoWidth, videoHeight, crop, frameScale, searchScale, frameWidth, frameHeight,
      searchWidth: Math.max(1, Math.round(frameWidth * searchScale)), searchHeight: Math.max(1, Math.round(frameHeight * searchScale)),
    };
  }

  /** The camera as seen in the searched picture: the video's lens, cut and scaled. */
  private searchCamera(g: Geometry): Intrinsics {
    const video = intrinsicsFor(g.videoWidth, g.videoHeight, this.fov);
    const scale = g.frameScale * g.searchScale;
    return { f: video.f * scale, cx: (video.cx - g.crop.x) * scale, cy: (video.cy - g.crop.y) * scale };
  }

  private onPicture(captureTime: number | undefined): void {
    this.videoFrameId = 0;
    this.animationId = 0;
    if (this.ended) return;
    const g = this.geometry();
    if (!g) { this.schedule(); return; }
    const now = performance.now();
    const dt = this.lastFrame === 0 ? 0 : Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // When the picture was taken: the browser's word for it when it gives one, else a moment before it came.
    const taken = typeof captureTime === 'number' && Number.isFinite(captureTime) && now - captureTime < 500 && captureTime <= now ? captureTime : now - CAMERA_LAG_MS;
    if (this.phase === 'starting') this.decideCalibration(g);
    // The picture, cut to the screen: drawn behind the board, and searched.
    if (this.frame.width !== g.frameWidth) this.frame.width = g.frameWidth;
    if (this.frame.height !== g.frameHeight) this.frame.height = g.frameHeight;
    const context = this.frame.getContext('2d');
    if (context) context.drawImage(this.options.video, g.crop.x, g.crop.y, g.crop.width, g.crop.height, 0, 0, g.frameWidth, g.frameHeight);
    if (!this.searcher.busy) this.search(g, taken);
    this.draw(g, taken, dt);
    this.schedule();
  }

  /** Calibrated before (this camera, this picture size)? Straight to placing; else calibrate first. */
  private decideCalibration(g: Geometry): void {
    const label = this.stream?.getVideoTracks()[0]?.label ?? 'camera';
    this.cameraKey = `${label}|${Math.max(g.videoWidth, g.videoHeight)}x${Math.min(g.videoWidth, g.videoHeight)}`;
    const kept = keptFov(this.cameraKey);
    if (kept !== null) {
      this.setFov(kept, false);
      this.startPlacing(`Camera calibrated before (${Math.round(kept)}°).`);
    } else {
      this.startCalibrating();
    }
  }

  private search(g: Geometry, taken: number): void {
    if (this.grab.width !== g.searchWidth) this.grab.width = g.searchWidth;
    if (this.grab.height !== g.searchHeight) this.grab.height = g.searchHeight;
    const context = this.grab.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(this.frame, 0, 0, g.searchWidth, g.searchHeight);
    const image = context.getImageData(0, 0, g.searchWidth, g.searchHeight);
    const camera = this.searchCamera(g);
    const fov = this.fov;
    void this.searcher.search({ picture: { width: g.searchWidth, height: g.searchHeight, data: image.data }, camera }).then((markers) => {
      // A picture searched with a field of view since changed says nothing true.
      if (!this.ended && fov === this.fov) this.found_(markers, camera, g, taken);
    });
  }

  /** Markers found in a picture taken at `taken`. */
  private found_(markers: Detected[], camera: Intrinsics, g: Geometry, taken: number): void {
    this.countSearch(markers);
    if (this.phase === 'calibrating') { this.calibrate(markers, camera, g); return; }
    if (this.phase === 'starting') return;
    const tracked = this.layout.observe(markers, camera, g.searchWidth, this.fusion.turnAt(taken));
    if (tracked) {
      this.fusion.found(tracked.pose.rotation, tracked.sheet, tracked.seen, camera, taken);
      this.stats.error = tracked.pose.error;
    }
    this.tracked(tracked);
  }

  private tracked(tracked: Tracked | null): void {
    const now = performance.now();
    const pose = this.smoother.next(tracked?.pose ?? null, now);
    const { boardEl } = this.options;
    const fused = this.fusion.sensing(now) && this.fusion.tracking(now, FUSED_HOLD_MS);
    if (tracked && this.phase === 'placing') {
      this.phase = 'tracking';
      this.sweepUntil = now + 10_000;
    }
    if (pose || fused) {
      if (pose) this.easer.aim(pose);
      if (!this.found) {
        this.found = true;
        boardEl.classList.remove('is-ar-searching', 'is-ar-lost');
      }
      if (tracked) this.say(now < this.sweepUntil ? `Now sweep slowly over your other mats and cards so they are placed (${this.layout.size} placed).` : '');
    } else if (this.found) {
      // Out of sight: the board stays until markers are found again; faint over the live video, but not while it draws
      // the camera's picture itself (the whole view would dim).
      this.found = false;
      if (!this.fusion.sensing(now)) boardEl.classList.add('is-ar-lost');
      this.say('Point the camera at a mat, card or the sheet.');
    }
  }

  /** Draws the board for the picture just taken. */
  private draw(g: Geometry, taken: number, dt: number): void {
    const board = this.options.board();
    const { video, boardEl } = this.options;
    let synced = false;
    if (board && this.phase === 'tracking') {
      const now = performance.now();
      const frustum = coverFrustum(intrinsicsFor(g.videoWidth, g.videoHeight, this.fov), g.videoWidth, g.videoHeight, boardEl.clientWidth, boardEl.clientHeight);
      const base = { frustum, squareMm: this.settings.squareMm, anchor: this.anchor() };
      const sensing = this.fusion.sensing(now);
      const fused = sensing ? this.fusion.pose(taken, dt) : null;
      if (fused) {
        // The gyroscope turns it: the picture drawn behind the board in the 3D view, with the pose for its moment.
        synced = board.setAugmented({ ...base, rotation: fused.rotation, translation: fused.translation, background: this.frame });
        this.stats.mode = 'gyroscope';
        const r = fused.rotation;
        const t = fused.translation;
        this.stats.place = [0, 1, 2].map((k) => -(r[k]! * t[0]! + r[3 + k]! * t[1]! + r[6 + k]! * t[2]!));
      } else if (!sensing) {
        const eased = this.easer.step(dt).pose;
        if (eased) board.setAugmented({ ...base, rotation: eased.rotation, translation: eased.translation });
        this.stats.mode = 'markers';
      }
    }
    // The live video shows only when the board does not draw the picture itself.
    video.classList.toggle('is-behind', synced);
    // What steadies the board, for a look in the page's inspector (and the tests).
    boardEl.dataset.arSteadiedBy = synced ? 'gyroscope' : 'markers';
  }

  // ── Calibration ──

  private startCalibrating(): void {
    this.phase = 'calibrating';
    this.closeMenu();
    this.options.boardEl.classList.add('is-ar-searching');
    this.say('');
    this.wizard?.dispose();
    this.wizard = new CalibrationWizard(this.overlay(), {
      done: (fov) => {
        keepFov(this.cameraKey, fov);
        this.setFov(fov, false);
        this.startPlacing(`Camera calibrated: ${fov.toFixed(1)}°.`);
      },
      skip: () => this.startPlacing(`Calibration skipped (field of view ${Math.round(this.fov)}°).`),
      currentFov: () => this.fov,
    });
  }

  private calibrate(markers: readonly Detected[], camera: Intrinsics, g: Geometry): void {
    const long = Math.max(g.videoWidth, g.videoHeight) * g.frameScale * g.searchScale;
    this.wizard?.observe(markers, camera, long, g.searchWidth);
  }

  private startPlacing(before: string): void {
    this.wizard?.dispose();
    this.wizard = null;
    this.phase = 'placing';
    this.resetPlaces();
    this.say(`${before} Now point the camera at the mat, card or sheet the map's middle should stand on.`);
    this.showFov();
  }

  /** Forgets where the markers lie and where the camera was (a new field of view, or placing again). */
  private resetPlaces(): void {
    this.layout.reset();
    this.fusion.reset();
    this.smoother.reset();
    this.easer.aim(null);
    this.found = false;
    this.options.boardEl.classList.add('is-ar-searching');
    this.options.boardEl.classList.remove('is-ar-lost');
  }

  private setFov(fov: number, keep: boolean): void {
    const changed = Math.abs(fov - this.fov) > 1e-6;
    this.fov = fov;
    this.showFov();
    if (keep && this.cameraKey) keepFov(this.cameraKey, fov);
    // Places found with another field of view are off: found again.
    if (changed && this.phase === 'tracking') {
      this.phase = 'placing';
      this.resetPlaces();
      this.say('Field of view changed: point the camera at the mat, card or sheet the map\'s middle should stand on.');
    }
  }

  private countSearch(markers: readonly Detected[]): void {
    const stats = this.stats;
    stats.searches++;
    stats.markers = markers.map((marker) => marker.id);
    const now = performance.now();
    if (now - stats.since >= 1000) {
      stats.rate = (stats.searches * 1000) / (now - stats.since);
      stats.searches = 0;
      stats.since = now;
    }
    if (this.settings.debug && !this.debugBox.hidden) {
      const place = stats.place.map((v) => Math.round(v)).join(', ');
      this.debugBox.textContent = [
        `tracking ${stats.mode} · ${this.phase}`,
        `markers ${stats.markers.length ? stats.markers.join(' ') : '—'} · ${stats.rate.toFixed(1)}/s`,
        `fit error ${stats.error.toFixed(2)} px · field of view ${this.fov.toFixed(1)}°`,
        `placed ${this.layout.size} · camera at ${place} mm`,
        `gyroscope ${this.fusion.sensing(now) ? 'on' : 'off'} · camera ${this.cameraKey}`,
        this.gmLine(),
      ].join('\n');
    }
  }

  /** The token on the first marker: the chosen one while it is still the player's. */
  private anchor(): string | null {
    const anchor = this.settings.anchor;
    return anchor !== null && this.options.tokens().some((token) => token.id === anchor) ? anchor : null;
  }

  // ── Room tracking ───────────────────────────────────────────────────────────

  private beginRoom(session: XrSessionLike): void {
    if (this.ended) { session.end().catch(() => undefined); return; }
    const board = this.options.board();
    if (!board?.startRoomAr) { session.end().catch(() => undefined); this.fallBackToMarkers(); return; }
    this.session = session;
    this.stats.mode = 'room';
    // Without the page's overlay there would be no panel (and no way back to the markers): markers, then.
    if (!(session as unknown as { domOverlayState?: unknown }).domOverlayState) {
      this.change({ tracking: 'markers' });
      this.session = null;
      session.end().catch(() => undefined);
      this.fallBackToMarkers();
      return;
    }
    session.addEventListener('end', () => {
      // Ended before the board was ever put down: room tracking did not work here; markers next time.
      if (!this.placed) this.change({ tracking: 'markers' });
      this.end();
    });
    // A tap on the panel or the AR button is not a tap on the table.
    const ui = this.options.panel.parentElement ?? this.options.panel;
    const keep = (event: Event): void => event.preventDefault();
    ui.addEventListener('beforexrselect', keep);
    this.stopUi = () => ui.removeEventListener('beforexrselect', keep);
    this.options.overlay?.classList.add('is-room-ar-overlay');
    // The frame times, for a look (Show tracking numbers).
    this.roomTimer = window.setInterval(() => this.showRoomStats(), 500);
    session.addEventListener('select', () => {
      if (!this.placed && this.preview) {
        this.placed = true;
        this.say('');
      }
    });
    this.options.boardEl.classList.add('is-room-ar');
    board.startRoomAr(session, (frame, space) => this.roomFrame(frame as XrFrameLike, space)).then((started) => {
      if (!started) throw new Error('The board would not draw into the session');
      this.say('Move the phone slowly over the table until the board shows on it, then tap to put it down.');
      return session.requestReferenceSpace('viewer');
    }).then((viewer) => session.requestHitTestSource?.({ space: viewer })).then((source) => {
      if (source) this.hitSource = source;
      else this.say('This phone cannot find the table: tap AR settings, then Use printed markers.');
    }).catch((error: unknown) => {
      console.warn('[Atlas VTT Connect] Room tracking failed:', error);
      session.end().catch(() => undefined);
    });
  }

  private roomFrame(frame: XrFrameLike, space: unknown): void {
    const board = this.options.board();
    if (!board?.placeRoomAr || !space) return;
    if (!this.placed && this.hitSource) {
      const hit = frame.getHitTestResults(this.hitSource)[0]?.getPose(space);
      if (hit) {
        const p = hit.transform.position;
        const viewer = frame.getViewerPose(space)?.transform.position;
        // The map's up faces away from the player.
        const yaw = viewer ? Math.atan2(-(p.x - viewer.x), -(p.z - viewer.z)) : 0;
        this.preview = { position: [p.x, p.y, p.z], yaw };
      }
    }
    const at = this.preview;
    board.placeRoomAr(at ? { position: at.position, yaw: at.yaw, squareMm: this.settings.squareMm, anchor: this.anchor() } : null);
    if (this.placed && at) this.roomHint(frame.getViewerPose(space), at.position[1]!);
  }

  /**
   * Room tracking close in: the phone tracks the room by what its camera sees, and a hand's breadth over a plain table it
   * sees too little; it says so (its position only guessed), and the player is told why the board slips.
   */
  private roomHint(viewer: { transform: { position: { y: number } }; emulatedPosition?: boolean } | null, table: number): void {
    const now = performance.now();
    if (now - this.roomHintAt < 300) return;
    this.roomHintAt = now;
    const height = viewer ? viewer.transform.position.y - table : null;
    const words = !viewer || viewer.emulatedPosition
      ? 'The phone lost track of the room: move back a little so it sees more of the table (printed markers track closer in).'
      : height !== null && height < 0.15
        ? 'Very close: the phone may lose track. A mat page under the map helps it see the table.'
        : '';
    if (words !== this.hint.textContent) this.say(words);
  }

  private roomHintAt = 0;

  private showRoomStats(): void {
    if (!this.settings.debug) return;
    const stats = this.options.board()?.roomStats?.();
    if (!stats) return;
    const fps = stats.intervalMs > 0 ? 1000 / stats.intervalMs : 0;
    this.debugBox.textContent = [
      `room tracking · ${this.placed ? 'placed' : this.preview ? 'table found' : 'looking for the table'}`,
      `${fps.toFixed(1)} frames/s · ${stats.intervalMs.toFixed(0)} ms apart`,
      `drawing a frame ${stats.workMs.toFixed(1)} ms · ${stats.frames} frames`,
      `errors ${stats.errors}${stats.lastError ? `: ${stats.lastError.slice(0, 120)}` : ''}`,
      this.gmLine(),
    ].join('\n');
  }

  /** What the GM's board is told of this phone (its eye there). */
  private gmLine(): string {
    const counts = this.viewSender?.counts;
    if (!counts) return 'GM eye: off';
    const at = counts.last ? counts.last.position.map((v) => Math.round(v)).join(', ') : '—';
    return `GM eye: sent ${counts.sent} · not sent ${counts.refused} · no pose ${counts.noPose} · at ${at}`;
  }

  // ── The panel ───────────────────────────────────────────────────────────────

  private say(words: string): void {
    this.hint.textContent = words;
    this.hint.hidden = words === '';
  }

  /** Where the hint, the calibration card and the numbers go: the scene, over the picture. */
  private overlay(): HTMLElement {
    return this.options.overlay ?? this.options.boardEl.parentElement ?? this.options.boardEl;
  }

  private room = false;

  /** Opens or closes the AR menu (the AR button, while AR is on). */
  toggleMenu(): void {
    this.options.panel.hidden = !this.options.panel.hidden;
  }

  private closeMenu(): void {
    this.options.panel.hidden = true;
  }

  /** Whether the AR menu is open. */
  get menuOpen(): boolean {
    return !this.options.panel.hidden;
  }

  private showFov(): void {
    if (this.fovLabel) this.fovLabel.textContent = `Camera: ${this.fov.toFixed(1)}° field of view${this.cameraKey && keptFov(this.cameraKey) !== null ? ', calibrated' : ''}`;
  }

  private buildPanel(room: boolean): void {
    this.room = room;
    const { panel } = this.options;
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(this.doc.createElement(tag), props);
    const field = (label: string, control: HTMLElement): HTMLElement => {
      const wrap = make('label', { className: 'ar-field' });
      wrap.append(make('span', { textContent: label }), control);
      return wrap;
    };
    const button = (words: string, act: () => void, className = 'menu-entry'): HTMLButtonElement => {
      const element = make('button', { type: 'button', className, textContent: words });
      element.setAttribute('role', 'menuitem');
      element.addEventListener('click', act);
      return element;
    };
    const heading = (words: string): HTMLElement => make('div', { className: 'menu-label', textContent: words });

    const square = make('select');
    for (const size of SQUARES_MM) square.append(make('option', { value: String(size), textContent: `${size} mm`, selected: size === this.settings.squareMm }));
    square.addEventListener('change', () => this.change({ squareMm: Number(square.value) }));
    this.anchorSelect = make('select');
    this.anchorSelect.addEventListener('change', () => this.change({ anchor: this.anchorSelect.value === '' ? null : this.anchorSelect.value }));
    this.fillAnchors();

    const parts: HTMLElement[] = [];
    if (this.options.roomCapable) {
      // Markers or the room: a tap here starts AR again with the other there and then.
      const tracking = make('div', { className: 'ar-segmented' });
      tracking.setAttribute('role', 'radiogroup');
      tracking.setAttribute('aria-label', 'Tracking');
      for (const [value, words] of [['markers', 'Printed markers'], ['room', 'Room (no printouts)']] as const) {
        const option = make('button', { type: 'button', textContent: words, className: room === (value === 'room') ? 'is-selected' : '' });
        option.setAttribute('role', 'radio');
        option.setAttribute('aria-checked', String(room === (value === 'room')));
        option.addEventListener('click', () => {
          if (room === (value === 'room')) return;
          this.change({ tracking: value });
          this.options.onSwitch?.(value);
        });
        tracking.append(option);
      }
      parts.push(heading('Tracking'), tracking);
    }
    parts.push(heading('Board'), field('A square on the table', square), field(room ? 'On the point' : 'On the first marker seen', this.anchorSelect));
    if (room) {
      parts.push(button('Move the board', () => { this.placed = false; this.closeMenu(); this.say('Point at the table, then tap to put the board down.'); }));
    } else {
      this.fovLabel = make('div', { className: 'menu-hint' });
      this.showFov();
      parts.push(
        heading('Camera'),
        this.fovLabel,
        button('Calibrate the camera…', () => this.startCalibrating()),
        button('Place again', () => { this.closeMenu(); this.startPlacing('Placing again.'); }),
      );
      const link = (svg: string, file: string, words: string, label: string): HTMLAnchorElement => {
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        this.urls.push(url);
        const anchor = make('a', { href: url, download: file, target: '_blank', rel: 'noopener', textContent: words, className: 'ar-print' });
        anchor.setAttribute('aria-label', label);
        return anchor;
      };
      const prints = make('details', { className: 'ar-prints' });
      prints.append(make('summary', { textContent: 'Print markers (A4, at 100%)' }));
      for (let page = 0; page < MAT_PAGES; page++) prints.append(link(markerMatSvg(page), `atlas-ar-mat-${page + 1}.svg`, `Mat page ${page + 1}`, `Mat page ${page + 1} to print on A4 at 100%: each black square is ${MAT_MM} mm`));
      prints.append(link(markerSheetSvg(), 'atlas-ar-marker-sheet.svg', 'Marker sheet', `Marker sheet to print on A4 at 100%: each black square is ${MARKER_MM} mm`));
      for (let page = 0; page < CARD_PAGES; page++) {
        const first = page * CARDS_PER_PAGE + 1;
        prints.append(link(markerCardsSvg(page), `atlas-ar-cards-${first}-${first + CARDS_PER_PAGE - 1}.svg`, `Marker cards ${first}–${first + CARDS_PER_PAGE - 1}`, `Marker cards to print on A4 at 100% and cut out: each black square is ${CARD_MM} mm`));
      }
      parts.push(prints);
    }
    const debug = make('input', { type: 'checkbox', checked: this.settings.debug });
    debug.addEventListener('change', () => { this.change({ debug: debug.checked }); this.debugBox.hidden = !debug.checked; });
    const debugRow = make('label', { className: 'ar-check' });
    debugRow.append(debug, make('span', { textContent: 'Show tracking numbers' }));
    const leave = button('Leave AR', () => this.end(), 'menu-entry ar-leave');
    leave.id = 'ar-leave';
    parts.push(debugRow, leave);
    panel.replaceChildren(...parts);
    panel.hidden = true;
  }

  /** The anchor's choices: the map's middle, and the player's tokens. */
  fillAnchors(): void {
    const select = this.anchorSelect;
    const tokens = this.options.tokens();
    const options = [{ id: '', name: 'Map middle' }, ...tokens];
    select.replaceChildren(...options.map((token) => Object.assign(this.doc.createElement('option'), { value: token.id, textContent: token.name, selected: token.id === (this.anchor() ?? '') })));
  }

  private change(change: Partial<ArSettings>): void {
    this.settings = { ...this.settings, ...change };
    saveArSettings(this.settings);
  }

  /** Ends augmented reality: the camera (or session) stops and the board takes its usual camera again. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    const { video, boardEl, panel } = this.options;
    if (this.videoFrameId) (video as HTMLVideoElement & { cancelVideoFrameCallback?: (id: number) => void }).cancelVideoFrameCallback?.(this.videoFrameId);
    if (this.animationId) window.cancelAnimationFrame(this.animationId);
    if (this.roomTimer) window.clearInterval(this.roomTimer);
    if (this.viewTimer) window.clearInterval(this.viewTimer);
    this.viewSender?.stop();
    this.searcher.dispose();
    this.stopMotion?.();
    this.stopMotion = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.hitSource?.cancel();
    this.hitSource = null;
    const session = this.session;
    this.session = null;
    if (session) this.options.board()?.stopRoomAr?.();
    video.pause();
    video.srcObject = null;
    video.hidden = true;
    video.classList.remove('is-behind');
    boardEl.classList.remove('is-ar', 'is-ar-searching', 'is-ar-lost', 'is-room-ar');
    this.options.overlay?.classList.remove('is-room-ar-overlay');
    this.stopUi?.();
    this.stopUi = null;
    delete boardEl.dataset.arSteadiedBy;
    panel.hidden = true;
    panel.replaceChildren();
    this.wizard?.dispose();
    this.wizard = null;
    this.hint.remove();
    this.debugBox.remove();
    for (const url of this.urls.splice(0)) URL.revokeObjectURL(url);
    this.options.board()?.setAugmented(null);
    this.options.onEnd();
  }
}
