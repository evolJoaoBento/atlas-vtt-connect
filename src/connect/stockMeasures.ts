/**
 * Atlas's kept measures (`objects.measures`) on a stock Atlas, as Connect writes them: a player's spell or template is
 * kept in Atlas's own store, the only place it lives, through the store's own actions (`addMeasure`, `updateMeasure`,
 * `deleteMeasure`). Each write runs inside one transaction of Atlas's history, so it is one undo step there. Atlas
 * holds one map at a time: a map its view does not hold (or is still reading) is not written at all (`not-held`).
 */
import type { MeasureRecord } from '../../packages/atlas-host/src/spellMeasure';

/** A stock Atlas map view, as far as its measures go. */
export interface MeasureStoreView {
  readonly atlasStore: {
    getState(): unknown;
    /** Atlas's history: `transaction(fn)` makes every write of `fn` one undo step. */
    temporal?: { getState(): unknown };
  };
}

/** A kept measure with the id Atlas gave it. */
export type KeptRecord = MeasureRecord & { id: string };

/** The writes of one transaction on the map a view holds. */
export interface MeasureWrites {
  list(): KeptRecord[];
  /** Keeps a measure and gives its id; null where the level it lands on is full (Atlas's cap). */
  add(record: MeasureRecord): string | null;
  update(id: string, changes: Partial<MeasureRecord>): void;
  remove(id: string): void;
}

export interface StockMeasures {
  /** The measures of `mapPath` as the view `viewId` holds them; null when it does not hold that map. */
  list(viewId: string, mapPath: string): KeptRecord[] | null;
  /** Runs `fn` as one undo step of Atlas's on the map the view holds; `not-held` (and nothing run) when it does not. */
  write<T>(viewId: string, mapPath: string, fn: (store: MeasureWrites) => T): T | 'not-held';
}

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);
const SHAPES = new Set(['ruler', 'circle', 'cone', 'square', 'line']);

/** The store's state where it holds `mapPath` loaded and has Atlas 0.15's measure actions; null otherwise. */
function heldState(view: MeasureStoreView | null, mapPath: string): Rec | null {
  if (!view) return null;
  let state: unknown;
  try { state = view.atlasStore.getState(); } catch { return null; }
  if (!isRec(state) || state.mapPath !== mapPath || state.mapLoaded === false || state.isMapLoading === true) return null;
  return typeof state.addMeasure === 'function' && typeof state.deleteMeasure === 'function' ? state : null;
}

function listOf(state: Rec): KeptRecord[] {
  const record = isRec(state.objects) ? state.objects.measures : undefined;
  if (!isRec(record)) return [];
  const kept: KeptRecord[] = [];
  for (const [id, value] of Object.entries(record)) {
    if (isRec(value) && typeof value.shape === 'string' && SHAPES.has(value.shape) && Array.isArray(value.points)) kept.push({ ...(value as unknown as MeasureRecord), id });
  }
  return kept;
}

export function stockMeasuresApi(deps: { view(viewId: string): MeasureStoreView | null }): StockMeasures {
  return {
    list: (viewId, mapPath) => {
      const state = heldState(deps.view(viewId), mapPath);
      return state ? listOf(state) : null;
    },
    write: (viewId, mapPath, fn) => {
      const view = deps.view(viewId);
      if (!heldState(view, mapPath) || !view) return 'not-held';
      // Read fresh at every call: an action swaps the store's state.
      const now = (): Rec => view.atlasStore.getState() as Rec;
      const writes: MeasureWrites = {
        list: () => listOf(now()),
        add: (record) => {
          const id = (now().addMeasure as (data: MeasureRecord) => unknown)(record);
          return typeof id === 'string' ? id : null;
        },
        update: (id, changes) => { (now().updateMeasure as ((id: string, changes: object) => void) | undefined)?.(id, changes); },
        remove: (id) => { (now().deleteMeasure as (id: string) => void)(id); },
      };
      const history = view.atlasStore.temporal?.getState();
      const transaction = isRec(history) && typeof history.transaction === 'function' ? history.transaction as <T>(run: () => T) => T : null;
      return transaction ? (transaction.call(history, () => fn(writes)) as ReturnType<typeof fn>) : fn(writes);
    },
  };
}
