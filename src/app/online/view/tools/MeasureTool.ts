/**
 * The player's measure tool: drag from a start to a point to measure a line, a circle or a cone,
 * as Atlas's measure tool does. Private: nothing is sent. Released, the measurement stays for two
 * seconds, as Atlas's does, and a new one ends it.
 */
import type { MeasureShape } from '@atlas-vtt/shared/draw';
import type { ScenePoint } from '../../scene/sceneTypes';
import type { ToolGrid } from './toolGrid';

export type MeasureChoice = Extract<MeasureShape, 'line' | 'circle' | 'cone'>;

export interface MeasureOverlay {
  shape: MeasureChoice;
  start: ScenePoint;
  end: ScenePoint;
  label: string;
  /** A cone's full opening in radians. */
  coneOpening: number;
  /** The player's colour. */
  color: string;
}

/** How long a released measurement stays (Atlas's `MeasureRenderer`). */
export const MEASURE_LINGER_MS = 2000;

export class MeasureTool {
  private start: ScenePoint | null = null;
  private end: ScenePoint | null = null;
  /** When a released measurement goes; null while it is being drawn or there is none. */
  private until: number | null = null;

  begin(world: ScenePoint, grid: ToolGrid): void {
    this.start = grid.snap(world);
    this.end = this.start;
    this.until = null;
  }

  move(world: ScenePoint, grid: ToolGrid): void {
    if (this.start) this.end = grid.snap(world);
  }

  clear(): void {
    this.start = null;
    this.end = null;
    this.until = null;
  }

  /** Released at `now`: it stays until `MEASURE_LINGER_MS` later. */
  release(now: number): void {
    if (this.start) this.until = now + MEASURE_LINGER_MS;
  }

  /** Whether a released measurement is still shown at `now`: the view draws again when it goes. */
  lingering(now: number): boolean {
    return this.until !== null && now < this.until;
  }

  overlay(shape: MeasureChoice, grid: ToolGrid, color: string, now: number): MeasureOverlay | null {
    if (this.until !== null && now >= this.until) this.clear();
    if (!this.start || !this.end) return null;
    return { shape, start: this.start, end: this.end, label: grid.label([this.start, this.end]), coneOpening: grid.coneOpening, color };
  }
}
