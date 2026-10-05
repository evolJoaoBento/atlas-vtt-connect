/** What Share with… tells the sender about a note's part tags: warnings, and the error that stops it being shared. */
import { strayEndProblem } from '../model/noteFilter';
import type { PartProblems } from '../model/privateParts';
import { END_TAG } from '../model/privateTags';

const MAX_UNREADABLE_WARNINGS = 3;
export const OLD_CALLOUTS_WARNING = 'This note still uses the old > [!private] callouts; they are kept back. Use Mark as private on the selection instead.';
export const TAG_IN_CODE_WARNING = 'A share tag inside code or a link is not used; the rest of the note is kept back.';
export const UNCLOSED_COMMENT_WARNING = 'A %% comment is never closed before the next tag (a %% in code counts too), so everything after it is hidden from everyone.';

export function partWarnings(problems: PartProblems): string[] {
  const { strayText } = problems;
  return [
    ...(problems.tagInCodeOrLink ? [TAG_IN_CODE_WARNING] : []),
    ...(strayText?.oldCallout ? [OLD_CALLOUTS_WARNING] : []),
    ...(strayText && !strayText.oldCallout
      ? [`"${strayText.text}" reads like a part tag but is not one, so everything from there on is hidden from everyone. Use Share part on the selection to mark parts.`]
      : []),
    ...[...new Set(problems.malformed)].slice(0, MAX_UNREADABLE_WARNINGS)
      .map((start) => `Could not read the private part tag "${start}". What it marks is hidden from everyone.`),
    ...(problems.unclosed ? [`A private part tag is never closed with ${END_TAG}, so everything after it is hidden from everyone.`] : []),
    ...(problems.unclosedComment ? [UNCLOSED_COMMENT_WARNING] : []),
  ];
}

/** The reason the note is not shared at all, or null. */
export function partError(problems: PartProblems): string | null {
  const line = problems.strayEndLines[0];
  return line === undefined ? null : strayEndProblem(line);
}
