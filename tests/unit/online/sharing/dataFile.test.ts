import { afterEach, describe, expect, it, vi } from 'vitest';
import { brokenCopyPath, JsonDataFile } from '../../../../src/app/online/sharing/dataFile';
import { PATHS } from './sharingPathsFixture';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';

const PATH = PATHS.people;
const BROKEN = brokenCopyPath(PATHS.people);
const parse = (value: unknown): { n: number } => ({ n: typeof value === 'object' && value !== null && typeof (value as { n?: unknown }).n === 'number' ? (value as { n: number }).n : 0 });

afterEach(() => vi.restoreAllMocks());

describe('JsonDataFile', () => {
  it('reads and writes a value, creating the folder', async () => {
    const { app, files } = createInMemoryApp();
    const file = new JsonDataFile(app.vault.adapter, PATH, parse);
    expect(await file.load()).toEqual({ n: 0 });
    await file.save({ n: 3 });
    expect(JSON.parse(files.get(PATH)!)).toEqual({ n: 3 });
    expect(await new JsonDataFile(app.vault.adapter, PATH, parse).load()).toEqual({ n: 3 });
    expect(files.has(BROKEN)).toBe(false);
  });

  it('copies an unreadable file to .broken.json once, before the first save replaces it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, files } = createInMemoryApp({ files: { [PATH]: '{"n": 4,, broken' } });
    const file = new JsonDataFile(app.vault.adapter, PATH, parse);
    expect(await file.load()).toEqual({ n: 0 });
    expect(files.has(BROKEN)).toBe(false);
    await file.save({ n: 1 });
    expect(files.get(BROKEN)).toBe('{"n": 4,, broken');
    expect(JSON.parse(files.get(PATH)!)).toEqual({ n: 1 });
    await file.save({ n: 2 });
    expect(files.get(BROKEN)).toBe('{"n": 4,, broken');
    expect(brokenCopyPath('a/people.json')).toBe('a/people.broken.json');
  });

  it('never overwrites an earlier broken copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, files } = createInMemoryApp({ files: { [PATH]: 'not json', [BROKEN]: 'older' } });
    const file = new JsonDataFile(app.vault.adapter, PATH, parse);
    await file.load();
    await file.save({ n: 1 });
    expect(files.get(BROKEN)).toBe('older');
  });

  it('a file that cannot even be read is copied aside before the first save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, files } = createInMemoryApp({ files: { [PATH]: '{"n": 9}' } });
    vi.spyOn(app.vault.adapter, 'read').mockRejectedValueOnce(new Error('locked'));
    const file = new JsonDataFile(app.vault.adapter, PATH, parse);
    expect(await file.load()).toEqual({ n: 0 });
    await file.save({ n: 1 });
    expect(files.get(BROKEN)).toBe('{"n": 9}');
    expect(JSON.parse(files.get(PATH)!)).toEqual({ n: 1 });
  });

  it('does not replace the file when the copy fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { app, files } = createInMemoryApp({ files: { [PATH]: 'not json' } });
    const file = new JsonDataFile(app.vault.adapter, PATH, parse);
    await file.load();
    const write = vi.spyOn(app.vault.adapter, 'write').mockRejectedValueOnce(new Error('disk full'));
    await file.save({ n: 1 });
    expect(files.get(PATH)).toBe('not json');
    write.mockRestore();
    await file.save({ n: 2 });
    expect(files.get(BROKEN)).toBe('not json');
    expect(JSON.parse(files.get(PATH)!)).toEqual({ n: 2 });
  });
});
