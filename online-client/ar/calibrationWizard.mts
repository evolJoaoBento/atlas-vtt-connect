// online-client/ar/calibrationWizard.mts
/**
 * Calibrating the camera, step by step: a card in the middle of the screen that walks the player through it.
 *
 * 1. Lay a mat page (or the A4 sheet) flat, in even light.
 * 2. From above: the whole page in the picture, held still. This checks the page reads well before anything counts.
 * 3–6. From each side of the page in turn (its bottom edge, right, top, left), leaning back to look at it at a slant of
 *    30–60°. A checklist says, live, what is right and what is not (page in sight, side, slant, held still, sharp); the
 *    Capture button counts only once all of it is right, and then takes a few pictures that pass.
 * 7. The result: the field of view, how well the pictures agreed, a fine-tune, Save or Redo.
 *
 * The slant is what tells the focal length (`calibrate.mts`); pictures from all four sides cancel out a phone held a
 * little crooked or a lens a little off centre.
 */
import { FovCalibration } from './calibrate.mts';
import { markerGroup, TOP_MARK } from './markerSheet.mts';
import { homography, sheetPose, type Intrinsics, type Point } from './sheetPose.mts';
import type { Detected } from './sheetTracker.mts';

export type Side = 'bottom' | 'right' | 'top' | 'left';

/** How the page shows in one picture. */
export interface PageView {
  /** Markers of the page in sight. */
  markers: number;
  /** Markers needed for the page to read well. */
  needed: number;
  /** How far the view is from straight down on the page (degrees). */
  slant: number;
  /** Which side of the page the camera is over (null when nearly straight above). */
  side: Side | null;
  /** How far the corners land from where the page's fit puts them (pixels): small when the picture is sharp. */
  fitError: number;
  /** The page's middle in the picture and its size there (pixels), to tell a phone held still. */
  center: Point;
  size: number;
  /** The page's homography (page millimetres to picture pixels). */
  homography: number[];
}

/** The page best in sight (the one with most markers; mats and the A4 sheet only, their markers fixed on them). */
export function pageView(markers: readonly Detected[], camera: Intrinsics): PageView | null {
  const groups = new Map<string, { local: Point[]; seen: Point[]; count: number }>();
  for (const marker of markers) {
    const group = markerGroup(marker.id);
    if (!group || group.group.startsWith('card-')) continue;
    const entry = groups.get(group.group) ?? { local: [], seen: [], count: 0 };
    entry.local.push(...group.corners);
    entry.seen.push(...marker.seen);
    entry.count++;
    groups.set(group.group, entry);
  }
  let best: [string, { local: Point[]; seen: Point[]; count: number }] | null = null;
  for (const entry of groups) if (!best || entry[1].count > best[1].count) best = entry;
  if (!best || best[1].count < 2) return null;
  const [name, { local, seen, count }] = best;
  const h = homography(local, seen);
  const pose = sheetPose(local, seen, camera);
  if (!h || !pose) return null;
  const r = pose.rotation;
  const t = pose.translation;
  // The camera over the page: −Rᵀt (page x right, y down the page, z into the table).
  const eye = [0, 1, 2].map((k) => -(r[k]! * t[0]! + r[3 + k]! * t[1]! + r[6 + k]! * t[2]!));
  const slant = (Math.atan2(Math.hypot(eye[0]!, eye[1]!), -eye[2]!) * 180) / Math.PI;
  const azimuth = (Math.atan2(eye[1]!, eye[0]!) * 180) / Math.PI;
  const side: Side | null = slant < 12 ? null : azimuth >= -45 && azimuth < 45 ? 'right' : azimuth >= 45 && azimuth < 135 ? 'bottom' : azimuth >= -135 && azimuth < -45 ? 'top' : 'left';
  const xs = seen.map((p) => p.x);
  const ys = seen.map((p) => p.y);
  return {
    markers: count,
    needed: name === 'sheet' ? 4 : 6,
    slant, side, fitError: homographyError(h, local, seen),
    center: { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
    size: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
    homography: h,
  };
}

/**
 * How far the markers' corners sit from where one flat page puts them (mean, pixels): how cleanly they read. From the
 * homography alone, so it does not hang on the field of view (which the calibration is there to find).
 */
export function homographyError(h: readonly number[], local: readonly Point[], seen: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < local.length; i++) {
    const { x, y } = local[i]!;
    const w = h[6]! * x + h[7]! * y + h[8]!;
    sum += Math.hypot((h[0]! * x + h[1]! * y + h[2]!) / w - seen[i]!.x, (h[3]! * x + h[4]! * y + h[5]!) / w - seen[i]!.y);
  }
  return local.length > 0 ? sum / local.length : Infinity;
}

