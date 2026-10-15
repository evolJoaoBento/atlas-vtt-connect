import type { SessionPlayer } from '../GmSession';
import type { JoinIdentity } from '../sharing/people/IdentityDesk';
import { showConfirmNotice, type NoticeAnswer } from './confirmNotice';
import { KNOWN_PERSON_MARK, NEW_PERSON_MARK, linkToLabel, otherClientWarning, sameNameWarning } from './onlineCopy';

/** Who a waiting player is, and the Link answer when a new device uses a known name. */
export interface JoinRequestInfo {
  identity: JoinIdentity | null;
  link: (() => void) | null;
}

/** The request's warnings: a name taken in the session by another client, and a new device using a known person's name. */
function joinWarning(player: SessionPlayer, sameName: { name: string; personId: string | null } | null): string | null {
  const other = player.sameNameAs ? otherClientWarning(player.name, player.sameNameAs === 'connected') : null;
  const person = sameName ? sameNameWarning(sameName.name, sameName.personId === null) : null;
  if (other && person) return `${other} ${person}.`;
  return other ?? person;
}

/**
 * "Anna wants to join your online session. (new)", with Allow, Link to Anna and Deny, until
 * answered or hidden. Names are text, never HTML.
 */
export function showJoinRequestNotice(player: SessionPlayer, answer: (allow: boolean) => void, info?: JoinRequestInfo): { hide(): void } {
  const identity = info?.identity ?? null;
  const sameName = identity?.kind === 'new' ? identity.sameName : null;
  const link = info?.link ?? null;
  const answers: NoticeAnswer[] = [
    { label: 'Allow', cta: true, run: () => answer(true) },
    ...(sameName && link ? [{ label: linkToLabel(sameName.name), run: link }] : []),
    { label: 'Deny', run: () => answer(false) },
  ];
  return showConfirmNotice({
    text: (line) => {
      line.appendText(`${player.name} wants to join your online session.`);
      if (identity) line.createSpan({ cls: 'atlas-connect-request__mark', text: ` ${identity.kind === 'known' ? KNOWN_PERSON_MARK : NEW_PERSON_MARK}` });
    },
    warning: joinWarning(player, sameName),
    answers,
  });
}
