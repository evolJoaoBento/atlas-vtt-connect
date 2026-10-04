// node scripts/sync-atlas.mjs --atlas <atlas dir> --commit <sha>
// Builds Atlas's extension packages at exactly <sha> and copies them into vendor/atlas (decision D1).
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashTree } from './vendorHash.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
const atlas = path.resolve(args.atlas ?? '');
const commit = args.commit ?? '';
const git = (...a) => execFileSync('git', ['-C', atlas, ...a], { encoding: 'utf8' }).trim();
const fail = (message) => { console.error(message); process.exit(1); };

if (!existsSync(path.join(atlas, 'package.json')) || !/^[0-9a-f]{7,40}$/.test(commit)) fail('Usage: --atlas <Atlas dir> --commit <sha>');
const head = git('rev-parse', 'HEAD');
if (!head.startsWith(commit)) fail(`Atlas is at ${head}, not ${commit}. Check out that commit first.`);
if (git('status', '--porcelain', '--untracked-files=no')) fail('Atlas has uncommitted changes to tracked files.');

// Only build:packages: never `build` or `dev`, whose hooks copy into a vault.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:packages'], { cwd: atlas, stdio: 'inherit', shell: process.platform === 'win32' });
if (git('status', '--porcelain', '--untracked-files=no')) fail('build:packages changed tracked files in Atlas (api-report out of date?).');

const vendor = path.resolve('vendor/atlas');
rmSync(vendor, { recursive: true, force: true });
mkdirSync(path.join(vendor, 'api-types'), { recursive: true });
cpSync(path.join(atlas, 'api-report/atlas-vtt-api.d.ts'), path.join(vendor, 'api-types/atlas-vtt-api.d.ts'));
cpSync(path.join(atlas, 'dist-packages/shared'), path.join(vendor, 'shared'), { recursive: true });

const files = hashTree(vendor);
const report = readFileSync(path.join(vendor, 'api-types/atlas-vtt-api.d.ts'), 'utf8');
const apiVersion = report.match(/export declare const API_VERSION = "([^"]+)";/)?.[1] ?? fail('No API_VERSION in the report.');
const contractCases = [...new Set(git('grep', '-ohE', 'C-[a-z]+-[0-9]+', head, '--', 'tests/api').split('\n').map((line) => line.replace(/^.*?:/, '')).filter(Boolean))].sort();
writeFileSync(path.join(vendor, 'SOURCE.json'), JSON.stringify({ repository: 'ByteMirror/atlas-vtt', branch: 'api/extension-api', commit: head, apiVersion, contractCases, files }, null, 2) + '\n');
console.log(`Vendored Atlas ${head.slice(0, 7)} (API ${apiVersion}): ${Object.keys(files).length} files, ${contractCases.length} contract cases.`);
