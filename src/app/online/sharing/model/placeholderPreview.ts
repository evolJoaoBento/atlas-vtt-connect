/**
 * "Preview as" someone not met yet: what they would get once linked. A stand-in person with the placeholder's
 * names, at a table that is nobody's, lives only inside one preview; it is never stored and never in the
 * people list, so it reaches nothing a real recipient could.
 */
import type { PeopleBook } from '../people/PeopleBook';
import { isCalled } from '../people/placeholderTypes';
import { keyOf, type Person } from '../people/peopleTypes';
import type { NameResolver, Recipient } from './audience';

const PREVIEW_TABLE = 'preview';
const PREVIEW_PERSON = 'placeholder';

export type PreviewPeople = Pick<PeopleBook, 'byName' | 'allByName' | 'byKey' | 'get' | 'list' | 'isPlaceholder'> & NameResolver;

export interface PlaceholderPreview {
  recipient: Recipient;
  people: PreviewPeople;
}

/** The stand-in for the placeholder called `name`; null when there is none. */
export function previewAsPlaceholder(
  people: Pick<PeopleBook, 'byName' | 'allByName' | 'byKey' | 'get' | 'list' | 'isPlaceholder' | 'placeholderByName'>, name: string,
): PlaceholderPreview | null {
  const placeholder = people.placeholderByName(name);
  if (!placeholder) return null;
  const stand: Person = { tableId: PREVIEW_TABLE, personId: PREVIEW_PERSON, name: placeholder.name, formerNames: placeholder.formerNames, devices: [], aliases: [], lastSeen: 0 };
  const isStand = (other: string): boolean => isCalled(placeholder, other);
  return {
    recipient: { tableId: stand.tableId, personId: stand.personId },
    people: {
      byName: (other) => (isStand(other) ? stand : people.byName(other)),
      allByName: (other) => (isStand(other) ? [stand] : people.allByName(other)),
      byKey: (key) => (key === keyOf(stand) ? stand : people.byKey(key)),
      get: (tableId, personId) => people.get(tableId, personId),
      list: () => people.list(),
      isPlaceholder: (other) => !isStand(other) && people.isPlaceholder(other),
    },
  };
}
