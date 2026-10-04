/**
 * The people list of this Atlas, kept in `people.json` in Atlas's sharing data. People are
 * added when the GM admits them or when a player meets them in a session; their device and
 * person ids, never their names, decide who they are. Names stay unique in the list.
 */
import type { App } from 'obsidian';
import { randomId } from '../../ids';
import { normalizePlayerName } from '../../protocol';
import { JsonDataFile } from '../dataFile';
import type { SharingPaths } from '../sharingPaths';
import { holdsName, NAME_PROBLEM, nameKey, nameTakenMessage, uniqueName } from './peopleNames';
import { isCalled, MAX_PLACEHOLDERS, placeholderKey, placeholderKeys, placeholderOfKey, type Placeholder } from './placeholderTypes';
import { peopleByName, personByName } from './peopleLookup';
import { keyOf, parsePeopleData, type PeopleData, type Person } from './peopleTypes';

/** A change of only `lastSeen` is saved this long after the last one; any other change is saved at once. */
const LAST_SEEN_SAVE_DELAY_MS = 10_000;
/** Meeting someone again within this time leaves their last-seen time alone. */
const LAST_SEEN_RESOLUTION_MS = 60_000;

export class PeopleBook {
  private static readonly instances = new WeakMap<App, Map<string, PeopleBook>>();
  /** The one book for this app and file: every part of Connect that reads the people sees the same list. */
  static forApp(app: App, paths: SharingPaths): PeopleBook {
    const books = this.instances.get(app) ?? new Map<string, PeopleBook>();
    this.instances.set(app, books);
    let book = books.get(paths.people);
    if (!book) {
      book = new PeopleBook(new JsonDataFile(app.vault.adapter, paths.people, parsePeopleData));
      books.set(paths.people, book);
    }
    return book;
  }

  private people: Person[] = [];
  private retiredNames: string[] = [];
  private placeholderList: Placeholder[] = [];
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private saveTimer: number | null = null;
  /** The stored list has been read: nothing is written before, or the stored list would be replaced by an empty one. */
  private loaded = false;

  constructor(private readonly file: JsonDataFile<PeopleData>, private readonly now: () => number = Date.now) {}

  /** Reads the stored list once; every other method expects it read. */
  ready(): Promise<void> {
    this.loading ??= this.file.load().then((data) => {
      this.people = data.people;
      this.retiredNames = data.retiredNames ?? [];
      this.placeholderList = data.placeholders ?? [];
      this.loaded = true;
      if (data.idsAdded) this.save();
      this.listeners.forEach((listener) => listener());
    });
    return this.loading;
  }

  list(): readonly Person[] { return this.people; }

  get(tableId: string, personId: string): Person | null {
    return this.byKey(`${tableId}/${personId}`);
  }

  /** The person with this key, or the one it was merged into. */
  byKey(key: string): Person | null {
    return this.people.find((person) => keyOf(person) === key) ?? this.people.find((person) => person.aliases.includes(key)) ?? null;
  }

  byDevice(tableId: string, deviceId: string): Person | null {
    return this.people.find((person) => person.tableId === tableId && person.devices.includes(deviceId)) ?? null;
  }

  /** The person called `name` now, else the one who was called that most recently; optionally at one table. */
  byName(name: string, tableId?: string): Person | null {
    return personByName(this.people, name, tableId);
  }

  /** Everyone a name matches, now or formerly (names are unique, so older data is the only way to get more than one). */
  allByName(name: string, tableId?: string): Person[] {
    return peopleByName(this.people, name, tableId);
  }

  /** The GM admits a new device as a new person. */
  admit(tableId: string, name: string, deviceId: string): Person {
    const person: Person = {
      tableId, personId: randomId(), name: this.freeName(name), formerNames: [], devices: [deviceId], aliases: [], lastSeen: this.now(),
    };
    this.people = [...this.people, person];
    this.changed(true);
    return person;
  }

  /** The GM links a new device to a known person; null when there is no such person. */
  linkDevice(tableId: string, personId: string, deviceId: string): Person | null {
    const person = this.get(tableId, personId);
    if (!person) return null;
    return this.replace(person, { devices: person.devices.includes(deviceId) ? person.devices : [...person.devices, deviceId], lastSeen: this.now() });
  }

