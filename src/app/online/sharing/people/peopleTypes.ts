/** The people list: who this Atlas knows from online sessions, by table and person id. */
import { isKeyId, isPersonId } from '../../protocol';
import { needsIds, parsePlaceholders, type Placeholder } from './placeholderTypes';

/** The GM's own person id at their table, in every player's list. */
export const GM_PERSON_ID = 'gm';

export interface Person {
  tableId: string;
  /** Given by the table's GM; `gm` for the GM. */
  personId: string;
  /** Unique in this list (case-insensitive). */
  name: string;
  /** Names before a rename, so a note that still says the old name reaches them. */
  formerNames: string[];
  /** The GM's list: the device ids admitted as this person. */
  devices: string[];
  /** Keys of people merged into this one; shares to those keys reach this person. */
  aliases: string[];
  lastSeen: number;
}

export interface PeopleData {
  version: 1;
  people: Person[];
  /**
   * Names of removed people. They are never given to anyone else: notes and part tags that name a removed
   * person must not start reaching whoever is called that next.
   */
  retiredNames?: string[];
  /** People added by name before meeting them; older files have none. */
  placeholders?: Placeholder[];
  /** Set when reading gave placeholders ids (an older file): never stored, it only asks for a save. */
  idsAdded?: boolean;
}

export const personKey = (tableId: string, personId: string): string => `${tableId}/${personId}`;
export const keyOf = (person: Pick<Person, 'tableId' | 'personId'>): string => personKey(person.tableId, person.personId);

const strings = (value: unknown, valid: (text: string) => boolean): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && valid(item)).slice(0, 64) : [];

function parsePerson(value: unknown): Person | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const { tableId, personId, name, lastSeen } = record;
  if (!isKeyId(tableId) || !isPersonId(personId) || typeof name !== 'string' || !name.trim() || name.length > 80) return null;
  return {
    tableId, personId, name,
    formerNames: strings(record.formerNames, (text) => text.length <= 80),
    devices: strings(record.devices, isKeyId),
    aliases: strings(record.aliases, (text) => text.length <= 120),
    lastSeen: typeof lastSeen === 'number' && Number.isFinite(lastSeen) ? lastSeen : 0,
  };
}

/** The stored list; entries of the wrong shape are dropped. */
export function parsePeopleData(value: unknown): PeopleData {
  const people = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).people : null;
  const retired = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).retiredNames : null;
  const placeholders = typeof value === 'object' && value !== null ? (value as Record<string, unknown>).placeholders : null;
  return {
    version: 1,
    people: Array.isArray(people) ? people.flatMap((entry) => parsePerson(entry) ?? []) : [],
    retiredNames: Array.isArray(retired) ? retired.filter((name): name is string => typeof name === 'string' && name.length <= 80).slice(0, 1000) : [],
    placeholders: parsePlaceholders(placeholders),
    idsAdded: needsIds(placeholders),
  };
}
