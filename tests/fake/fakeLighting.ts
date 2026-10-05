import type { Disposer, LightingApi, PlayerVisibility, ViewId } from '@atlas-vtt/api-types';
import type { FakeViews, Own } from './fakeViews';

const PENDING: PlayerVisibility = Object.freeze({ status: 'pending' });

/** A frozen copy of `visibility`, with its own `shown` (Atlas hands out a fresh copy on every call). */
function copyOf(visibility: PlayerVisibility): PlayerVisibility {
  if (visibility.status !== 'ready') return Object.freeze({ status: visibility.status });
  const { cellSize, cols, rows, shown } = visibility.darkness;
  return Object.freeze({
    status: 'ready',
    tokens: Object.freeze({ ...visibility.tokens }),
    darkness: Object.freeze({ cellSize, cols, rows, shown: Uint8Array.from(shown) }),
    showsExplored: visibility.showsExplored,
  });
}

/**
 * Atlas's player visibility as the test sets it, per view (`setVisibility`). A view the test has not set (since
 * its map last loaded), one that is not open and one loading a map are `pending`: what Atlas cannot tell is dark. `watch` fires on every
 * `setVisibility` of its view and when its map is marked loaded, and ends when the view closes.
 */
export class FakeLighting {
  private readonly visibility = new Map<ViewId, PlayerVisibility>();
  private readonly watchers = new Map<ViewId, Set<() => void>>();

  constructor(private readonly views: FakeViews) {}

  /** What the player window of `viewId` shows from now on; its watchers are told. */
  setVisibility(viewId: ViewId, visibility: PlayerVisibility): void {
    this.visibility.set(viewId, copyOf(visibility));
    this.changed(viewId);
  }

  /**
   * The view's store holds a newly loaded map: nothing worked out for the last one stands in, so the view reads
   * `pending` until the test says what the new map shows; its watchers run.
   */
  mapLoaded(viewId: ViewId): void {
    this.visibility.delete(viewId);
    this.changed(viewId);
  }

  /** What `viewId` shows may have changed: its watchers run, guarded. */
  changed(viewId: ViewId): void {
    for (const listener of [...(this.watchers.get(viewId) ?? [])]) {
      try {
        listener();
      } catch (error) {
        console.error('[Atlas API] A lighting watcher failed:', error);
      }
    }
  }

  /** How many watchers `viewId` has. */
  watching(viewId: ViewId): number {
    return this.watchers.get(viewId)?.size ?? 0;
  }

  api(own: Own): LightingApi {
    return Object.freeze({
      playerVisibility: (viewId: ViewId): PlayerVisibility => {
        // Checked first, as Atlas does: while the view loads a map nothing of the last one stands in.
        const visibility = this.views.isLoaded(viewId) ? this.visibility.get(viewId) : undefined;
        return visibility ? copyOf(visibility) : PENDING;
      },
      watch: (viewId: ViewId, listener: () => void): Disposer => {
        const set = this.watchers.get(viewId) ?? new Set();
        const remove = (): void => { set.delete(listener); };
        const unwatch = this.views.watchClose(viewId, remove);
        if (!unwatch) return own(() => undefined);
        set.add(listener);
        this.watchers.set(viewId, set);
        return own(() => { remove(); unwatch(); });
      },
    });
  }
}
