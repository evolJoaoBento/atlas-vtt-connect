/**
 * Someone added by name before ever meeting them. A placeholder has no table, person id or devices, so it
 * grants nothing: a tag or share that names it reaches nobody until the person is linked to it (a join the
 * GM links, or a person met in a session that the user links in the People dialog).
 */
import { randomId } from '../../ids';
import { nameKey } from './peopleNames';

export interface Placeholder {
  /** Stable and random, so a rename never changes what refers to this placeholder (map shares, link choices). */
  id: string;
  /** Unique across current and former names of the whole list (case-insensitive). */
  name: string;
  /** Names before a rename, so a note that still says the old name keeps pointing here. */
  formerNames: string[];
}

export const MAX_PLACEHOLDERS = 200;

const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const KEY_PREFIX = 'placeholder:';

/** The key a placeholder has in a map share's people; a person linked to it keeps it as an alias, so the share follows. */
export const placeholderKey = (id: string): string => `${KEY_PREFIX}${id}`;

/** The key older versions gave, by name: still read, never written. */
const legacyKey = (name: string): string => `${KEY_PREFIX}${nameKey(name)}`;

/** Every key a placeholder is known by: its id first, then (for older shares) its names now and before. */
export const placeholderKeys = (placeholder: Placeholder): string[] =>
  [...new Set([placeholderKey(placeholder.id), ...[placeholder.name, ...placeholder.formerNames].map(legacyKey)])];

/** The placeholder a key stands for: by id, or by name for keys older versions wrote. */
export const placeholderOfKey = (placeholders: readonly Placeholder[], key: string): Placeholder | null =>
  placeholders.find((placeholder) => placeholderKeys(placeholder).includes(key)) ?? null;

/** Whether the placeholder is called `name` now or was. */
export const isCalled = (placeholder: Placeholder, name: string): boolean =>
  [placeholder.name, ...placeholder.formerNames].some((own) => nameKey(own) === nameKey(name));

function parsePlaceholder(value: unknown): Placeholder | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, formerNames, id } = value as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim() || name.length > 80) return null;
  const former = Array.isArray(formerNames)
    ? formerNames.filter((item): item is string => typeof item === 'string' && item.trim() !== '' && item.length <= 80).slice(0, 64)
    : [];
  return { id: typeof id === 'string' && ID_PATTERN.test(id) ? id : randomId(), name, formerNames: former };
}

/** The stored placeholders; entries of the wrong shape are dropped, and a missing or damaged list is empty. An entry without an id (older files) gets one. */
export function parsePlaceholders(value: unknown): Placeholder[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Placeholder[] = [];
  for (const entry of value) {
    const placeholder = parsePlaceholder(entry);
    if (!placeholder || seen.has(nameKey(placeholder.name))) continue;
    if (seen.has(placeholder.id)) continue;
    seen.add(nameKey(placeholder.name));
    seen.add(placeholder.id);
    result.push(placeholder);
    if (result.length >= MAX_PLACEHOLDERS) break;
  }
  return result;
}

/** Whether a stored list has entries without an id, which `parsePlaceholders` gave one: the list is saved again so the ids hold. */
export function needsIds(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => typeof entry === 'object' && entry !== null && !ID_PATTERN.test(String((entry as Record<string, unknown>).id)));
}