/** What a step checks, each right or not, with words for the player. */
export interface Check { ok: boolean; words: string }

/** Slant wanted from the sides. */
export const SLANT = { min: 30, max: 60 } as const;
/** How long the page must be in sight from above before Next lets the player on without every tick. */
export const ABOVE_PATIENCE_MS = 6000;
/** Pictures a side's Capture takes. */
export const PER_SIDE = 6;

/** Whether the phone is held still: the page barely moved since the last picture (`width` the picture's). */
export function steady(view: PageView, before: PageView | null, width: number): boolean {
  if (!before) return false;
  return Math.hypot(view.center.x - before.center.x, view.center.y - before.center.y) < width * 0.025 && Math.abs(view.size - before.size) < view.size * 0.05;
}

/** The checks for the step from above. */
export function aboveChecks(view: PageView | null, still: boolean): Check[] {
  return [
    { ok: view !== null && view.markers >= view.needed, words: view ? `Page in sight: ${view.markers} markers` : 'Page in sight: point at a mat page or the A4 sheet' },
    { ok: view !== null && view.slant < 15, words: view ? `Straight above: ${Math.round(view.slant)}° off (under 15°)` : 'Straight above' },
    { ok: view !== null && still, words: 'Held still' },
    { ok: view !== null && view.fitError < 0.8, words: view ? `Sharp: ${view.fitError.toFixed(2)} px (under 0.8)` : 'Sharp' },
  ];
}

const SIDE_NAMES: Record<Side, string> = { bottom: 'its bottom edge', right: 'its right edge', top: 'its top edge (▲ TOP)', left: 'its left edge' };

/** The checks for a step from a side. */
export function sideChecks(side: Side, view: PageView | null, still: boolean): Check[] {
  const slant = view ? Math.round(view.slant) : 0;
  return [
    { ok: view !== null && view.markers >= view.needed, words: view ? `Page in sight: ${view.markers} markers` : 'Page in sight' },
    { ok: view !== null && view.side === side, words: view?.side ? (view.side === side ? `Over ${SIDE_NAMES[side]}` : `Over ${SIDE_NAMES[view.side]}: move round to ${SIDE_NAMES[side]}`) : `Over ${SIDE_NAMES[side]}` },
    { ok: view !== null && slant >= SLANT.min && slant <= SLANT.max, words: view ? `Slant ${slant}° (${slant < SLANT.min ? 'lean back more' : slant > SLANT.max ? 'too low: come up a little' : 'good'}; ${SLANT.min}–${SLANT.max}°)` : `Slant ${SLANT.min}–${SLANT.max}°` },
    { ok: view !== null && still, words: 'Held still' },
    { ok: view !== null && view.fitError < 1, words: view ? `Sharp: ${view.fitError.toFixed(2)} px (under 1)` : 'Sharp' },
  ];
}

/**
 * Makes `target` read as `source` (attributes, text and children), keeping `target`'s own nodes, and their listeners,
 * wherever the two have the same shape; where they do not, `source`'s nodes are taken.
 */
