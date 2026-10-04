/** A player meets people in a joined session: the GM (from the checked table proof) and everyone with a person id. */
import type { PresencePlayer } from '../../protocol';
import type { SessionIdentity } from '../identity/JoinIdentity';
import type { PeopleBook } from './PeopleBook';
import { GM_PERSON_ID } from './peopleTypes';

export function recordSessionPeople(
  people: Pick<PeopleBook, 'seen'>, identity: SessionIdentity, players: readonly PresencePlayer[],
): void {
  people.seen(identity.tableId, GM_PERSON_ID, identity.gmName);
  for (const player of players) {
    if (player.personId && player.personId !== identity.personId) people.seen(identity.tableId, player.personId, player.name);
  }
}
