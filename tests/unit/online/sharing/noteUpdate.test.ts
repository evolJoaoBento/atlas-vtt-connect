import { describe, expect, it, vi } from 'vitest';
import { MAX_DIFF_LINES } from '../../../../src/app/online/sharing/merge/diffLines';
import { PATHS } from './sharingPathsFixture';
import { MAX_HISTORY_CHARS, MergeHistory, undoLastMerge } from '../../../../src/app/online/sharing/merge/MergeHistory';
import { createUpdatePolicy, TAGS_LOST_WARNING, type AskResult } from '../../../../src/app/online/sharing/merge/noteUpdate';
import type { CatalogueItem } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import { pullNote } from '../../../../src/app/online/sharing/receive/notePull';
import { PulledItems } from '../../../../src/app/online/sharing/receive/PulledItems';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { TABLE_ID } from './sharingFixtures';

const PATH = 'Shared/Ana/Cave.md';
const item = (version: string): CatalogueItem => ({ item: 'c'.repeat(22), kind: 'note', title: 'Cave', version: version.repeat(43), size: 1 });

async function setup(answer: AskResult | null, mergeText: string | null = null) {
  const { app, files } = createInMemoryApp();
  const pulled = PulledItems.create(app.vault.adapter, PATHS);
  await pulled.ready();
  const history = new MergeHistory(app.vault.adapter, PATHS.history);
  const ask = vi.fn(async () => answer);
  const merge = vi.fn(async (): Promise<{ text: string; conflictDefault: 'theirs' } | null> => (mergeText === null ? null : { text: mergeText, conflictDefault: 'theirs' }));
  const policy = createUpdatePolicy({ pulled, ask, merge });
  const deps = { app, pulled, policy, replaced: (record: Parameters<MergeHistory['add']>[0], before: string, after: string) => history.add(record, { at: 1, before, after }) };
  const pull = (version: string, text: string) => pullNote(deps, { tableId: TABLE_ID, from: 'ana', personName: 'Ana', item: item(version), text });
  await pull('1', 'a\nb\nc\nd\ne');
  files.set(PATH, 'a\nMINE\nc\nd\ne');
  return { app, files, pulled, history, ask, merge, pull };
}

