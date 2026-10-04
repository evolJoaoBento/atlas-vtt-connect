// Argument handling of sync-atlas.mjs: git mode (--atlas) or exported-tree mode (--source).
const SHA = /^[0-9a-f]{7,40}$/;
const USAGE = 'Usage: node scripts/sync-atlas.mjs --atlas <Atlas checkout> --commit <sha>\n   or: node scripts/sync-atlas.mjs --source <built Atlas tree> --commit <sha>';

/** `{ mode: 'git' | 'source', dir, commit }`, or `{ error }` with the usage text. */
export function parseSyncArgs(argv) {
  const args = Object.fromEntries(argv.reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
  const commit = args.commit ?? '';
  if (!SHA.test(commit) || (args.atlas && args.source) || !(args.atlas || args.source)) return { error: USAGE };
  return args.source ? { mode: 'source', dir: args.source, commit } : { mode: 'git', dir: args.atlas, commit };
}
