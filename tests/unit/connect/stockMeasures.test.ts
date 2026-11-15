import { describe, expect, it } from 'vitest';
import { stockMeasuresApi, type MeasureStoreView } from '../../../src/connect/stockMeasures';

/** A stand-in for a stock Atlas view's store: measures in a record, a history that counts transactions. */
function fakeView(mapPath: string, over: Record<string, unknown> = {}) {
  const measures: Record<string, Record<string, unknown>> = {};
  const log: string[] = [];
  let next = 0;
  let depth = 0;
  const state = {
    mapPath, mapLoaded: true, isMapLoading: false, objects: { measures },
    addMeasure: (data: Record<string, unknown>): string | null => {
      if (Object.keys(measures).length >= 3) return null;
      const id = `m${++next}`;
      measures[id] = { id, kind: 'measure', ...data };
      log.push(`add:${id}${depth > 0 ? ':tx' : ''}`);
      return id;
    },
    updateMeasure: (id: string, changes: Record<string, unknown>) => { Object.assign(measures[id]!, changes); log.push(`update:${id}`); },
    deleteMeasure: (id: string) => { delete measures[id]; log.push(`delete:${id}${depth > 0 ? ':tx' : ''}`); },
    ...over,
  };
  const temporal = { getState: () => ({ transaction: <T>(fn: () => T): T => { depth++; log.push('begin'); try { return fn(); } finally { depth--; log.push('end'); } } }) };
  const view: MeasureStoreView = { atlasStore: { getState: () => state, temporal } };
  return { view, measures, log, state };
}

describe("measures on a stock Atlas's store", () => {
  it("keeps a player's measure on the level the players are shown, not the one the GM happens to browse", () => {
    const { view, measures } = fakeView('maps/a.atlasmap');
    const shown: { level: string | null | undefined } = { level: 'upper' };
    const api = stockMeasuresApi({ view: () => view, playersLevel: () => shown.level });
    api.write('v1', 'maps/a.atlasmap', (store) => store.add({ shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] }));
    expect(measures.m1).toMatchObject({ level: 'upper' });
    // A scene without levels, or a level nobody knows: Atlas places it as it places its own.
    for (const level of [null, undefined]) {
      shown.level = level;
      const id = api.write('v1', 'maps/a.atlasmap', (store) => store.add({ shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] })) as string;
      expect('level' in measures[id]!).toBe(false);
    }
  });

  it('writes inside one history transaction, on the map the view holds', () => {
    const { view, measures, log } = fakeView('maps/a.atlasmap');
    const api = stockMeasuresApi({ view: (id) => (id === 'v1' ? view : null) });
    const made = api.write('v1', 'maps/a.atlasmap', (store) => {
      const first = store.add({ shape: 'circle', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] });
      store.remove(first!);
      return store.add({ shape: 'cone', points: [{ x: 0, y: 0 }, { x: 70, y: 0 }], by: 'Anna' });
    });
    expect(made).toBe('m2');
    expect(log).toEqual(['begin', 'add:m1:tx', 'delete:m1:tx', 'add:m2:tx', 'end']);
    expect(measures.m2).toMatchObject({ shape: 'cone', by: 'Anna' });
    expect(api.list('v1', 'maps/a.atlasmap')?.map((measure) => measure.id)).toEqual(['m2']);
  });

  it('answers not-held for a map the view does not hold, is still reading, or a view that is gone', () => {
    const { view, log } = fakeView('maps/a.atlasmap');
    const api = stockMeasuresApi({ view: (id) => (id === 'v1' ? view : null) });
    expect(api.write('v1', 'maps/other.atlasmap', (store) => store.add({ shape: 'circle', points: [] }))).toBe('not-held');
    expect(api.write('gone', 'maps/a.atlasmap', () => 1)).toBe('not-held');
    expect(api.list('v1', 'maps/other.atlasmap')).toBeNull();
    const loading = fakeView('maps/a.atlasmap', { isMapLoading: true });
    expect(stockMeasuresApi({ view: () => loading.view }).write('v1', 'maps/a.atlasmap', () => 1)).toBe('not-held');
    const old = fakeView('maps/a.atlasmap', { addMeasure: undefined });
    expect(stockMeasuresApi({ view: () => old.view }).write('v1', 'maps/a.atlasmap', () => 1)).toBe('not-held');
    expect(log).toEqual([]);
  });

  it("gives Atlas's answer when a level is full, and lists only what reads as a measure", () => {
    const { view, measures } = fakeView('maps/a.atlasmap');
    const api = stockMeasuresApi({ view: () => view });
    const ids = api.write('v1', 'maps/a.atlasmap', (store) => [1, 2, 3, 4].map(() => store.add({ shape: 'circle', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })));
    expect(ids).toEqual(['m1', 'm2', 'm3', null]);
    measures.junk = 'x' as never;
    measures.odd = { id: 'odd', shape: 'blob', points: [] };
    expect(api.list('v1', 'maps/a.atlasmap')?.map((measure) => measure.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('writes without a transaction where the store has no history', () => {
    const { view, measures } = fakeView('maps/a.atlasmap');
    delete (view.atlasStore as { temporal?: unknown }).temporal;
    expect(stockMeasuresApi({ view: () => view }).write('v1', 'maps/a.atlasmap', (store) => store.add({ shape: 'line', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], width: 5 }))).toBe('m1');
    expect(measures.m1).toMatchObject({ width: 5 });
  });
});
