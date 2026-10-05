/**
 * The drag ruler on the join page. While the player drags one of their tokens, it shows Atlas's
 * ruler from where the token started, through its waypoints, to the cell it would land in, with
 * the distance in the GM's units. Atlas's waypoint key (Space, bound by the page) adds a waypoint
 * on desktop. On a touch screen, holding still for half a second mid-drag adds one, one per hold.
 * Local: nothing is sent. Shared with the web page.
 */
import { DragRulerPath } from '@atlas-vtt/shared/draw';
import type { ScenePoint } from '../../scene/sceneTypes';
import type { ScreenPoint } from '../camera';
import { TAP_SLOP, type PointerKind } from '../ViewInput';
import type { ToolGrid } from './toolGrid';

export const WAYPOINT_HOLD_MS = 500;

export interface RulerOverlay {
  points: ScenePoint[];
  label: string;
}

export class DragRulerTool {
  private path: DragRulerPath | null = null;
  private grid: ToolGrid | null = null;
  private touch = false;
  /** Where the finger came to rest; moving past the tap slop from it starts a new hold. */
  private still: ScreenPoint | null = null;
  private holdTimer: number | null = null;

  /** `onChange`: a hold added a waypoint, so the ruler must be drawn again. */
  constructor(private readonly onChange: () => void) {}

  /** `tokenSize`: the dragged token's, so the ruler ends where the GM's drop puts it. */
  begin(origin: ScenePoint, grid: ToolGrid, kind: PointerKind, tokenSize: number): void {
    this.end();
    this.grid = grid;
    this.path = new DragRulerPath((point) => grid.snapDrag(point, tokenSize));
    this.path.begin(origin);
    this.touch = kind === 'touch';
  }

  /** The dragged token is at `position`; `screen` is the finger, for the hold. */
  update(position: ScenePoint, screen: ScreenPoint): void {
    if (!this.path) return;
    this.path.update(position);
    if (!this.touch) return;
    if (this.still && Math.hypot(screen.x - this.still.x, screen.y - this.still.y) <= TAP_SLOP) return;
    this.still = { x: screen.x, y: screen.y };
    this.cancelHold();
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = null;
      this.addWaypoint();
    }, WAYPOINT_HOLD_MS);
  }

  /** A waypoint at the landing cell; false when it would repeat the last point. */
  addWaypoint(): boolean {
    const added = this.path?.addWaypoint() ?? false;
    if (added) this.onChange();
    return added;
  }

  end(): void {
    this.cancelHold();
    this.path?.end();
    this.path = null;
    this.grid = null;
    this.still = null;
  }

  overlay(): RulerOverlay | null {
    const points = this.path?.points();
    return points && this.grid ? { points, label: this.grid.label(points) } : null;
  }

  private cancelHold(): void {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    this.holdTimer = null;
  }
}
