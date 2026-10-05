/**
 * Who Share part: Only… / Except… offers, and by which names. A tag's names are resolved through this Atlas's
 * people list, so they are always taken from it by person key, never from a session's join names: a name
 * someone joined with can belong to someone else in the list (another table's "Ben" while this one is
 * "Ben (2)", or a former name).
 */
import { peopleListNames, writableName } from '../model/forwardedParts';
import type { PeopleBook } from '../people/PeopleBook';
import type { ShareSessionState } from '../shareSessionStore';

export interface PartPerson {
  name: string;
  /** Why they cannot be picked; absent when they can. */
  problem?: string;
  /** Added by name, not met yet: a tag naming them reaches nobody until they are linked. */
  notMet?: true;
}

export interface PartPeopleChoice {
  people: PartPerson[];
  /** Whether they are the people in the session (else the people list). */
  inSession: boolean;
}

export const NOT_IN_PEOPLE_LIST = 'Not in your people list yet, so a tag cannot name them. Try again in a moment.';
export const UNWRITABLE_NAME_HINT = 'This name has a character a tag cannot hold (, | [ ] %). Rename them in People… to pick them.';

function entry(name: string | null, shownAs: string): PartPerson {
  if (name === null) return { name: shownAs, problem: NOT_IN_PEOPLE_LIST };
  return writableName(name) ? { name } : { name, problem: UNWRITABLE_NAME_HINT };
}

/** The people in the session, named as the people list names them; the people list when there is no session. People added by name, not met yet, come last. */
export function partPeopleFrom(
  state: Pick<ShareSessionState, 'session' | 'people'>, people: Pick<PeopleBook, 'get' | 'byName' | 'list' | 'placeholders'>,
): PartPeopleChoice {
  const { session } = state;
  const notMet = people.placeholders().map((placeholder): PartPerson => ({ ...entry(placeholder.name, placeholder.name), notMet: true }));
  if (session) {
    const names = peopleListNames(people, session.tableId);
    return { people: [...state.people.map((person) => entry(names(person.personId), person.name)), ...notMet], inSession: true };
  }
  return {
    people: [...people.list().map((person) => entry(peopleListNames(people, person.tableId)(person.personId), person.name)), ...notMet],
    inSession: false,
  };
}
