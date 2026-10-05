// Compares Connect's test files with the online play preview's, per area, after Appendix B of the plan.
// Each area must satisfy connect = fork - moved + rewritten-as-new; it fails when connect < fork - moved.
// Seven of the moved files only moved their Atlas part (onlinePlayerDrag, onlineSceneStatus, onlineSceneRoll, onlineOwnRolls,
// onlineDiceUi, onlineSceneResources, onlineSceneInitiative) and Connect keeps the rest, so counting them as moved makes the
// floor lenient. Today every Connect-side part exists, so no gap is hidden.
// Usage: node scripts/test-inventory.mjs --atlas <Atlas checkout> [--ref merge/upstream-beta]
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, posix, relative, resolve, sep } from 'node:path';

const ROOT = 'tests/unit/online';
const DEFAULT_REF = 'merge/upstream-beta';

/** Fork test files that moved to Atlas (Appendix B), whole or only their Atlas part, relative to tests/unit/online. */
export const MOVED = [
  'darknessRaster.test.ts',
  'presentedCamera.test.ts',
  'fogCompositorCache.test.ts',
  'obsidian/remoteSceneApplier.test.ts',
  'obsidian/remoteMapBackdrop.test.ts',
  'obsidian/viewportFollower.test.ts',
  'obsidian/remoteStore.test.ts',
  'obsidian/onlineSceneView.test.ts',
  'obsidian/onlinePlayerDrag.test.ts',
  'obsidian/onlineSceneStatus.test.ts',
  'obsidian/onlineSceneRoll.test.tsx',
  'obsidian/onlineOwnRolls.test.tsx',
  'obsidian/onlineDiceUi.test.tsx',
  'obsidian/onlineSceneResources.test.ts',
  'obsidian/onlineSceneInitiative.test.ts',
  // Atlas's dice tray in the remote view (A31); C-remote-5 and remoteViews.test.tsx cover it, and Connect's sceneTabs and remoteSceneClient tests cover maxDice and the modifier.
  'obsidian/onlineDiceTrayWiring.test.tsx',
];

const isTest = (path) => /\.test\.tsx?$/.test(path);
/** The area of a file: its first folder under the root, or `(root)`. */
export const areaOf = (path) => (path.includes('/') ? path.split('/')[0] : '(root)');

function argValue(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

/** Every file under `dir`, as a forward-slash path relative to it. */
const walk = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(dir, join(entry.parentPath, entry.name)).replaceAll(sep, '/'));

function forkFiles(atlas, ref) {
  const out = execFileSync('git', ['-C', atlas, 'ls-tree', '-r', '--name-only', ref, '--', ROOT], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((line) => posix.relative(ROOT, line)).filter(isTest);
}

const countByArea = (files) => {
  const counts = new Map();
  for (const file of files) counts.set(areaOf(file), (counts.get(areaOf(file)) ?? 0) + 1);
  return counts;
};

/** One row per area; `ok` is false when Connect has fewer files than the fork's minus those that moved. */
export function inventory(fork, connect, moved = MOVED) {
  const forkCounts = countByArea(fork);
  const movedCounts = countByArea(fork.filter((file) => moved.includes(file)));
  const connectCounts = countByArea(connect);
  const areas = [...new Set([...forkCounts.keys(), ...connectCounts.keys()])].sort();
  return areas.map((area) => {
    const forkCount = forkCounts.get(area) ?? 0;
    const movedCount = movedCounts.get(area) ?? 0;
    const connectCount = connectCounts.get(area) ?? 0;
    return { area, fork: forkCount, moved: movedCount, connect: connectCount, rewritten: connectCount - (forkCount - movedCount), ok: connectCount >= forkCount - movedCount };
  });
}

function main(argv) {
  const atlas = argValue(argv, '--atlas');
  if (!atlas) {
    console.error('Usage: node scripts/test-inventory.mjs --atlas <Atlas checkout> [--ref <ref>]');
    return 2;
  }
  const fork = forkFiles(resolve(atlas), argValue(argv, '--ref') ?? DEFAULT_REF);
  const connect = walk(ROOT).filter(isTest);
  const rows = inventory(fork, connect);
  console.log('area        fork  moved  connect  rewritten-as-new');
  for (const row of rows) {
    console.log(`${row.area.padEnd(11)} ${String(row.fork).padStart(4)}  ${String(row.moved).padStart(5)}  ${String(row.connect).padStart(7)}  ${String(row.rewritten).padStart(16)}  ${row.ok ? 'OK' : 'SHORT'}`);
  }
  const absent = fork.filter((file) => !connect.includes(file));
  console.log('\nMoved to Atlas (Appendix B):');
  for (const file of MOVED.filter((name) => fork.includes(name))) console.log(`  ${file}`);
  console.log('\nFork files with no same-named Connect file that are not marked moved (renamed or rewritten, check by hand):');
  for (const file of absent.filter((name) => !MOVED.includes(name))) console.log(`  ${file}`);
  return rows.every((row) => row.ok) ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) process.exit(main(process.argv.slice(2)));
