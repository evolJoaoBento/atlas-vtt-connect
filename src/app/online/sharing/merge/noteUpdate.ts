/**
 * The update policy for a note changed on both sides, used only inside a pull: the note's
 * remembered choice, or the receiver's answer. Keep both, keep mine, take theirs, resolve
 * conflicts (the merge page), or auto merge (one-sided changes and the note's conflict
 * default, shown on the merge page unless the note is set to silent).
 */
import type { NoteUpdatePolicy, UpdateContext, UpdateResult } from '../receive/notePull';
import type { ConflictDefault, PulledItems, UpdateChoice } from '../receive/PulledItems';
import { toLf, usesCrlf, withEnding } from '../receive/lineEndings';
import { partsSurvive } from '../model/privateTags';
import { diff3Checked, type MergeChunk } from './diff3';
import { mergedText } from './mergeResult';

export interface AskResult {
  choice: UpdateChoice;
  remember: boolean;
  silent: boolean;
}

export interface MergeRequest {
  context: UpdateContext;
  chunks: MergeChunk[];
  /** An auto merge's result to start from; null for Resolve conflicts. */
  preview: string | null;
  conflictDefault: ConflictDefault;
}

export interface MergeAnswer {
  text: string;
  conflictDefault: ConflictDefault;
}

export interface UpdatePolicyDeps {
  pulled: Pick<PulledItems, 'update'>;
  /** Null when the receiver closes the dialog: nothing changes. */
  ask(context: UpdateContext): Promise<AskResult | null>;
  /** The merge page; null when it is closed without saving. */
  merge(request: MergeRequest): Promise<MergeAnswer | null>;
  /** Tells the receiver something about a merge they saved (lost part tags). */
  warn?(message: string): void;
}

export const TAGS_LOST_WARNING = 'The merged note lost part of a part tag (%%[!only|…]%% or %%[!end]%%), so text meant for fewer people may be shared on. Check the tags in the note.';

export function createUpdatePolicy(deps: UpdatePolicyDeps): NoteUpdatePolicy {
  /** The result for a choice. Merges run on LF text and are written back in the receiver's line ending. */
  async function decide(context: UpdateContext, choice: UpdateChoice, silent: boolean): Promise<UpdateResult> {
    if (choice === 'both') return { kind: 'both' };
    if (choice === 'mine') return { kind: 'keep' };
    if (choice === 'theirs') return { kind: 'write', text: withEnding(context.theirs, usesCrlf(context.mine)) };
    const { record } = context;
    const crlf = usesCrlf(context.mine);
    const conflictDefault = record.conflictDefault ?? 'both';
    const { chunks, aligned } = diff3Checked(toLf(context.base), toLf(context.mine), toLf(context.theirs));
    const automatic = mergedText(chunks, [], conflictDefault);
    // Only a real merge is saved unseen: with no base, or when the diff gave up, the receiver sees the merge page.
    // A merge that breaks the part tags theirs came with is never saved unseen either.
    const tagsKept = partsSurvive(toLf(context.theirs), automatic);
    if (choice === 'auto' && silent && aligned && !context.baseMissing && tagsKept) return { kind: 'write', text: withEnding(automatic, crlf) };
    const answer = await deps.merge({ context, chunks, preview: choice === 'auto' ? automatic : null, conflictDefault });
    if (!answer) return { kind: 'cancel' };
    if (answer.conflictDefault !== conflictDefault) deps.pulled.update(record.key, { conflictDefault: answer.conflictDefault });
    if (!partsSurvive(toLf(context.theirs), toLf(answer.text))) deps.warn?.(TAGS_LOST_WARNING);
    return { kind: 'write', text: withEnding(answer.text, crlf) };
  }

  return {
    async resolve(context: UpdateContext): Promise<UpdateResult> {
      const { record } = context;
      if (record.choice) return decide(context, record.choice, record.silent === true);
      const answer = await deps.ask(context);
      if (!answer) return { kind: 'cancel' };
      const result = await decide(context, answer.choice, answer.silent);
      // "Remember for this note" is kept only once the receiver confirmed, not when they cancelled the merge page.
      if (answer.remember && result.kind !== 'cancel') {
        deps.pulled.update(record.key, { choice: answer.choice, ...(answer.silent ? { silent: true } : {}) });
      }
      return result;
    },
  };
}
