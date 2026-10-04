// node scripts/sync-atlas.mjs --atlas <Atlas checkout> --commit <sha>   (git mode: checks the checkout is at <sha>, builds, copies)
// node scripts/sync-atlas.mjs --source <built tree> --commit <sha>      (exported tree, e.g. `git archive <tag> | tar -x`, already
//   built with `npm run build:packages`: copies dist-packages and api-report and records <sha>; no git needed)
// Copies Atlas's extension packages into vendor/atlas (decision D1).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseSyncArgs } from './syncArgs.mjs';
import { hashTree } from './vendorHash.mjs';

const parsed = parseSyncArgs(process.argv.slice(2));
const fail = (message) => { console.error(message); process.exit(1); };
if (parsed.error) fail(parsed.error);
const atlas = path.resolve(parsed.dir);
const { commit } = parsed;
const git = (...a) => execFileSync('git', ['-C', atlas, ...a], { encoding: 'utf8' }).trim();
if (!existsSync(path.join(atlas, 'package.json'))) fail(`${atlas} is not an Atlas tree (no package.json).`);

let head = commit;
if (parsed.mode === 'git') {
  head = git('rev-parse', 'HEAD');
  if (!head.startsWith(commit)) fail(`Atlas is at ${head}, not ${commit}. Check out that commit first.`);
  if (git('status', '--porcelain', '--untracked-files=no')) fail('Atlas has uncommitted changes to tracked files.');
  // Only build:packages: never `build` or `dev`, whose hooks copy into a vault.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:packages'], { cwd: atlas, stdio: 'inherit', shell: process.platform === 'win32' });
  if (git('status', '--porcelain', '--untracked-files=no')) fail('build:packages changed tracked files in Atlas (api-report out of date?).');
}
for (const needed of ['api-report/atlas-vtt-api.d.ts', 'dist-packages/shared']) {
  if (!existsSync(path.join(atlas, needed))) fail(`${needed} is missing in ${atlas}: build the packages first (npm run build:packages).`);
}

/** Every `C-<group>-<n>` named in Atlas's contract tests: from git in git mode, from the files of an exported tree otherwise. */
function contractCaseIds() {
  const pattern = /C-[a-z]+-[0-9]+/g;
  if (parsed.mode === 'git') return git('grep', '-ohE', 'C-[a-z]+-[0-9]+', head, '--', 'tests/api').split(String.fromCharCode(10)).map((line) => line.replace(/^.*?:/, '')).filter(Boolean);
  const dir = path.join(atlas, 'tests/api');
  if (!existsSync(dir)) fail(`tests/api is missing in ${atlas}: export the whole tree, not only the build output.`);
  return readdirSync(dir, { recursive: true }).filter((name) => /\.(?:ts|tsx)$/.test(name)).flatMap((name) => readFileSync(path.join(dir, name), 'utf8').match(pattern) ?? []);
}

const vendor = path.resolve('vendor/atlas');
rmSync(vendor, { recursive: true, force: true });
mkdirSync(path.join(vendor, 'api-types'), { recursive: true });
cpSync(path.join(atlas, 'api-report/atlas-vtt-api.d.ts'), path.join(vendor, 'api-types/atlas-vtt-api.d.ts'));
cpSync(path.join(atlas, 'dist-packages/shared'), path.join(vendor, 'shared'), { recursive: true });

const files = hashTree(vendor);
const report = readFileSync(path.join(vendor, 'api-types/atlas-vtt-api.d.ts'), 'utf8');
const apiVersion = report.match(/export declare const API_VERSION = "([^"]+)";/)?.[1] ?? fail('No API_VERSION in the report.');
const contractCases = [...new Set(contractCaseIds())].sort();
writeFileSync(path.join(vendor, 'SOURCE.json'), JSON.stringify({ repository: 'ByteMirror/atlas-vtt', branch: 'api/extension-api', commit: head, apiVersion, contractCases, files }, null, 2) + '\n');
console.log(`Vendored Atlas ${head.slice(0, 7)} (API ${apiVersion}): ${Object.keys(files).length} files, ${contractCases.length} contract cases.`);