export function morph(target: Element, source: Element): void {
  for (const { name } of [...target.attributes]) if (!source.hasAttribute(name)) target.removeAttribute(name);
  for (const { name, value } of [...source.attributes]) if (target.getAttribute(name) !== value) target.setAttribute(name, value);
  const had = [...target.childNodes];
  const wanted = [...source.childNodes];
  if (had.length !== wanted.length || had.some((node, index) => node.nodeName !== wanted[index]!.nodeName)) {
    target.replaceChildren(...wanted);
    return;
  }
  had.forEach((node, index) => {
    const other = wanted[index]!;
    if (node.nodeType === TEXT_NODE) {
      if (node.nodeValue !== other.nodeValue) node.nodeValue = other.nodeValue;
    } else if (node.nodeType === ELEMENT_NODE) {
      morph(node as Element, other as Element);
    }
  });
}
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

export interface WizardHost {
  /** The calibration was saved: its field of view (long side of the video, degrees). */
  done(fov: number): void;
  /** The player skipped it (the field of view stays as it was). */
  skip(): void;
  /** The field of view the tracking used before (the fine-tune's start when nothing was captured). */
  currentFov(): number;
}

type Step = { kind: 'intro' } | { kind: 'above' } | { kind: 'side'; side: Side } | { kind: 'result' };
const STEPS: Step[] = [{ kind: 'intro' }, { kind: 'above' }, { kind: 'side', side: 'bottom' }, { kind: 'side', side: 'right' }, { kind: 'side', side: 'top' }, { kind: 'side', side: 'left' }, { kind: 'result' }];
const SVG = 'http://www.w3.org/2000/svg';

export class CalibrationWizard {
  private step = 0;
  private readonly calibration = new FovCalibration();
  private before: PageView | null = null;
  private capturing = 0;
  /** When the page was first seen in this step (ms): the step from above lets the player on after a while regardless. */
  private seenSince = 0;
  /** The step (and whether it was capturing) the card was last built for. */
  private drawn = '';
  /** Pictures counted for each side step, so a side taken again drops its own. */
  private readonly perStep = new Map<number, number>();
  private readonly card: HTMLElement;
  private fineTune = 0;

  constructor(private readonly root: HTMLElement, private readonly host: WizardHost) {
    const doc = root.ownerDocument;
    this.card = doc.createElement('section');
    this.card.className = 'ar-wizard';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', 'Calibrate the camera');
    root.append(this.card);
    this.render(null, false);
  }

  /** Markers found in a picture: the live checklist, and the pictures counted while capturing. */
  observe(markers: readonly Detected[], camera: Intrinsics, long: number, width: number): void {
    const kind = STEPS[this.step]!.kind;
    if (kind === 'intro' || kind === 'result') return;
    const view = pageView(markers, camera);
    const still = view !== null && steady(view, this.before, width);
    if (view && this.seenSince === 0) this.seenSince = performance.now();
    this.before = view;
    const current = STEPS[this.step]!;
    if (current.kind === 'side' && this.capturing > 0 && view && sideChecks(current.side, view, still).every((check) => check.ok)) {
      if (this.calibration.add(view.homography, camera.cx, camera.cy, long)) {
        this.capturing--;
        this.perStep.set(this.step, (this.perStep.get(this.step) ?? 0) + 1);
        if (this.capturing === 0) { this.go(this.step + 1); return; }
      }
    }
    this.render(view, still);
  }

  private go(step: number): void {
    this.step = Math.max(0, Math.min(STEPS.length - 1, step));
    this.capturing = 0;
    this.before = null;
    this.seenSince = 0;
    const current = STEPS[this.step]!;
    // A side taken again: its pictures go.
    if (current.kind === 'side') {
      const had = this.perStep.get(this.step) ?? 0;
      if (had > 0 && this.isLastCounted(this.step)) this.calibration.drop(had);
      this.perStep.delete(this.step);
    }
    if (current.kind === 'result') this.fineTune = 0;
    this.render(null, false);
  }