  /** Someone met in a session: added under a free name if new, otherwise only their last-seen time changes. */
  seen(tableId: string, personId: string, name: string): Person {
    const known = this.get(tableId, personId);
    if (known) return this.now() - known.lastSeen < LAST_SEEN_RESOLUTION_MS ? known : this.replace(known, { lastSeen: this.now() });
    const person: Person = { tableId, personId, name: this.freeName(name), formerNames: [], devices: [], aliases: [], lastSeen: this.now() };
    this.people = [...this.people, person];
    this.changed(true);
    return person;
  }

  /** Renames; the old name stays a former name. Returns what is wrong with the name, or null. */
  rename(key: string, name: string): string | null {
    const person = this.byKey(key);
    const cleaned = normalizePlayerName(name);
    if (!person) return null;
    if (!cleaned) return NAME_PROBLEM;
    if (nameKey(cleaned) === nameKey(person.name)) {
      this.replace(person, { name: cleaned });
      return null;
    }
    if (this.nameTaken(nameKey(cleaned), person)) {
      return nameTakenMessage(cleaned);
    }
    this.replace(person, { name: cleaned, formerNames: [...person.formerNames.filter((former) => nameKey(former) !== nameKey(cleaned)), person.name] });
    return null;
  }

  /** Merges `fromKey` into `intoKey`: one person on two devices or at two tables. */
  merge(fromKey: string, intoKey: string): string | null {
    const from = this.byKey(fromKey);
    const into = this.byKey(intoKey);
    if (!from || !into || from === into) return 'Pick another person.';
    const people = this.people.filter((person) => person !== from);
    const merged: Person = {
      ...into,
      devices: [...new Set([...into.devices, ...from.devices])],
      formerNames: [...new Set([...into.formerNames, from.name, ...from.formerNames])],
      aliases: [...new Set([...into.aliases, keyOf(from), ...from.aliases])],
      lastSeen: Math.max(into.lastSeen, from.lastSeen),
    };
    this.people = people.map((person) => (person === into ? merged : person));
    this.changed(true);
    return null;
  }

  /** People added by name, not met yet. The same array until something changes. */
  placeholders(): readonly Placeholder[] { return this.placeholderList; }

  /** The placeholder called `name` now or before. */
  placeholderByName(name: string): Placeholder | null {
    return this.placeholderList.find((placeholder) => isCalled(placeholder, name)) ?? null;
  }

  isPlaceholder(name: string): boolean { return this.placeholderByName(name) !== null; }

  /**
   * What a stored person key (a map share's) stands for now: the key of the person it was merged or linked into, the
   * key of the placeholder it names (by id, or by name for older shares), or null when it resolves to nobody.
   */
  currentKey(key: string): string | null {
    const person = this.byKey(key);
    if (person) return keyOf(person);
    const placeholder = placeholderOfKey(this.placeholderList, key);
    return placeholder ? placeholderKey(placeholder.id) : null;
  }

  /** Whether a stored key names a placeholder that is not linked to anyone yet. */
  unlinkedKey(key: string): boolean {
    return !this.byKey(key) && placeholderOfKey(this.placeholderList, key) !== null;
  }

  /** Adds someone not met yet. Returns what is wrong with the name (it is never renamed silently), or null. */
  addPlaceholder(name: string): string | null {
    const cleaned = normalizePlayerName(name);
    if (!cleaned) return NAME_PROBLEM;
    if (this.nameTaken(nameKey(cleaned))) return nameTakenMessage(cleaned);
    if (this.placeholderList.length >= MAX_PLACEHOLDERS) return `You can add up to ${MAX_PLACEHOLDERS} people by name.`;
    this.placeholderList = [...this.placeholderList, { id: randomId(), name: cleaned, formerNames: [] }];
    this.changed(true);
    return null;
  }

  /** Renames a placeholder (found by its current name); the old name stays a former name. Returns what is wrong, or null. */
  renamePlaceholder(name: string, newName: string): string | null {
    const placeholder = this.placeholderNamed(name);
    const cleaned = normalizePlayerName(newName);
    if (!placeholder) return null;
    if (!cleaned) return NAME_PROBLEM;
    const same = nameKey(cleaned) === nameKey(placeholder.name);
    if (!same && this.nameTaken(nameKey(cleaned), undefined, placeholder)) return nameTakenMessage(cleaned);
    const formerNames = same ? placeholder.formerNames : [...placeholder.formerNames.filter((former) => nameKey(former) !== nameKey(cleaned)), placeholder.name];
    this.placeholderList = this.placeholderList.map((other) => (other === placeholder ? { ...placeholder, name: cleaned, formerNames } : other));
    this.changed(true);
    return null;
  }