describe('updating a note changed on both sides', () => {
  it('keep mine leaves the file and takes theirs as the new base', async () => {
    const { files, pull } = await setup({ choice: 'mine', remember: false, silent: false });
    expect(await pull('2', 'a\nb\nc\nTHEIRS\ne')).toMatchObject({ kind: 'kept' });
    expect(files.get(PATH)).toBe('a\nMINE\nc\nd\ne');
    expect(await pull('2', 'a\nb\nc\nTHEIRS\ne')).toMatchObject({ kind: 'unchanged' });
  });

  it('take theirs replaces the note, keeps mine in the history, and undo brings it back', async () => {
    const { app, files, pulled, history, pull } = await setup({ choice: 'theirs', remember: false, silent: false });
    await pull('2', 'theirs text');
    expect(files.get(PATH)).toBe('theirs text');
    const record = pulled.byPath(PATH)!;
    expect(await history.entries(record)).toEqual([{ at: 1, before: 'a\nMINE\nc\nd\ne', after: 'theirs text' }]);
    expect(await undoLastMerge(app, history, record, async () => true)).toBe('undone');
    expect(files.get(PATH)).toBe('a\nMINE\nc\nd\ne');
    expect(await history.entries(record)).toEqual([]);
  });

  it('keep both lands beside the note where the receiver moved it, or at the root for a root-level note', async () => {
    const moved = await setup({ choice: 'both', remember: false, silent: false });
    moved.files.delete(PATH);
    moved.files.set('Campaign/Cave.md', 'a\nMINE\nc\nd\ne');
    moved.pulled.renamed(PATH, 'Campaign/Cave.md');
    expect(await moved.pull('2', 'two')).toMatchObject({ kind: 'both', path: 'Campaign/Cave (from Ana).md' });
    const root = await setup({ choice: 'both', remember: false, silent: false });
    root.files.delete(PATH);
    root.files.set('Cave.md', 'a\nMINE\nc\nd\ne');
    root.pulled.renamed(PATH, 'Cave.md');
    expect(await root.pull('2', 'two')).toMatchObject({ kind: 'both', path: 'Cave (from Ana).md' });
  });

  it('remembers the choice for the note and asks no more', async () => {
    const { ask, pull, pulled } = await setup({ choice: 'both', remember: true, silent: false });
    await pull('2', 'one');
    await pull('3', 'two');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(pulled.byPath(PATH)?.choice).toBe('both');
  });

  it('forgets a remembered choice, so the next update asks again (I5)', async () => {
    const { ask, pull, pulled } = await setup({ choice: 'mine', remember: true, silent: true });
    await pull('2', 'one');
    expect(ask).toHaveBeenCalledTimes(1);
    const key = pulled.byPath(PATH)?.key ?? '';
    expect(pulled.forgetChoice(key)).toBe(true);
    expect(pulled.byPath(PATH)).not.toHaveProperty('choice');
    expect(pulled.byPath(PATH)).not.toHaveProperty('silent');
    expect(pulled.forgetChoice(key)).toBe(false);
    await pull('3', 'two');
    expect(ask).toHaveBeenCalledTimes(2);
  });

  it('auto merge applies one-sided changes and shows the result unless silent', async () => {
    const shown = await setup({ choice: 'auto', remember: false, silent: false }, 'edited result');
    await shown.pull('2', 'a\nb\nc\nTHEIRS\ne');
    expect(shown.merge).toHaveBeenCalledWith(expect.objectContaining({ preview: 'a\nMINE\nc\nTHEIRS\ne' }));
    expect(shown.files.get(PATH)).toBe('edited result');
    const silent = await setup({ choice: 'auto', remember: true, silent: true });
    await silent.pull('2', 'a\nb\nc\nTHEIRS\ne');
    expect(silent.merge).not.toHaveBeenCalled();
    expect(silent.files.get(PATH)).toBe('a\nMINE\nc\nTHEIRS\ne');
  });

  it('auto merge only on pull: a remembered silent auto merge merges nothing until the receiver pulls', async () => {
    const { files, ask, merge, pull } = await setup({ choice: 'auto', remember: true, silent: true });
    await pull('2', 'a\nb\nc\nTHEIRS\ne');
    files.set(PATH, 'a\nMINE2\nc\nTHEIRS\ne');
    // The next pull is the only thing that merges: mine and theirs changed lines apart.
    await pull('3', 'a\nb\nc\nTHEIRS\nE');
    expect(files.get(PATH)).toBe('a\nMINE2\nc\nTHEIRS\nE');
    expect(ask).toHaveBeenCalledTimes(1);
    expect(merge).not.toHaveBeenCalled();
  });

  it('resolve conflicts opens the merge page and stores its conflict default; closing it changes nothing', async () => {
    const resolved = await setup({ choice: 'resolve', remember: false, silent: false }, 'merged by hand');
    await resolved.pull('2', 'a\nTHEIRS\nc\nd\ne');
    expect(resolved.merge).toHaveBeenCalledWith(expect.objectContaining({ preview: null, conflictDefault: 'both' }));
    expect(resolved.files.get(PATH)).toBe('merged by hand');
    expect(resolved.pulled.byPath(PATH)?.conflictDefault).toBe('theirs');
    const closed = await setup({ choice: 'resolve', remember: false, silent: false }, null);
    expect(await closed.pull('2', 'a\nTHEIRS\nc\nd\ne')).toEqual({ kind: 'cancelled' });
    expect(closed.files.get(PATH)).toBe('a\nMINE\nc\nd\ne');
  });

  it('keeps what the file held when the merge was saved, even if the receiver edited it while the page was open', async () => {
    const { files, pulled, history, pull, merge } = await setup({ choice: 'resolve', remember: false, silent: false }, 'merged');
    merge.mockImplementationOnce(async () => {
      files.set(PATH, 'typed meanwhile');
      return { text: 'merged', conflictDefault: 'theirs' as const };
    });
    await pull('2', 'a\nTHEIRS\nc\nd\ne');
    expect((await history.entries(pulled.byPath(PATH)!)).map((entry) => entry.before)).toEqual(['typed meanwhile']);
  });
});

