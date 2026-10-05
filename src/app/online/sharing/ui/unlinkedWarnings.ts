import type { PeopleBook } from '../people/PeopleBook';
import { placeholderOfKey } from '../people/placeholderTypes';

/** "Dave isn’t linked yet; this part is kept back from everyone until you link Dave." (`what`: part, map). */
export const unlinkedExceptWarning = (name: string, what = 'part'): string => `${name} isn’t linked yet; this ${what} is kept back from everyone until you link ${name}.`;

/** One warning per placeholder (not linked yet) a map share's `except` names: the map reaches nobody until they are linked. */
export function unlinkedMapWarnings(except: readonly string[], people: Pick<PeopleBook, 'unlinkedKey' | 'placeholders'>): string[] {
  const names = except.filter((key) => people.unlinkedKey(key)).map((key) => placeholderOfKey(people.placeholders(), key)?.name);
  return [...new Set(names.filter((name): name is string => name !== undefined))].map((name) => unlinkedExceptWarning(name, 'map'));
}
