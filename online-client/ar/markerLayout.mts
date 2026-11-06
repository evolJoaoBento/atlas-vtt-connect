// online-client/ar/markerLayout.mts
/**
 * Where the markers lie on the table, learnt as they are seen. The first sheet or card seen is the origin: the map's
 * middle stands on it. Another, seen in the same picture as some already placed, is placed from them: its place and
 * heading on the table averaged over the pictures it shows in. Once seen a few times it places the camera itself, so the
 * camera can lean in over any card.
 *
 * Places are millimetres on the table, in the origin's frame (x right, y down its page); a heading turns a card's own
 * x toward the origin's y. The A4 sheet's five markers are one thing, fixed on it; each card is its own.
 */
import { markerGroup } from './markerSheet.mts';
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
/** A marker whose face is tipped further than this from the table's is misread, or not on the table. */
const MAX_TILT = (20 * Math.PI) / 180;

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
  observe(markers: readonly Detected[], camera: Intrinsics, width: number): Tracked | null {
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
        const from = poseFrom(others, this.corners, camera, width);
        const sighting = own.find((marker) => marker.pose);
        if (from && sighting?.pose) this.learn(group, from.pose, sighting.pose);
      }
    }
    return poseFrom(markers, this.corners, camera, width);
  }

  /** A sighting of `group` (the camera's pose over it) from a camera placed at `camera` (its pose over the origin). */
  private learn(group: string, camera: { rotation: number[]; translation: number[] }, own: { rotation: number[]; translation: number[] }): void {
    const r = camera.rotation;
    const m = own.rotation;
    // The group in the origin's frame: Rᵀ·Rm, and Rᵀ·(tm − t).
    const turn: number[] = [];
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) turn.push(r[row]! * m[col]! + r[3 + row]! * m[3 + col]! + r[6 + row]! * m[6 + col]!);
    const d = [0, 1, 2].map((k) => own.translation[k]! - camera.translation[k]!);
    const place = [0, 1, 2].map((row) => r[row]! * d[0]! + r[3 + row]! * d[1]! + r[6 + row]! * d[2]!);
    // On the table, and lying flat on it.
    if (Math.abs(place[2]!) > 25 || Math.acos(Math.max(-1, Math.min(1, turn[8]!))) > MAX_TILT) return;
    const heading = Math.atan2(turn[3]!, turn[0]!);
    const placement = this.placed.get(group);
    if (!placement) {
      this.placed.set(group, { x: place[0]!, y: place[1]!, heading, seen: 1, misses: 0 });
      return;
    }
    const off = Math.hypot(place[0]! - placement.x, place[1]! - placement.y);
    const turned = Math.abs(wrap(heading - placement.heading));
    if (placement.seen >= TRUSTED_AFTER && (off > DOUBT_MM || turned > DOUBT_TURN)) {
      placement.misses++;
      if (placement.misses >= MOVED_AFTER) this.placed.set(group, { x: place[0]!, y: place[1]!, heading, seen: 1, misses: 0 });
      return;
    }
    placement.misses = 0;
    placement.seen++;
    const gain = 1 / Math.min(placement.seen, MEMORY);
    placement.x += (place[0]! - placement.x) * gain;
    placement.y += (place[1]! - placement.y) * gain;
    placement.heading = wrap(placement.heading + wrap(heading - placement.heading) * gain);
  }

  /** Forgets every place: the next sheet or card seen is the origin again. */
  reset(): void {
    this.placed.clear();
    this.origin = null;
  }
}

/** How big a marker shows: its diagonals' length. */
function spread(seen: readonly Point[]): number {
  return Math.hypot(seen[0]!.x - seen[2]!.x, seen[0]!.y - seen[2]!.y) + Math.hypot(seen[1]!.x - seen[3]!.x, seen[1]!.y - seen[3]!.y);
}
