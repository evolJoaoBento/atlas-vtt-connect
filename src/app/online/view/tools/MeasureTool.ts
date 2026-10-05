/**
 * The player's measure tool: drag from a start to a point to measure a line, a circle or a cone,
 * as Atlas's measure tool does. Private: nothing is sent, and the measurement is gone on release.
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
}

export class MeasureTool {
  private start: ScenePoint | null = null;
  private end: ScenePoint | null = null;

  begin(world: ScenePoint, grid: ToolGrid): void {
    this.start = grid.snap(world);
    this.end = this.start;
  }

  move(world: ScenePoint, grid: ToolGrid): void {
    if (this.start) this.end = grid.snap(world);
  }

  clear(): void {
    this.start = null;
    this.end = null;
  }

  overlay(shape: MeasureChoice, grid: ToolGrid): MeasureOverlay | null {
    if (!this.start || !this.end) return null;
    return { shape, start: this.start, end: this.end, label: grid.label([this.start, this.end]), coneOpening: grid.coneOpening };
  }
}
