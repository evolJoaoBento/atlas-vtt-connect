// Checks, offline, that packages/atlas-shared still holds exactly what scripts/sync-atlas-shared.mjs wrote: every copied
// Atlas file and every stub hashes as SOURCE.json says, nothing else lies under src/app, and stubs hold no code.
// Usage: node scripts/check-shared.mjs [--dir <a copy of packages/atlas-shared>]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubIsClean } from './sharedImports.mjs';
import { hashFile, hashTree } from './vendorHash.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flag = process.argv.indexOf('--dir');
const shared = flag >= 0 && process.argv[flag + 1] ? path.resolve(process.argv[flag + 1]) : path.join(root, 'packages/atlas-shared');
const source = JSON.parse(readFileSync(path.join(shared, 'SOURCE.json'), 'utf8'));

const problems = [];
const known = { ...source.files, ...source.stubs, ...(source.boundaries ?? {}) };
for (const [file, hash] of Object.entries(known)) {
  const full = path.join(shared, file);
  if (!existsSync(full)) problems.push(`missing: ${file}`);
  else if (hashFile(full) !== hash) problems.push(`changed: ${file}`);
}
for (const file of Object.keys(hashTree(path.join(shared, 'src/app')))) if (!Object.hasOwn(known, `src/app/${file}`)) problems.push(`not from the sync: src/app/${file}`);
for (const file of Object.keys(source.stubs)) {
  const full = path.join(shared, file);
  if (existsSync(full) && !stubIsClean(readFileSync(full, 'utf8'))) problems.push(`stub has code: ${file}`);
}

if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  console.error('packages/atlas-shared differs from its SOURCE.json. Run `npm run sync:shared -- --atlas <checkout>`; never edit it by hand.');
  process.exit(1);
}
console.log(`packages/atlas-shared matches Atlas ${source.tag} (${source.commit.slice(0, 7)})`);
