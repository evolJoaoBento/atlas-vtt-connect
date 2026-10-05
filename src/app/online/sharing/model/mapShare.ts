/**
 * A map's share, kept on its scene record as Connect's data there (`scenes.setData`, Atlas's
 * `data.extensions['atlas-vtt-connect']`, where Atlas also moved the fork's `data.sharing`), so it moves with
 * the scene and the map file stays as it is. Atlas drops it from copies, exports and installs. People by key,
 * so renames keep it; `notes` are the linked notes the sender ticked.
 */
import type { ScenesApi } from '@atlas-vtt/api-types';
import type { PeopleBook } from '../people/PeopleBook';
import { personKey } from '../people/peopleTypes';
import { isPerson, type Recipient } from './audience';

export type MapShareMode = 'player-safe' | 'full';

export type MapShare = {
  /** The map's random item id. */
  item: string;
  everyone: boolean;
  people: string[];
  except: string[];
  mode: MapShareMode;
  /** Vault paths of the ticked linked notes. */
  notes: string[];
};

const keys = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 500 && value.every((key) => typeof key === 'string' && key.length <= 300);

export function parseMapShare(value: unknown): MapShare | null {
  if (typeof value !== 'object' || value === null) return null;
  const share = value as Record<string, unknown>;
  if (typeof share.item !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(share.item)) return null;
  if (typeof share.everyone !== 'boolean' || (share.mode !== 'player-safe' && share.mode !== 'full')) return null;
  if (!keys(share.people) || !keys(share.except) || !keys(share.notes)) return null;
  return { item: share.item, everyone: share.everyone, people: [...share.people], except: [...share.except], mode: share.mode, notes: [...share.notes] };
}

/** The share kept on a scene (`scenes.getData`); null when there is none or it is not well formed. */
export async function mapShareOf(scenes: Pick<ScenesApi, 'getData'>, sceneId: string): Promise<MapShare | null> {
  return parseMapShare(await scenes.getData(sceneId));
}

function keyReaches(key: string, recipient: Recipient, people: Pick<PeopleBook, 'byKey'>): boolean {
  const person = people.byKey(key);
  return person ? isPerson(person, recipient) : key === personKey(recipient.tableId, recipient.personId);
}

/**
 * Who a map share reaches. An `except` naming a placeholder that is not linked yet (`unlinkedKey`) reaches nobody, like a
 * name nobody can resolve: whoever turns up as "Dave (2)" must not get what was kept back from Dave.
 */
export function mapShareReaches(share: MapShare, recipient: Recipient, people: Pick<PeopleBook, 'byKey'> & Partial<Pick<PeopleBook, 'unlinkedKey'>>): boolean {
  if (share.except.some((key) => people.unlinkedKey?.(key))) return false;
  if (share.except.some((key) => keyReaches(key, recipient, people))) return false;
  return share.everyone || share.people.some((key) => keyReaches(key, recipient, people));
}

/** Writes or clears the share on the scene record. Atlas re-reads the record and changes only Connect's data on it. */
export async function writeMapShare(scenes: Pick<ScenesApi, 'setData'>, sceneId: string, share: MapShare | null): Promise<void> {
  await scenes.setData(sceneId, share);
}
