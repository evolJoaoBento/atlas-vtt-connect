import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The join page's 3D dice chunk runs Atlas's dice code (vendored in `vendor/atlas/shared/dice3d.js`) on a plain web page,
 * where only `obsidianShim.mts` stands in for Obsidian: `createEl` (with `cls` and `attr`) and
 * `activeDocument`. The unit tests cannot catch a new Obsidian global, since the test setup installs
 * them all; this reads every module the chunk runs and fails when one reaches for another.
 */
const ROOT = process.cwd();
const ENTRY = join(ROOT, 'online-client/dice3d/diceThrows.mts');
const SHIMMED = new Set(['createEl', 'activeDocument']);
/** What `obsidianShim.mts`'s `createEl` handles of Obsidian's `DomElementInfo`. */
const SHIMMED_OPTIONS = new Set(['cls', 'attr']);
/** Obsidian members that share their name with the browser's or the language's own, so the page has them too. */
const STANDARD = new Set([
  'contains', 'remove', 'find', 'findIndex', 'findLast', 'findLastIndex', 'includes', 'clamp', 'isNumber', 'assign',
  'activeDocument', 'first', 'last', 'unique', 'empty', 'show', 'hide', 'toggle', 'on', 'off', 'onClickEvent', 'win', 'doc', 'indexOf',
]);

function sourceOf(path: string): string {
  return readFileSync(path, 'utf8');
}

/** Where an import of ours lands: `@atlas-vtt/shared/<entry>` is the vendored bundle; a relative path is a file next to the importer. */
function resolveImport(file: string, spec: string): string | null {
  const shared = /^@atlas-vtt\/shared\/(\w+)$/.exec(spec);
  if (shared) return join(ROOT, 'vendor/atlas/shared', `${shared[1]}.js`);
  if (!spec.startsWith('.') || /\.(webp|png|mp3|css)(\?|$)/.test(spec)) return null;
  const base = resolve(dirname(file), spec);
  const found = ['', '.ts', '.mts', '.tsx'].map((ext) => base + ext).find((candidate) => existsSync(candidate) && !candidate.endsWith('/'));
  if (!found) throw new Error(`cannot resolve ${spec} from ${relative(ROOT, file)}`);
  return found;
}

/** Every module the chunk runs, from its entry: value imports only, never `import type`, never packages or assets. */
function chunkModules(): string[] {
  const seen = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = sourceOf(file);
    for (const match of text.matchAll(/^\s*import\s+(type\s+)?(?:[^'"]*?\s+from\s+)?(['"])([^'"]+)\2;/gm)) {
      const [, typeOnly, , spec] = match;
      const next = typeOnly ? null : resolveImport(file, spec!);
      if (next) visit(next);
    }
  };
  visit(ENTRY);
  return [...seen];
}

/** Obsidian's globals and the members it adds to the browser's and the language's objects, from its typings. */
function obsidianNames(): { globals: string[]; members: string[] } {
  const typings = sourceOf(join(ROOT, 'node_modules/obsidian/obsidian.d.ts'));
  const block = /^declare global \{([\s\S]*?)^\}/m.exec(typings)?.[1] ?? '';
  const globals = [...block.matchAll(/^\s{4}(?:function|let|var|const)\s+(\w+)/gm)].map((match) => match[1]!);
  const members = [...block.matchAll(/^\s{8}(\w+)\??\s*[(<:]/gm)].map((match) => match[1]!);
  return { globals: [...new Set(globals)], members: [...new Set(members)].filter((name) => !STANDARD.has(name)) };
}

/** The code without comments and strings, so a word in prose or copy is no use of it. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
}

describe("the join page's 3D dice chunk", () => {
  const modules = chunkModules();
  const { globals, members } = obsidianNames();

  it("runs Atlas's dice code through the shim, which it loads first", () => {
    const vendored = modules.find((file) => file.endsWith(join('vendor', 'atlas', 'shared', 'dice3d.js')));
    expect(vendored).toBeDefined();
    expect(sourceOf(vendored!)).toContain('class DiceRenderer');
    expect(/^\s*import\s+'([^']+)'/m.exec(sourceOf(ENTRY))?.[1]).toBe('./obsidianShim.mts');
    expect(globals).toEqual(expect.arrayContaining(['createEl', 'createDiv', 'activeDocument', 'activeWindow', 'sleep']));
    expect(members).toEqual(expect.arrayContaining(['addClass', 'setText', 'createDiv', 'instanceOf']));
  });

  it('uses no Obsidian global but those the shim gives, nor any member Obsidian adds to the DOM', () => {
    const uses: string[] = [];
    for (const file of modules) {
      if (file.endsWith('obsidianShim.mts')) continue;
      const text = code(sourceOf(file));
      for (const name of globals) {
        if (!SHIMMED.has(name) && new RegExp(`(?<![.\\w$])${name}\\b`).test(text)) uses.push(`${relative(ROOT, file)}: ${name}`);
      }
      for (const name of members) {
        if (new RegExp(`\\.${name}\\s*\\(`).test(text)) uses.push(`${relative(ROOT, file)}: .${name}()`);
      }
    }
    expect(uses).toEqual([]);
  });

  it('passes createEl nothing but a class and attributes', () => {
    const options: string[] = [];
    for (const file of modules) {
      const text = code(sourceOf(file));
      for (const call of text.matchAll(/\bcreateEl\(/g)) {
        const args = topLevelArgs(text, call.index + call[0].length);
        const name = relative(ROOT, file);
        if (args.length > 2) options.push(`${name}: a callback`);
        const info = args[1]?.trim();
        if (info?.startsWith('{')) for (const key of topLevelKeys(info)) if (!SHIMMED_OPTIONS.has(key)) options.push(`${name}: ${key}`);
      }
    }
    expect(options).toEqual([]);
  });
});

/** A call's arguments from just after its `(`, split at its own commas. */
function topLevelArgs(text: string, start: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = start; i < text.length; i++) {
    const char = text[i]!;
    if ('([{'.includes(char)) depth++;
    if (')]}'.includes(char)) {
      if (depth === 0) break;
      depth--;
    }
    if (char === ',' && depth === 0) {
      args.push(current);
      current = '';
    } else current += char;
  }
  if (current.trim()) args.push(current);
  return args;
}

/** The keys of an object literal itself, not of the objects inside it. */
function topLevelKeys(literal: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  for (let i = 0; i < literal.length; i++) {
    const char = literal[i]!;
    if ('([{'.includes(char)) depth++;
    else if (')]}'.includes(char)) depth--;
    else if (depth === 1) {
      const key = /^(\w+)\s*:/.exec(literal.slice(i));
      if (key && !/\w/.test(literal[i - 1] ?? '')) {
        keys.push(key[1]!);
        i += key[0].length - 1;
      }
    }
  }
  return keys;
}
