/**
 * The lasers of a remote view. The player's own: Atlas's laser in the view emits its points
 * (`lasers.onLocal`), and the shared `LaserBatcher` sends them in the join page's batches, in the
 * player's Atlas laser colour. Only the swatches go, as on the join page; for any other colour the GM
 * gives one. Other people's, on the scene the view shows: drawn by Atlas (`lasers.show`) in their
 * sender's or their place's colour.
 */
import type { LasersApi, ViewId } from '@atlas-vtt/api-types';
import type { ScenePoint } from '../../scene/sceneTypes';
import { LaserBatcher } from '../../tools/LaserBatcher';
import { laserColor, swatchLaserColor } from '../../tools/laserColors';
import type { PlayerLaser } from '../../tools/toolMessages';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export interface RemoteLaserLinkOptions {
  lasers: Pick<LasersApi, 'onLocal' | 'show'>;
  viewId: ViewId;
  send(points: ScenePoint[], lifted: boolean, dt: number[], color?: string): boolean;
  /** The player's Atlas laser colour, read for every batch. */
  color(): string;
  /** Tests pass their own clock. */
  clock?: () => number;
}

export class RemoteLaserLink {
  private readonly batcher: LaserBatcher;
  private readonly stopListening: () => void;

  constructor(private readonly options: RemoteLaserLinkOptions) {
    this.batcher = new LaserBatcher((points, lifted, dt) => {
      options.send(points, lifted, dt, swatchLaserColor(options.color()) ?? undefined);
    }, options.clock);
    this.stopListening = options.lasers.onLocal(options.viewId, (event) => {
      if (event.kind === 'point') this.batcher.point({ x: event.x, y: event.y });
      else this.batcher.lift();
    });
  }

  /** Someone else's laser; `order` is the session's players, whose places decide the colours. */
  show(laser: PlayerLaser, order: readonly string[]): void {
    const color = typeof laser.color === 'string' && HEX_COLOR.test(laser.color) ? laser.color : laserColor(laser.from, order);
    try {
      this.options.lasers.show(this.options.viewId, {
        from: laser.from, color, points: laser.points, lifted: laser.lifted, ...(laser.dt ? { dt: laser.dt } : {}),
      });
    } catch (error) {
      // A malformed message from the network is dropped: it must not stop the session's other messages.
      console.error('[Atlas VTT Connect] A laser could not be shown:', error);
    }
  }

  dispose(): void {
    this.stopListening();
    this.batcher.dispose();
  }
}
