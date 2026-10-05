// Argument handling of sync-atlas.mjs: git mode (--atlas) or exported-tree mode (--source).
const SHA = /^[0-9a-f]{7,40}$/;
const USAGE = 'Usage: node scripts/sync-atlas.mjs --atlas <Atlas checkout> --commit <sha> [--repository <owner/name>] [--branch <name>]\n'
  + '   or: node scripts/sync-atlas.mjs --source <built Atlas tree> --commit <sha> [--repository <owner/name>] [--branch <name>]';
/** Where Connect's vendored Atlas is published (README, THIRD_PARTY_NOTICES); recorded unless named otherwise. */
export const DEFAULT_REPOSITORY = 'evolJoaoBento/atlas-vtt';
export const DEFAULT_BRANCH = 'api/extension-api';
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH = /^[A-Za-z0-9_./-]+$/;

/** `{ mode: 'git' | 'source', dir, commit, repository, branch }`, or `{ error }` with the usage text. */
export function parseSyncArgs(argv) {
  const args = Object.fromEntries(argv.reduce((pairs, arg, i, all) => (arg.startsWith('--') ? [...pairs, [arg.slice(2), all[i + 1]]] : pairs), []));
  const commit = args.commit ?? '';
  const repository = args.repository ?? DEFAULT_REPOSITORY;
  const branch = args.branch ?? DEFAULT_BRANCH;
  if (!SHA.test(commit) || (args.atlas && args.source) || !(args.atlas || args.source)) return { error: USAGE };
  if (!REPOSITORY.test(repository) || !BRANCH.test(branch)) return { error: USAGE };
  return { ...(args.source ? { mode: 'source', dir: args.source } : { mode: 'git', dir: args.atlas }), commit, repository, branch };
}