  /** Whether a step's pictures are the last counted (only those can be dropped alone). */
  private isLastCounted(step: number): boolean {
    for (const [other, count] of this.perStep) if (other > step && count > 0) return false;
    return true;
  }

  private estimate(): number {
    return (this.calibration.estimate() ?? this.host.currentFov()) + this.fineTune;
  }

  private render(view: PageView | null, still: boolean): void {
    const doc = this.root.ownerDocument;
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(doc.createElement(tag), props);
    const button = (words: string, act: () => void, primary = false, disabled = false): HTMLButtonElement => {
      const element = make('button', { type: 'button', className: primary ? 'primary' : 'secondary', textContent: words, disabled });
      element.addEventListener('click', act);
      return element;
    };
    const current = STEPS[this.step]!;
    const dots = make('ol', { className: 'ar-wizard__dots' });
    dots.setAttribute('aria-label', `Step ${this.step + 1} of ${STEPS.length}`);
    STEPS.forEach((_, index) => dots.append(make('li', { className: index < this.step ? 'is-done' : index === this.step ? 'is-current' : '' })));
    const title = make('h2', { className: 'ar-wizard__title' });
    const text = make('p', { className: 'ar-wizard__text' });
    const actions = make('div', { className: 'ar-wizard__actions' });
    const parts: Element[] = [dots, title];

    if (current.kind === 'intro') {
      title.textContent = 'Calibrate the camera';
      text.textContent = 'A few steps, once for this phone, so the board sits exactly on the table. You need a mat page (or the marker sheet) printed at 100%, lying flat, in even light with no glare on it. Keep the camera at its normal zoom.';
      parts.push(text, this.diagram(null));
      actions.append(button('Skip for now', () => this.host.skip()), button('Start', () => this.go(1), true));
    } else if (current.kind === 'above') {
      title.textContent = 'From above';
      text.textContent = 'Hold the phone flat over the page, about 30–40 cm up, with the whole page in the picture. Hold it still.';
      const checks = aboveChecks(view, still);
      parts.push(text, this.diagram(null), this.checklist(checks));
      // Only a check of the setup (nothing is measured here): once the page has been in sight a while, on regardless.
      const ready = checks.every((check) => check.ok);
      const patient = this.seenSince > 0 && performance.now() - this.seenSince > ABOVE_PATIENCE_MS;
      actions.append(button('Back', () => this.go(0)), button(ready || !patient ? 'Next' : 'Next anyway', () => this.go(2), true, !ready && !patient));
    } else if (current.kind === 'side') {
      const sideIndex = this.step - 1;
      title.textContent = `From ${SIDE_NAMES[current.side]} (${sideIndex} of 4)`;
      text.textContent = `Move round to ${SIDE_NAMES[current.side]} and lean back, so you look at the page at a slant (about 45°), the whole page still in the picture. When everything below is ticked, tap Capture and hold still.`;
      const checks = sideChecks(current.side, view, still);
      parts.push(text, this.diagram(current.side), this.checklist(checks));
      if (this.capturing > 0) {
        const taken = PER_SIDE - this.capturing;
        const progress = make('progress', { className: 'ar-wizard__progress', max: PER_SIDE, value: taken });
        progress.setAttribute('aria-label', 'Capturing');
        parts.push(progress);
        actions.append(button('Stop', () => { this.capturing = 0; this.render(view, still); }));
      } else {
        actions.append(button('Back', () => this.go(this.step - 1)), button('Capture', () => { this.capturing = PER_SIDE; this.render(view, still); }, true, !checks.every((check) => check.ok)));
      }
    } else {
      const count = this.calibration.count;
      const spread = this.calibration.spread;
      const fov = this.estimate();
      title.textContent = 'Calibrated';
      const grade = count < 12 ? 'Too few pictures: take the sides again.' : spread < 1 ? 'The pictures agree closely: excellent.' : spread < 2 ? 'The pictures agree well: good.' : 'The pictures disagree: take the sides again, slowly, holding still.';
      text.textContent = `Field of view ${fov.toFixed(1)}° (from ${count} pictures, ±${Number.isFinite(spread) ? spread.toFixed(1) : '–'}°). ${grade}`;
      const tune = make('input', { type: 'range', min: '-3', max: '3', step: '0.1', value: String(this.fineTune) });
      tune.setAttribute('aria-label', 'Fine-tune the field of view');
      const tuneValue = make('output', { textContent: `${this.fineTune >= 0 ? '+' : ''}${this.fineTune.toFixed(1)}°` });
      tune.addEventListener('input', () => {
        this.fineTune = Number(tune.value);
        tuneValue.textContent = `${this.fineTune >= 0 ? '+' : ''}${this.fineTune.toFixed(1)}°`;
        text.textContent = `Field of view ${this.estimate().toFixed(1)}° (fine-tuned). If the board slides as you move, nudge this and look again.`;
      });
      const row = make('label', { className: 'ar-field' });
      const span = make('span', { className: 'ar-range' });
      span.append(tune, tuneValue);
      row.append(make('span', { textContent: 'Fine-tune' }), span);
      parts.push(text, row);
      actions.append(button('Redo', () => { this.calibration.drop(this.calibration.count); this.perStep.clear(); this.go(1); }), button('Save', () => this.host.done(this.estimate()), true, count < 4));
    }
    parts.push(actions);
    // The same step as last drawn: what changed is put in place, so a button the player is tapping stays the same
    // button (iOS drops a tap whose button is swapped under the finger, and pictures come a dozen times a second).
    const shape = `${this.step}|${this.capturing > 0}`;
    if (shape === this.drawn && this.card.childElementCount === parts.length) {
      parts.forEach((part, index) => morph(this.card.children[index]!, part));
    } else {
      this.card.replaceChildren(...parts);
      this.drawn = shape;
    }
  }

