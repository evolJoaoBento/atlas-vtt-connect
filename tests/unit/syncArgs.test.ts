import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without types
import { parseSyncArgs } from '../../scripts/syncArgs.mjs';

const parse = parseSyncArgs as (argv: string[]) => { mode?: string; dir?: string; commit?: string; error?: string };

describe('sync-atlas arguments', () => {
  it('git mode is --atlas with a commit', () => {
    expect(parse(['--atlas', 'C:/atlas', '--commit', '26bd6b1'])).toEqual({ mode: 'git', dir: 'C:/atlas', commit: '26bd6b1' });
  });
  it('exported mode is --source with a commit', () => {
    expect(parse(['--source', '/tmp/atlas8', '--commit', '26bd6b1b8be2bfe6df8c3c2740ce6fcaa5df71e2'])).toMatchObject({ mode: 'source', dir: '/tmp/atlas8' });
  });
  it('needs exactly one of --atlas and --source, and a hex commit', () => {
    for (const argv of [[], ['--commit', '26bd6b1'], ['--atlas', 'a', '--source', 'b', '--commit', '26bd6b1'], ['--source', 'b'], ['--source', 'b', '--commit', 'main']]) {
      expect(parse(argv).error).toContain('Usage');
    }
  });
});