  /** Removes a placeholder; its names stay taken. */
  removePlaceholder(name: string): void {
    const placeholder = this.placeholderNamed(name);
    if (!placeholder) return;
    this.placeholderList = this.placeholderList.filter((other) => other !== placeholder);
    this.retiredNames = [...new Set([...this.retiredNames, placeholder.name, ...placeholder.formerNames])];
    this.changed(true);
  }

  /** The GM admits a new device as the person a placeholder stands for; null when the placeholder is gone. */
  admitAsPlaceholder(tableId: string, placeholderId: string, deviceId: string): Person | null {
    const placeholder = this.placeholderById(placeholderId);
    if (!placeholder) return null;
    const person: Person = {
      tableId, personId: randomId(), name: placeholder.name, formerNames: placeholder.formerNames, devices: [deviceId],
      aliases: placeholderKeys(placeholder), lastSeen: this.now(),
    };
    this.placeholderList = this.placeholderList.filter((other) => other !== placeholder);
    this.people = [...this.people, person];
    this.changed(true);
    return person;
  }

  /**
   * Links a person met in a session to a placeholder: the person takes the placeholder's name, and every name
   * either had stays a former name, so notes naming any of them reach the person. Returns what is wrong, or null.
   */
  linkPlaceholder(key: string, placeholderId: string): string | null {
    const person = this.byKey(key);
    const placeholder = this.placeholderById(placeholderId);
    if (!person || !placeholder) return 'Pick another person.';
    const formerNames = [...new Set([...placeholder.formerNames, person.name, ...person.formerNames])].filter((name) => nameKey(name) !== nameKey(placeholder.name));
    const linked: Person = { ...person, name: placeholder.name, formerNames, aliases: [...new Set([...person.aliases, ...placeholderKeys(placeholder)])] };
    this.people = this.people.map((other) => (other === person ? linked : other));
    this.placeholderList = this.placeholderList.filter((other) => other !== placeholder);
    this.changed(true);
    return null;
  }

  /** Removes a person; their names stay taken (`PeopleData.retiredNames`). */
  remove(key: string): void {
    const person = this.byKey(key);
    if (!person) return;
    this.people = this.people.filter((other) => other !== person);
    this.retiredNames = [...new Set([...this.retiredNames, person.name, ...person.formerNames])];
    this.changed(true);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** A current or former name of anyone (but `except`), or a removed person's: such a name is never given to someone else. */
  private nameTaken(key: string, except?: Person, exceptPlaceholder?: Placeholder): boolean {
    return holdsName(this.retiredNames, key)
      || this.placeholderList.some((other) => other !== exceptPlaceholder && holdsName([other.name, ...other.formerNames], key))
      || this.people.some((other) => other !== except && holdsName([other.name, ...other.formerNames], key));
  }

  private placeholderById(id: string): Placeholder | null {
    return this.placeholderList.find((other) => other.id === id) ?? null;
  }

  /** The placeholder whose current name is `name`. */
  private placeholderNamed(name: string): Placeholder | null {
    return this.placeholderList.find((other) => nameKey(other.name) === nameKey(name)) ?? null;
  }

  private freeName(name: string): string {
    const cleaned = normalizePlayerName(name) ?? 'Someone';
    return uniqueName(cleaned, (key) => this.nameTaken(key));
  }

  /** Applies `changes`; the file is written at once only when something other than `lastSeen` differs. */
  private replace(person: Person, changes: Partial<Person>): Person {
    const updated = { ...person, ...changes };
    const stored = (value: Person): string => JSON.stringify({ ...value, lastSeen: 0 });
    this.people = this.people.map((other) => (other === person ? updated : other));
    this.changed(stored(updated) !== stored(person));
    return updated;
  }

  private changed(persist: boolean): void {
    if (persist) this.save();
    else if (this.loaded) this.saveTimer ??= window.setTimeout(() => this.save(), LAST_SEEN_SAVE_DELAY_MS);
    this.listeners.forEach((listener) => listener());
  }

  /** Writes a waiting last-seen change now (on unload). Writes nothing when none is waiting or the list was never read. */
  flush(): void {
    if (this.saveTimer !== null) this.save();
  }

  private save(): void {
    if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.loaded) void this.file.save({ version: 1, people: this.people, retiredNames: this.retiredNames, placeholders: this.placeholderList });
  }
}