  private checklist(checks: readonly Check[]): HTMLElement {
    const doc = this.root.ownerDocument;
    const list = doc.createElement('ul');
    list.className = 'ar-wizard__checks';
    for (const check of checks) {
      const item = doc.createElement('li');
      item.className = check.ok ? 'is-ok' : 'is-off';
      item.textContent = check.words;
      list.append(item);
    }
    return list;
  }

  /** The page seen from above, ▲ TOP up, with the phone where it should be (above it, or off the side asked for). */
  private diagram(side: Side | null): SVGSVGElement {
    const doc = this.root.ownerDocument;
    const el = <K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string>): SVGElementTagNameMap[K] => {
      const element = doc.createElementNS(SVG, tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      return element;
    };
    const svg = el('svg', { viewBox: '0 0 160 120', class: 'ar-wizard__diagram', 'aria-hidden': 'true' });
    svg.append(el('rect', { x: '58', y: '26', width: '44', height: '62', rx: '2', class: 'ar-wizard__page' }));
    for (let row = 0; row < 3; row++) for (let column = 0; column < 2; column++) svg.append(el('rect', { x: String(64 + column * 18), y: String(32 + row * 18), width: '14', height: '14', class: 'ar-wizard__marker' }));
    const top = el('text', { x: '80', y: '21', 'text-anchor': 'middle', class: 'ar-wizard__label' });
    top.textContent = TOP_MARK;
    svg.append(top);
    const spots: Record<Side, [number, number]> = { bottom: [80, 108], right: [134, 57], top: [80, 6], left: [26, 57] };
    const [x, y] = side ? spots[side] : [80, 57];
    const phone = el('rect', { x: String(x - 9), y: String(y - 6), width: '18', height: '12', rx: '3', class: side ? 'ar-wizard__phone' : 'ar-wizard__phone is-above' });
    svg.append(phone);
    if (side) svg.append(el('line', { x1: String(x), y1: String(y), x2: String(80 + (x - 80) * 0.45), y2: String(57 + (y - 57) * 0.45), class: 'ar-wizard__arrow' }));
    return svg;
  }

  dispose(): void {
    this.card.remove();
  }
}
