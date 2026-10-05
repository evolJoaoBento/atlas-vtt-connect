import type { Disposer, LasersApi, LocalLaserEvent, RemoteLaser, ViewId } from '@atlas-vtt/api-types';
import type { FakeViews, Own } from './fakeViews';

/** A message counts its newest 64 points; a gap in time at most 2 seconds. */
const MAX_POINTS = 64;
const MAX_GAP_MS = 2000;
const COLOR = /^#[0-9a-f]{6}$/i;

const isPoint = (point: unknown): boolean => {
  const p = point as { x?: unknown; y?: unknown } | null;
  return typeof p === 'object' && p !== null && Number.isFinite(p.x) && Number.isFinite(p.y);
};

function assertLaser(laser: unknown): asserts laser is RemoteLaser {
  const given = laser as Partial<RemoteLaser> | null;
  if (typeof given !== 'object' || given === null || typeof given.from !== 'string' || given.from === '') throw new Error('[Atlas API] show needs a laser with a `from`.');
  if (typeof given.color !== 'string' || !COLOR.test(given.color)) throw new Error('[Atlas API] show needs a laser with a #rrggbb `color`.');
  if (!Array.isArray(given.points) || !given.points.every(isPoint)) throw new Error('[Atlas API] show needs laser `points` of finite x and y.');
  if (given.dt !== undefined && !(Array.isArray(given.dt) && given.dt.every((gap) => Number.isFinite(gap)))) throw new Error('[Atlas API] show needs laser `dt` of finite numbers.');
}

/** Atlas's lasers as the test drives them: the GM's own laser per view, and what `show` draws there. */
export class FakeLasers {
  private readonly local = new Map<ViewId, Set<(event: LocalLaserEvent) => void>>();
  private readonly drawn = new Map<ViewId, RemoteLaser[]>();

  constructor(private readonly views: FakeViews) {}

  /** The GM draws a laser point, or lets it go, in `viewId`. */
  emitLocal(viewId: ViewId, event: LocalLaserEvent): void {
    for (const listener of [...(this.local.get(viewId) ?? [])]) {
      try {
        listener(Object.freeze({ ...event }));
      } catch (error) {
        console.error('[Atlas API] A laser listener failed:', error);
      }
    }
  }

  /** What `show` drew in `viewId`, in order, as the view's remote layer got it. */
  shown(viewId: ViewId): readonly RemoteLaser[] {
    return this.drawn.get(viewId) ?? [];
  }

  /** How many `onLocal` listeners the GM's laser in `viewId` has. */
  listening(viewId: ViewId): number {
    return this.local.get(viewId)?.size ?? 0;
  }

  api(own: Own): LasersApi {
    return Object.freeze({
      onLocal: (viewId: ViewId, listener: (event: LocalLaserEvent) => void): Disposer => {
        const set = this.local.get(viewId) ?? new Set();
        const remove = (): void => { set.delete(listener); };
        const unwatch = this.views.watchClose(viewId, remove);
        if (!unwatch) return own(() => undefined);
        set.add(listener);
        this.local.set(viewId, set);
        return own(() => { remove(); unwatch(); });
      },
      show: (viewId: ViewId, laser: RemoteLaser): void => {
        assertLaser(laser);
        if (!this.views.tabsOf(viewId)) return;
        const copy: RemoteLaser = {
          from: laser.from, color: laser.color, lifted: laser.lifted,
          points: laser.points.slice(-MAX_POINTS).map(({ x, y }) => ({ x, y })),
          ...(laser.dt ? { dt: laser.dt.slice(-MAX_POINTS).map((gap) => Math.min(gap, MAX_GAP_MS)) } : {}),
        };
        this.drawn.set(viewId, [...(this.drawn.get(viewId) ?? []), copy]);
      },
    });
  }
}
