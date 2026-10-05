import { describe, expect, it, vi } from 'vitest';
import { ShareItems } from '../../../../src/app/online/sharing/model/ShareItems';
import { pathWithin, removeWithin, renamePrefix } from '../../../../src/app/online/sharing/pathRenames';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { PATHS } from './sharingPathsFixture';

const ITEMS_FILE = PATHS.items;

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const STORED = 'a'.repeat(22);

describe('ShareItems', () => {
  it('gives each note a random id that follows renames and goes with deletions', async () => {
    const { app, files } = createInMemoryApp();
    const items = ShareItems.create(app.vault.adapter, PATHS);
    await items.ready();
    const id = items.idFor('Notes/Cave.md');
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id).not.toContain('Cave');
    expect(items.idFor('Notes/Cave.md')).toBe(id);
    items.renamed('Notes/Cave.md', 'Places/Cave.md');
    expect(items.pathOf(id)).toBe('Places/Cave.md');
    items.renamed('Places', 'World/Places');
    expect(items.pathOf(id)).toBe('World/Places/Cave.md');
    await flush();
    expect(JSON.parse(files.get(ITEMS_FILE)!).notes).toEqual({ 'World/Places/Cave.md': id });
    items.deleted('World');
    expect(items.pathOf(id)).toBeNull();
  });

  it('writes nothing before the stored list is read, then applies what happened meanwhile to it', async () => {
    const stored = JSON.stringify({ version: 1, notes: { 'Old/A.md': STORED, 'Old/B.md': 'b'.repeat(22), 'Gone.md': 'c'.repeat(22) } });
    const { app, files } = createInMemoryApp({ files: { [ITEMS_FILE]: stored } });
    const write = vi.spyOn(app.vault.adapter, 'write');
    const items = ShareItems.create(app.vault.adapter, PATHS);
    const early = items.idFor('New.md');
    items.renamed('Old', 'Moved');
    items.deleted('Gone.md');
    await flush();
    expect(write).not.toHaveBeenCalled();
    expect(files.get(ITEMS_FILE)).toBe(stored);
    await items.ready();
    await flush();
    expect(items.pathOf(STORED)).toBe('Moved/A.md');
    expect(items.idFor('New.md')).toBe(early);
    expect(items.pathOf('c'.repeat(22))).toBeNull();
    expect(JSON.parse(files.get(ITEMS_FILE)!).notes).toEqual({ 'Moved/A.md': STORED, 'Moved/B.md': 'b'.repeat(22), 'New.md': early });
  });

  it('a stored id wins over one made before it was read, so ids survive restarts', async () => {
    const { app } = createInMemoryApp({ files: { [ITEMS_FILE]: JSON.stringify({ version: 1, notes: { 'Same.md': STORED } }) } });
    const items = ShareItems.create(app.vault.adapter, PATHS);
    items.idFor('Same.md');
    await items.ready();
    expect(items.idFor('Same.md')).toBe(STORED);
  });

  it('drops stored ids of the wrong shape', async () => {
    const { app } = createInMemoryApp({ files: { [ITEMS_FILE]: JSON.stringify({ version: 1, notes: { 'a.md': 'short', 'b.md': 7, 'c.md': STORED } }) } });
    const items = ShareItems.create(app.vault.adapter, PATHS);
    await items.ready();
    expect(items.pathOf(STORED)).toBe('c.md');
    expect(items.pathOf('short')).toBeNull();
  });
});

describe('path renames', () => {
  it('moves and removes every path at or below a folder, and nothing beside it', () => {
    expect(pathWithin('A/B.md', 'A')).toBe(true);
    expect(pathWithin('A', 'A')).toBe(true);
    expect(pathWithin('AB/C.md', 'A')).toBe(false);
    const record = { 'A/B.md': 1, 'A': 2, 'AB/C.md': 3 };
    expect(renamePrefix(record, 'A', 'X/Y')).toEqual({ 'X/Y/B.md': 1, 'X/Y': 2, 'AB/C.md': 3 });
    expect(renamePrefix(record, 'Z', 'Q')).toBeNull();
    expect(removeWithin(record, 'A')).toEqual({ 'AB/C.md': 3 });
    expect(removeWithin(record, 'Z')).toBeNull();
  });
});
