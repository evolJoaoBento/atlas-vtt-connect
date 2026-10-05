import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The join page opens without three.js: the 3D dice are their own chunk, loaded with the first thrown roll.
 * The vendored `@atlas-vtt/shared/dice3d` is one bundle that imports three.js, so a static import of it (or of
 * three) anywhere in the page's first script puts all of it back there. This walks the static imports of
 * `online-client/main.mts` and fails on one.
 */
const ROOT = process.cwd();
const ENTRY = join(ROOT, 'online-client/main.mts');
const CHUNK = join(ROOT, 'online-client/dice3d/diceThrows.mts');
const HEAVY = /^(three(\/.*)?|@atlas-vtt\/shared\/dice3d)$/;

function staticImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?(['"])([^'"]+)\2;/gm)]
    .filter((match) => !match[1])
    .map((match) => match[3]!);
}

function firstScript(): { files: string[]; heavy: string[] } {
  const files = new Set<string>();
  const heavy: string[] = [];
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    for (const spec of staticImports(file)) {
      if (HEAVY.test(spec)) heavy.push(`${relative(ROOT, file)}: ${spec}`);
      if (!spec.startsWith('.') || /\.(webp|png|css)(\?|$)/.test(spec)) continue;
      const base = resolve(dirname(file), spec);
      const next = ['', '.ts', '.mts', '.tsx'].map((ext) => base + ext).find((candidate) => existsSync(candidate) && !candidate.endsWith('/'));
      if (!next) throw new Error(`cannot resolve ${spec} from ${relative(ROOT, file)}`);
      visit(next);
    }
  };
  visit(ENTRY);
  return { files: [...files], heavy };
}

describe("the join page's first script", () => {
  const { files, heavy } = firstScript();

  it('imports neither three.js nor the vendored dice bundle', () => {
    expect(heavy).toEqual([]);
  });

  it('does not reach the dice chunk statically, and loads it with a dynamic import', () => {
    expect(files).not.toContain(CHUNK);
    expect(readFileSync(ENTRY, 'utf8')).toMatch(/import\(\s*'\.\/dice3d\/diceThrows\.mts'\s*\)/);
  });
});
