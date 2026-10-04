import { describe, expect, it, vi } from 'vitest';
import { TFile, type App } from 'obsidian';
import { ASSET_LIMITS } from '../../../src/app/online/assets/assetIds';
import { vaultImageFiles } from '../../../src/app/online/assets/vaultImageFiles';
import { AssetRegistry, IMAGE_TOO_LARGE_NOTICE, type AssetInfo, type ImageFiles } from '../../../src/app/online/scene/AssetRegistry';
import { fingerprintOf, memoryImageFiles, nodeHash, settle } from './assetFixtures';

function registry(files: ImageFiles, withNodeHash = true): { assets: AssetRegistry; notices: string[]; changes: () => number } {
  const notices: string[] = [];
  let changes = 0;
  const assets = new AssetRegistry({ files, notify: (message) => notices.push(message), ...(withNodeHash ? { hash: nodeHash } : {}) });
  assets.onChange(() => { changes++; });
  return { assets, notices, changes: () => changes };
}

/** What the registry knows about a fingerprint's file: its private table, read for assertions. */
const infoOf = (assets: AssetRegistry, id: string): AssetInfo | null => assets['infos'].get(id) ?? null;

const bytesOf = (text: string): ArrayBuffer => new TextEncoder().encode(text).slice().buffer;

describe('AssetRegistry', () => {
  it('gives an image its SHA-256 once hashed, with Web Crypto by default', async () => {
    const files = memoryImageFiles({ 'maps/cave.png': 'cave bytes' });
    const { assets, changes } = registry(files.source, false);
    expect(assets.idFor('maps/cave.png')).toBeNull();
    await vi.waitFor(() => expect(assets.idFor('maps/cave.png')).toBe(fingerprintOf('cave bytes')));
    expect(changes()).toBe(1);
    expect(infoOf(assets, fingerprintOf('cave bytes'))).toEqual({ path: 'maps/cave.png', size: 10, mime: 'image/png' });
  });

  it('hashes an unchanged file once and a changed one again', async () => {
    const files = memoryImageFiles({ 'a.png': 'first' });
    const { assets } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('a.png');
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('first'));
    expect(files.reads).toEqual(['a.png']);

    files.set('a.png', 'second', 2);
    expect(assets.idFor('a.png')).toBeNull();
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('second'));
    expect(files.reads).toEqual(['a.png', 'a.png']);
  });

  it('gives two files with the same bytes one fingerprint', async () => {
    const files = memoryImageFiles({ 'a.png': 'same', 'copy/b.webp': 'same' });
    const { assets } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('copy/b.webp');
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('same'));
    expect(assets.idFor('copy/b.webp')).toBe(fingerprintOf('same'));
  });

  it('gives no id to other types, missing files and unreadable ones, and does not retry an unchanged unreadable file', async () => {
    const files = memoryImageFiles({ 'notes/a.md': 'text', 'bad.png': 'x' });
    files.fail('bad.png');
    const { assets, changes } = registry(files.source);
    expect(assets.idFor('notes/a.md')).toBeNull();
    expect(assets.idFor('missing.png')).toBeNull();
    expect(assets.idFor('bad.png')).toBeNull();
    expect(assets.idFor(null)).toBeNull();
    expect(assets.idFor('')).toBeNull();
    await settle();
    expect(assets.idFor('bad.png')).toBeNull();
    await settle();
    expect(files.reads).toEqual(['bad.png']);
    expect(changes()).toBe(0);
  });

  it('refuses images over 64 MB with one notice per session', async () => {
    const read = vi.fn(async (): Promise<ArrayBuffer> => new ArrayBuffer(0));
    const big: ImageFiles = { stat: () => ({ size: ASSET_LIMITS.fileBytes + 1, mtime: 1 }), read };
    const { assets, notices } = registry(big);
    expect(assets.idFor('huge.png')).toBeNull();
    expect(assets.idFor('other-huge.jpg')).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(notices).toEqual([IMAGE_TOO_LARGE_NOTICE]);

    // A file that grew past the limit after its size was read is caught when it is read.
    const grown: ImageFiles = { stat: () => ({ size: 10, mtime: 1 }), read: async () => new ArrayBuffer(ASSET_LIMITS.fileBytes + 1) };
    const second = registry(grown);
    second.assets.idFor('grown.png');
    await settle();
    expect(second.assets.idFor('grown.png')).toBeNull();
    expect(second.notices).toEqual([IMAGE_TOO_LARGE_NOTICE]);
  });

  it('reads a file again for serving, and forgets its fingerprint when it changed or became unreadable', async () => {
    const files = memoryImageFiles({ 'a.png': 'abc', 'b.png': 'bbb' });
    const { assets, changes } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    const a = fingerprintOf('abc');
    const b = fingerprintOf('bbb');
    const served = await assets.read(a);
    expect(new TextDecoder().decode(served?.bytes)).toBe('abc');
    expect(served?.mime).toBe('image/png');

    // A sync tool rewrote the file keeping its time and size: only the bytes tell.
    files.set('a.png', 'abd', 1);
    expect(await assets.read(a)).toBeNull();
    expect(infoOf(assets, a)).toBeNull();
    expect(changes()).toBe(3);
    expect(assets.idFor('a.png')).toBeNull();
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('abd'));

    files.fail('b.png');
    expect(await assets.read(b)).toBeNull();
    expect(infoOf(assets, b)).toBeNull();
    expect(await assets.read(fingerprintOf('never seen'))).toBeNull();
  });

  it('hashes one file at a time and drops a result that finished after the file changed', async () => {
    const reads: string[] = [];
    const pending: Array<(bytes: ArrayBuffer) => void> = [];
    const stats = new Map([['a.png', { size: 1, mtime: 1 }], ['b.png', { size: 1, mtime: 1 }]]);
    const files: ImageFiles = {
      stat: (path) => stats.get(path) ?? null,
      read: (path) => new Promise((resolve) => { reads.push(path); pending.push(resolve); }),
    };
    const { assets } = registry(files);
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    expect(reads).toEqual(['a.png']); // b waits for a

    stats.set('a.png', { size: 1, mtime: 2 }); // a changes while it is read
    assets.idFor('a.png');
    pending[0]!(bytesOf('old'));
    await settle();
    expect(assets.idFor('a.png')).toBeNull();
    expect(reads).toEqual(['a.png', 'b.png']);
    pending[1]!(bytesOf('b'));
    await settle();
    expect(reads).toEqual(['a.png', 'b.png', 'a.png']);
    pending[2]!(bytesOf('new'));
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('new'));
    expect(assets.idFor('b.png')).toBe(fingerprintOf('b'));
  });

  it('stops hashing and notifying once disposed', async () => {
    const files = memoryImageFiles({ 'a.png': 'a' });
    const { assets, changes } = registry(files.source);
    assets.idFor('a.png');
    assets.dispose();
    await settle();
    expect(changes()).toBe(0);
    expect(assets.idFor('a.png')).toBeNull();
  });

  it('never reads a queued file after dispose, nor serves one', async () => {
    const files = memoryImageFiles({ 'a.png': 'a', 'b.png': 'b' });
    const { assets, changes } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    const known = fingerprintOf('a');
    expect(infoOf(assets, known)).not.toBeNull();
    assets.dispose();
    expect(await assets.read(known)).toBeNull();

    const second = memoryImageFiles({ 'a.png': 'a', 'b.png': 'b' });
    const other = registry(second.source);
    other.assets.idFor('a.png');
    other.assets.idFor('b.png');
    other.assets.dispose(); // a is being read; b has not been
    await settle();
    expect(second.reads).toEqual(['a.png']);
    expect(other.changes()).toBe(0);
    expect(changes()).toBe(2);
    expect(second.listening()).toBe(0);
  });

  it('keeps serving a fingerprint through another path with the same bytes', async () => {
    const files = memoryImageFiles({ 'a.png': 'same', 'b.png': 'same' });
    const { assets } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    const id = fingerprintOf('same');
    expect(infoOf(assets, id)?.path).toBe('a.png');

    // a is edited: the fingerprint moves to b, which is read for serving.
    files.set('a.png', 'edited', 2);
    expect(assets.idFor('a.png')).toBeNull();
    expect(infoOf(assets, id)?.path).toBe('b.png');
    expect((await assets.read(id))?.bytes.byteLength).toBe(4);
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('edited'));

    // b breaks: it alone is dropped, and with no other path the id goes.
    files.remove('b.png');
    expect(await assets.read(id)).toBeNull();
    expect(infoOf(assets, id)).toBeNull();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('edited'));
  });

  it('does not drop a healthy path when a duplicate breaks', async () => {
    const files = memoryImageFiles({ 'a.png': 'same', 'b.png': 'same' });
    const { assets } = registry(files.source);
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    const id = fingerprintOf('same');
    files.fail('a.png');
    expect(await assets.read(id)).toBeNull();
    expect(infoOf(assets, id)?.path).toBe('b.png');
    expect(assets.idFor('b.png')).toBe(id);
    expect((await assets.read(id))?.bytes.byteLength).toBe(4);
  });

  it('forgets a fingerprint when the vault reports its file changed, deleted or renamed', async () => {
    const files = memoryImageFiles({ 'a.png': 'one', 'copy.png': 'one', 'c.png': 'three' });
    const { assets, changes } = registry(files.source);
    ['a.png', 'copy.png', 'c.png'].forEach((path) => assets.idFor(path));
    await settle();
    const one = fingerprintOf('one');
    const before = changes();

    files.set('a.png', 'uno', 1); // same time and size are not enough to trust the cache
    files.changed('a.png');
    expect(changes()).toBe(before + 1);
    expect(infoOf(assets, one)?.path).toBe('copy.png');
    expect(assets.idFor('a.png')).toBeNull();
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('uno'));

    files.remove('c.png');
    files.changed('c.png');
    expect(infoOf(assets, fingerprintOf('three'))).toBeNull();
    files.set('d.png', 'three', 1); // renamed from c.png
    files.changed('c.png');
    files.changed('d.png');
    expect(assets.idFor('d.png')).toBeNull();
    await settle();
    expect(assets.idFor('d.png')).toBe(fingerprintOf('three'));

    const count = changes();
    files.changed('never-seen.png');
    expect(changes()).toBe(count);
  });

  it('hashes a file again that the vault reports changed while it was read', async () => {
    const files = memoryImageFiles({ 'a.png': 'old' });
    const { assets } = registry(files.source);
    assets.idFor('a.png');
    files.set('a.png', 'new', 1);
    files.changed('a.png'); // before the first read resolves
    await settle();
    expect(assets.idFor('a.png')).toBeNull();
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('new'));
  });

  it('keeps hashing when a change listener throws', async () => {
    const files = memoryImageFiles({ 'a.png': 'a', 'b.png': 'b' });
    const { assets } = registry(files.source);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    assets.onChange(() => { throw new Error('listener bug'); });
    assets.idFor('a.png');
    assets.idFor('b.png');
    await settle();
    expect(assets.idFor('a.png')).toBe(fingerprintOf('a'));
    expect(assets.idFor('b.png')).toBe(fingerprintOf('b'));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('vaultImageFiles', () => {
  it('reads vault images through Obsidian', async () => {
    const file = new (TFile as unknown as new (path: string) => TFile)('maps/cave.png');
    file.stat = { ctime: 0, mtime: 5, size: 3 };
    const app = {
      vault: {
        getAbstractFileByPath: (path: string) => (path === 'maps/cave.png' ? file : null),
        readBinary: async (target: TFile) => (target === file ? new Uint8Array([1, 2, 3]).buffer : new ArrayBuffer(0)),
      },
    } as unknown as App;
    const files = vaultImageFiles(app);
    expect(files.stat('maps/cave.png')).toEqual({ size: 3, mtime: 5 });
    expect(files.stat('maps/other.png')).toBeNull();
    expect([...new Uint8Array(await files.read('maps/cave.png'))]).toEqual([1, 2, 3]);
    await expect(files.read('maps/other.png')).rejects.toThrow();
  });

  it('reports modified, deleted and renamed files until unsubscribed', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const off = vi.fn();
    const app = {
      vault: {
        on: (name: string, handler: (...args: unknown[]) => void) => { handlers.set(name, handler); return { name }; },
        offref: off,
      },
    } as unknown as App;
    const seen: string[] = [];
    const stop = vaultImageFiles(app).onChange!((path) => seen.push(path));
    handlers.get('modify')!({ path: 'a.png' });
    handlers.get('delete')!({ path: 'b.png' });
    handlers.get('rename')!({ path: 'new.png' }, 'old.png');
    expect(seen).toEqual(['a.png', 'b.png', 'old.png', 'new.png']);
    stop();
    expect(off).toHaveBeenCalledTimes(3);
  });

  it('gives no id to an empty file', async () => {
    const files = memoryImageFiles({ 'empty.png': '' });
    const { assets } = registry(files.source);
    expect(assets.idFor('empty.png')).toBeNull();
    await settle();
    expect(assets.idFor('empty.png')).toBeNull();
  });
});