describe('updates that must never be saved unseen', () => {
  const basePath = (pulled: PulledItems): string => `${PATHS.bases}/${pulled.byPath(PATH)!.baseKey}.md`;

  it('a missing base is changed on both sides: it asks and never overwrites the receiver text', async () => {
    const { files, pulled, ask, pull } = await setup({ choice: 'mine', remember: false, silent: false });
    files.delete(basePath(pulled));
    expect(await pull('2', 'a\nb\nc\nTHEIRS\ne')).toMatchObject({ kind: 'kept' });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(files.get(PATH)).toBe('a\nMINE\nc\nd\ne');
  });

  it('a missing base shows the merge page even for a remembered silent auto merge', async () => {
    const { files, pulled, merge, pull } = await setup({ choice: 'auto', remember: true, silent: true }, 'seen and saved');
    await pull('2', 'a\nb\nc\nTHEIRS\ne');
    files.set(PATH, 'a\nMINE2\nc\nTHEIRS\ne');
    files.delete(basePath(pulled));
    await pull('3', 'a\nb\nc\nTHEIRS\nE');
    expect(merge).toHaveBeenCalledTimes(1);
    expect(files.get(PATH)).toBe('seen and saved');
  });

  it('when the diff gives up on a very long note, a silent auto merge shows the merge page instead', async () => {
    const { files, merge, pull } = await setup({ choice: 'auto', remember: true, silent: true }, 'seen and saved');
    await pull('2', Array.from({ length: MAX_DIFF_LINES + 1 }, (_, i) => `line ${i}`).join('\n'));
    expect(merge).toHaveBeenCalledTimes(1);
    expect(files.get(PATH)).toBe('seen and saved');
  });

  it('remember is kept only once confirmed, not when the merge page is cancelled', async () => {
    const { pulled, pull } = await setup({ choice: 'resolve', remember: true, silent: false }, null);
    expect(await pull('2', 'a\nTHEIRS\nc\nd\ne')).toEqual({ kind: 'cancelled' });
    expect(pulled.byPath(PATH)?.choice).toBeUndefined();
  });

  it('merges on LF and writes the note back in its own line ending', async () => {
    const { files, merge, pull } = await setup({ choice: 'auto', remember: true, silent: true });
    files.set(PATH, 'a\r\nMINE\r\nc\r\nd\r\ne');
    await pull('2', 'a\nb\nc\nTHEIRS\ne');
    expect(merge).not.toHaveBeenCalled();
    expect(files.get(PATH)).toBe('a\r\nMINE\r\nc\r\nTHEIRS\r\ne');
  });

  it('a one-sided update and Take theirs also keep a CRLF note CRLF (M1)', async () => {
    const one = await setup({ choice: 'mine', remember: false, silent: false });
    one.files.set(PATH, 'a\r\nb\r\nc\r\nd\r\ne');
    await one.pull('2', 'a\nb\nc\nTHEIRS\ne');
    expect(one.files.get(PATH)).toBe('a\r\nb\r\nc\r\nTHEIRS\r\ne');
    const theirs = await setup({ choice: 'theirs', remember: false, silent: false });
    theirs.files.set(PATH, 'a\r\nMINE\r\nc\r\nd\r\ne');
    await theirs.pull('2', 'x\ny');
    expect(theirs.files.get(PATH)).toBe('x\r\ny');
  });
});

