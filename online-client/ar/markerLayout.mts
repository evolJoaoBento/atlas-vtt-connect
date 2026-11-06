// online-client/ar/markerLayout.mts
/**
 * Where the markers lie on the table, learnt as they are seen. The first sheet or card seen is the origin: the map's
 * middle stands on it. Another, seen in the same picture as some already placed, is placed from them: its place and
 * heading on the table averaged over the pictures it shows in. Once seen a few times it places the camera itself, so the
 * camera can lean in over any card.
 *
 * Places are millimetres on the table, in the origin's frame (x right, y down its page); a heading turns a card's own
 * x toward the origin's y. The A4 sheet's five markers are one thing, fixed on it, as are a mat page's; each card is its
 * own. A sighting is read on the table itself: each corner's ray from the camera met with the table, and the card's
 * corners fitted to those points (place and heading only: it lies flat). With the gyroscope the camera's turn is the
 * phone's, so a slightly misread marker does not tip it, and errors do not add up from card to card.
 */
import { markerGroup } from './markerSheet.mts';
import { placeFor } from './fusion.mts';
import type { Intrinsics, Point } from './sheetPose.mts';
import { poseFrom, type Detected, type Tracked } from './sheetTracker.mts';

interface Placement { x: number; y: number; heading: number; seen: number; misses: number }

/** Pictures a card must be placed from before it places the camera. */
const TRUSTED_AFTER = 3;
/** Past this many, a new picture weighs as much as one in this many: a card nudged on the table is followed. */
const MEMORY = 40;
/** A sighting this far from a card's place (millimetres, or radians) is doubted… */
const DOUBT_MM = 15;
const DOUBT_TURN = (8 * Math.PI) / 180;
/** …unless this many in a row say so: the card was moved. */
const MOVED_AFTER = 10;

const wrap = (angle: number): number => Math.atan2(Math.sin(angle), Math.cos(angle));

export class MarkerLayout {
  private readonly placed = new Map<string, Placement>();

  /** How many sheets and cards are placed. */
  get size(): number {
    return this.placed.size;
  }

  /** Whether a sheet or card is placed (and trusted to place the camera). */
  knows(group: string): boolean {
    const placement = this.placed.get(group);
    return placement !== undefined && (placement.seen >= TRUSTED_AFTER || this.isOrigin(group));
  }

  private origin: string | null = null;

  private isOrigin(group: string): boolean {
    return group === this.origin;
  }

  /** A marker's corners on the table, in the origin's frame; null for one not (yet) trusted. */
  readonly corners = (id: number): Point[] | null => {
    const group = markerGroup(id);
    if (!group || !this.knows(group.group)) return null;
    const placement = this.placed.get(group.group)!;
    const c = Math.cos(placement.heading);
    const s = Math.sin(placement.heading);
    return group.corners.map((corner) => ({ x: placement.x + c * corner.x - s * corner.y, y: placement.y + s * corner.x + c * corner.y }));
  };

  /**
   * The markers found in a picture: places what is new or refines what is placed, and gives the camera's pose from the
   * trusted ones. The first sheet or card ever seen (the sheet before a card, else the biggest card in sight) becomes the
   * origin.
   */
  observe(markers: readonly Detected[], camera: Intrinsics, width: number, turn: readonly number[] | null = null): Tracked | null {
    if (this.origin === null) {
      const first = [...markers].filter((marker) => marker.pose).sort((a, b) => (markerGroup(a.id)?.group === 'sheet' ? -1 : 0) - (markerGroup(b.id)?.group === 'sheet' ? -1 : 0) || spread(b.seen) - spread(a.seen))[0];
      const group = first ? markerGroup(first.id) : null;
      if (group) {
        this.origin = group.group;
        this.placed.set(group.group, { x: 0, y: 0, heading: 0, seen: TRUSTED_AFTER, misses: 0 });
      }
    }
    // Learn each sheet or card in sight from the others placed in the same picture.
    const groups = new Map<string, Detected[]>();
    for (const marker of markers) {
      const group = markerGroup(marker.id)?.group;
      if (group) groups.set(group, [...(groups.get(group) ?? []), marker]);
    }
    if (groups.size > 1) {
      for (const [group, own] of groups) {
        if (group === this.origin) continue;
        const others = markers.filter((marker) => markerGroup(marker.id)?.group !== group);
        const from = this.cameraFrom(others, camera, width, turn);
        if (from) this.learn(group, own, from, camera);
      }
    }
    return poseFrom(markers, this.corners, camera, width);
  }

