/** Finding people in the list by name, current or former (split out of `PeopleBook`). */
import { holdsName, nameKey } from './peopleNames';
import type { Person } from './peopleTypes';

/** The person called `name` now, else the one who was called that most recently; optionally at one table. */
export function personByName(people: readonly Person[], name: string, tableId?: string): Person | null {
  const key = nameKey(name);
  const candidates = tableId ? people.filter((person) => person.tableId === tableId) : people;
  return candidates.find((person) => nameKey(person.name) === key)
    ?? [...candidates].sort((a, b) => b.lastSeen - a.lastSeen).find((person) => holdsName(person.formerNames, key))
    ?? null;
}

/** Everyone a name matches, now or formerly. */
export function peopleByName(people: readonly Person[], name: string, tableId?: string): Person[] {
  const key = nameKey(name);
  return people.filter((person) => (!tableId || person.tableId === tableId) && holdsName([person.name, ...person.formerNames], key));
}