describe('the merge history', () => {
  it('is cleared when a pulled record is written to a fresh file (M4)', async () => {
    const { app, files, pulled, history } = await setup({ choice: 'theirs', remember: false, silent: false });
    const policy = createUpdatePolicy({ pulled, ask: async () => ({ choice: 'theirs', remember: false, silent: false }), merge: async () => null });
    const deps = {
      app, pulled, policy,
      replaced: (record: Parameters<MergeHistory['add']>[0], before: string, after: string) => history.add(record, { at: 1, before, after }),
      rehomed: (record: Parameters<MergeHistory['add']>[0]) => history.clear(record),
    };
    const pull = (version: string, text: string) => pullNote(deps, { tableId: TABLE_ID, from: 'ana', personName: 'Ana', item: item(version), text });
    const record = pulled.byPath(PATH)!;
    await pull('2', 'theirs text');
    expect(await history.entries(record)).toHaveLength(1);
    files.delete(PATH);
    expect(await pull('3', 'fresh')).toMatchObject({ kind: 'created' });
    expect(await history.entries(record)).toEqual([]);
  });

  it('keeps at most 20 entries per note, the newest last', async () => {
    const { app, pulled } = await setup(null);
    const history = new MergeHistory(app.vault.adapter, PATHS.history);
    const record = pulled.byPath(PATH)!;
    for (let i = 0; i < 25; i++) await history.add(record, { at: i, before: `b${i}`, after: `a${i}` });
    const entries = await history.entries(record);
    expect(entries).toHaveLength(20);
    expect(entries[0]?.at).toBe(5);
    expect(entries.at(-1)?.at).toBe(24);
  });

  it('drops the oldest entries past its size cap, and keeps the newest', async () => {
    const { app, pulled } = await setup(null);
    const history = new MergeHistory(app.vault.adapter, PATHS.history);
    const record = pulled.byPath(PATH)!;
    const half = 'x'.repeat(Math.floor(MAX_HISTORY_CHARS / 4));
    for (let i = 0; i < 5; i++) await history.add(record, { at: i, before: half, after: half });
    expect((await history.entries(record)).map((entry) => entry.at)).toEqual([3, 4]);
  });

  it('asks before undoing over a note that changed since, and declining leaves it alone', async () => {
    const { app, files, pulled, history, pull } = await setup({ choice: 'theirs', remember: false, silent: false });
    await pull('2', 'theirs text');
    const record = pulled.byPath(PATH)!;
    files.set(PATH, 'edited after');
    expect(await undoLastMerge(app, history, record, async () => false)).toBe('declined');
    expect(files.get(PATH)).toBe('edited after');
    expect(await history.entries(record)).toHaveLength(1);
    expect(await undoLastMerge(app, history, record, async () => true)).toBe('undone');
    expect(files.get(PATH)).toBe('a\nMINE\nc\nd\ne');
  });

  it('undo touches no file a record does not own: after its file was deleted, nothing is written', async () => {
    const { app, files, pulled, history, pull } = await setup({ choice: 'theirs', remember: false, silent: false });
    await pull('2', 'theirs text');
    const record = pulled.byPath(PATH)!;
    files.delete(PATH);
    pulled.deleted(PATH);
    files.set(PATH, 'a stranger at the same path');
    const confirm = vi.fn(async () => true);
    expect(await undoLastMerge(app, history, pulled.get(record.tableId, record.from, record.item)!, confirm)).toBe('nothing');
    expect(files.get(PATH)).toBe('a stranger at the same path');
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('merges and part tags (M5)', () => {
  const context = (theirs: string) => ({
    record: { key: 'k', conflictDefault: 'mine', choice: 'auto', silent: true } as never,
    title: 'Cave', personName: 'Morgan', base: 'a\nb\nc', mine: 'a\nMINE\nc', theirs,
  });

  it('a silent auto merge that would lose part tags shows the merge page, and saving it without them warns', async () => {
    const merge = vi.fn(async () => ({ text: 'a\nMINE\nc', conflictDefault: 'mine' as const }));
    const warn = vi.fn();
    const policy = createUpdatePolicy({ pulled: { update: vi.fn() } as never, ask: vi.fn(), merge, warn });
    const result = await policy.resolve(context('a\n%%[!only|Morgan]%%\nTHEIRS\n%%[!end]%%\nc'));
    expect(merge).toHaveBeenCalledOnce();
    expect(result).toEqual({ kind: 'write', text: 'a\nMINE\nc' });
    expect(warn).toHaveBeenCalledWith(TAGS_LOST_WARNING);
  });

  it('a silent auto merge that keeps the tags is saved unseen, with no warning', async () => {
    const merge = vi.fn();
    const warn = vi.fn();
    const policy = createUpdatePolicy({ pulled: { update: vi.fn() } as never, ask: vi.fn(), merge, warn });
    const result = await policy.resolve({ ...context('%%[!only|Morgan]%%\na\n%%[!end]%%\nb\nc'), mine: 'a\nb\nc MINE' });
    expect(merge).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'write', text: '%%[!only|Morgan]%%\na\n%%[!end]%%\nb\nc MINE' });
    expect(warn).not.toHaveBeenCalled();
  });
});
