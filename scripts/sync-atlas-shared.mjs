// Copies the stock Atlas VTT files listed in packages/atlas-shared/files.mjs, byte for byte, from an Atlas source
// checkout at the pinned tag into packages/atlas-shared/src/app, writes a type stub for every type-only import of a
// file that is not listed, and records the tag, commit and hashes in packages/atlas-shared/SOURCE.json.
// Usage: node scripts/sync-atlas-shared.mjs --atlas <Atlas source checkout>
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATLAS_TAG, BOUNDARIES, FILES, STUB_TYPES } from '../packages/atlas-shared/files.mjs';
import { IMPORT, isTypeOnly, typeNamesOf } from './sharedImports.mjs';
import { hashFile } from './vendorHash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shared = path.join(root, 'packages/atlas-shared');
const out = path.join(shared, 'src/app');
const flag = process.argv.indexOf('--atlas');
if (flag < 0 || !process.argv[flag + 1]) throw new Error('Usage: node scripts/sync-atlas-shared.mjs --atlas <Atlas source checkout>');
const atlas = path.resolve(process.argv[flag + 1]);
const app = path.join(atlas, 'src/app');

const version = JSON.parse(readFileSync(path.join(atlas, 'manifest.json'), 'utf8')).version;
if (version !== ATLAS_TAG) throw new Error(`${atlas} is Atlas ${version}; packages/atlas-shared is pinned to ${ATLAS_TAG}`);
const git = (...args) => execFileSync('git', ['-C', atlas, ...args], { encoding: 'utf8' }).trim();
const tag = git('describe', '--tags', '--exact-match');
if (tag !== ATLAS_TAG) throw new Error(`${atlas} is at ${tag}, not the tag ${ATLAS_TAG}`);
const commit = git('rev-parse', 'HEAD');

const posix = (file) => file.split(path.sep).join('/');
const listed = new Set(FILES);
/** The Atlas file (relative to src/app, posix) an import of `spec` from `file` names. */
function resolveImport(file, spec) {
  const base = path.resolve(path.dirname(path.join(app, file)), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (existsSync(candidate)) return posix(path.relative(app, candidate));
  throw new Error(`${file} imports ${spec}, which is not in Atlas's source`);
}

const stubs = new Map();
const boundaries = new Set();
for (const file of FILES) {
  const source = readFileSync(path.join(app, file), 'utf8');
  if (/\bimport\(\s*['"]/.test(source)) throw new Error(`${file} imports on demand; list what it needs`);
  for (const match of source.matchAll(IMPORT)) {
    const head = match[2];
    const spec = match[4];
    if (!spec.startsWith('.')) throw new Error(`${file} imports the package ${spec}`);
    const target = resolveImport(file, spec);
    if (listed.has(target)) continue;
    // Stood in for, whatever is imported from it.
    if (Object.hasOwn(BOUNDARIES, target)) { boundaries.add(target); continue; }
    if (!isTypeOnly(head)) throw new Error(`${file} imports ${spec} at run time; list it`);
    const names = stubs.get(target) ?? new Set();
    for (const name of typeNamesOf(head)) names.add(name);
    stubs.set(target, names);
  }
}

rmSync(out, { recursive: true, force: true });
const record = { repository: 'atlas-vtt/atlas-vtt', tag: ATLAS_TAG, commit, files: {}, stubs: {}, boundaries: {} };
for (const file of [...FILES].sort()) {
  const to = path.join(out, file);
  mkdirSync(path.dirname(to), { recursive: true });
  copyFileSync(path.join(app, file), to);
  record.files[`src/app/${file}`] = hashFile(to);
}
for (const file of [...stubs.keys()].sort()) {
  const to = path.join(out, file);
  mkdirSync(path.dirname(to), { recursive: true });
  const lines = [...stubs.get(file)].sort().map((name) => `export type ${name} = ${STUB_TYPES[file]?.[name] ?? 'any'};`);
  writeFileSync(to, `// Generated type stub (scripts/sync-atlas-shared.mjs). Atlas's ${file} is not copied: only its type names are needed.\n${lines.join('\n')}\n`);
  record.stubs[`src/app/${file}`] = hashFile(to);
}
for (const file of [...boundaries].sort()) {
  if (stubs.has(file)) throw new Error(`${file} is a boundary and cannot also be stubbed`);
  const to = path.join(out, file);
  mkdirSync(path.dirname(to), { recursive: true });
  writeFileSync(to, BOUNDARIES[file]);
  record.boundaries[`src/app/${file}`] = hashFile(to);
}
writeFileSync(path.join(shared, 'SOURCE.json'), `${JSON.stringify(record, null, 2)}\n`);
console.log(`packages/atlas-shared: ${FILES.length} files, ${stubs.size} stubs and ${boundaries.size} boundaries from Atlas ${ATLAS_TAG} (${commit.slice(0, 7)})`);