  /** The camera's pose over the origin from the trusted markers among `markers`: with the gyroscope's turn when given. */
  private cameraFrom(markers: readonly Detected[], camera: Intrinsics, width: number, turn: readonly number[] | null): { rotation: number[]; translation: number[] } | null {
    if (!turn) return poseFrom(markers, this.corners, camera, width)?.pose ?? null;
    const sheet: Point[] = [];
    const seen: Point[] = [];
    for (const marker of markers) {
      const corners = this.corners(marker.id);
      if (!corners) continue;
      sheet.push(...corners);
      seen.push(...marker.seen);
    }
    if (sheet.length === 0) return null;
    const translation = placeFor(turn, sheet, seen, camera);
    return translation ? { rotation: [...turn], translation } : null;
  }

  /** A sighting of `group` (its markers in the picture) from a camera at `from` (its pose over the origin). */
  private learn(group: string, own: readonly Detected[], from: { rotation: number[]; translation: number[] }, camera: Intrinsics): void {
    const local: Point[] = [];
    const onTable: Point[] = [];
    const r = from.rotation;
    const t = from.translation;
    // The camera in the origin's frame: −Rᵀt.
    const eye = [0, 1, 2].map((k) => -(r[k]! * t[0]! + r[3 + k]! * t[1]! + r[6 + k]! * t[2]!));
    for (const marker of own) {
      const corners = markerGroup(marker.id)?.corners;
      if (!corners) continue;
      for (let i = 0; i < 4; i++) {
        const ray = [(marker.seen[i]!.x - camera.cx) / camera.f, (marker.seen[i]!.y - camera.cy) / camera.f, 1];
        // Into the origin's frame: Rᵀ·ray.
        const d = [0, 1, 2].map((k) => r[k]! * ray[0]! + r[3 + k]! * ray[1]! + r[6 + k]! * ray[2]!);
        // The table is z = 0; the camera above it has z < 0, looking toward +z.
        if (d[2]! <= 1e-6) return;
        const s = -eye[2]! / d[2]!;
        if (!(s > 0)) return;
        local.push(corners[i]!);
        onTable.push({ x: eye[0]! + d[0]! * s, y: eye[1]! + d[1]! * s });
      }
    }
    const fit = rigid2d(local, onTable);
    if (!fit || fit.error > 6) return;
    const { x, y, heading } = fit;
    const placement = this.placed.get(group);
    if (!placement) {
      this.placed.set(group, { x, y, heading, seen: 1, misses: 0 });
      return;
    }
    const off = Math.hypot(x - placement.x, y - placement.y);
    const turned = Math.abs(wrap(heading - placement.heading));
    if (placement.seen >= TRUSTED_AFTER && (off > DOUBT_MM || turned > DOUBT_TURN)) {
      placement.misses++;
      if (placement.misses >= MOVED_AFTER) this.placed.set(group, { x, y, heading, seen: 1, misses: 0 });
      return;
    }
    placement.misses = 0;
    placement.seen++;
    const gain = 1 / Math.min(placement.seen, MEMORY);
    placement.x += (x - placement.x) * gain;
    placement.y += (y - placement.y) * gain;
    placement.heading = wrap(placement.heading + wrap(heading - placement.heading) * gain);
  }

  /** Forgets every place: the next sheet or card seen is the origin again. */
  reset(): void {
    this.placed.clear();
    this.origin = null;
  }
}

/**
 * The turn and shift (on the table) best taking `from` points onto `to` points, and how far off they land on average
 * (millimetres); null for too few points.
 */
export function rigid2d(from: readonly Point[], to: readonly Point[]): { x: number; y: number; heading: number; error: number } | null {
  const n = from.length;
  if (n < 2 || n !== to.length) return null;
  const mean = (points: readonly Point[]): Point => ({ x: points.reduce((sum, p) => sum + p.x, 0) / n, y: points.reduce((sum, p) => sum + p.y, 0) / n });
  const a = mean(from);
  const b = mean(to);
  let dot = 0;
  let cross = 0;
  for (let i = 0; i < n; i++) {
    const px = from[i]!.x - a.x;
    const py = from[i]!.y - a.y;
    const qx = to[i]!.x - b.x;
    const qy = to[i]!.y - b.y;
    dot += px * qx + py * qy;
    cross += px * qy - py * qx;
  }
  const heading = Math.atan2(cross, dot);
  const c = Math.cos(heading);
  const s = Math.sin(heading);
  const x = b.x - (c * a.x - s * a.y);
  const y = b.y - (s * a.x + c * a.y);
  let error = 0;
  for (let i = 0; i < n; i++) error += Math.hypot(x + c * from[i]!.x - s * from[i]!.y - to[i]!.x, y + s * from[i]!.x + c * from[i]!.y - to[i]!.y);
  return { x, y, heading, error: error / n };
}

/** How big a marker shows: its diagonals' length. */
function spread(seen: readonly Point[]): number {
  return Math.hypot(seen[0]!.x - seen[2]!.x, seen[0]!.y - seen[2]!.y) + Math.hypot(seen[1]!.x - seen[3]!.x, seen[1]!.y - seen[3]!.y);
}
