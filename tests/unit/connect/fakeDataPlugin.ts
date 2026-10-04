import type { Plugin } from 'obsidian';

/** A plugin's data file in memory: `loadData` returns `data`, `saveData` collects what is saved. */
export function fakeDataPlugin(data: unknown): Pick<Plugin, 'loadData' | 'saveData'> & { saved: unknown[] } {
  const saved: unknown[] = [];
  return {
    loadData: async () => data,
    saveData: async (value: unknown) => { saved.push(value); },
    saved,
  };
}
