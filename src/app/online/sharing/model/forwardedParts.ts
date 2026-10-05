/**
 * Parts meant only for some people keep their protection when the note is shared on. A restricted part
 * (`only` or `except`) that a recipient may see is sent still tagged, as `%%[!only|@<tableId>/<personId>, …]%%`:
 * the sender's own person key first, then everyone else at the recipient's table the part lets in, never the
 * recipient. The receiver writes those keys as the names in its own people list before saving the note,
 * dropping any it cannot resolve or validate (fail closed), so the note it shares on reaches only them.
 * Private parts are never sent at all.
 */
import { isKeyId, isPersonId } from '../../protocol';
import { keyOf, type Person } from '../people/peopleTypes';
import { END_TAG, openTag, scanTags } from './privateTags';

/** At most this many people in one forwarded tag; the receiver reads no more than that either. */
export const MAX_FORWARD_NAMES = 64;
const KEY_PREFIX = '@';
const PRIVATE_TAG = openTag({ kind: 'private' });
/** Characters a name cannot hold inside a tag without changing what it says. */
const UNWRITABLE_NAME = /[,|[\]%\n\r]/;

/** Whether a name can stand in a tag as written. */
export function writableName(name: string): boolean {
  return name.trim() !== '' && name.trim() === name && !UNWRITABLE_NAME.test(name);
}

/** The tag a restricted part is sent with: `only` the given person keys, or private when none are left. */
export function forwardedOpenTag(keys: readonly string[]): string {
  const unique = [...new Set(keys)].slice(0, MAX_FORWARD_NAMES);
  return unique.length > 0 ? openTag({ kind: 'only', names: unique.map((key) => `${KEY_PREFIX}${key}`) }) : PRIVATE_TAG;
}

/**
 * The receiver's names for people of `tableId`: only its own people list, and only a name that reads back
 * as that same person there, since a re-share resolves names through that list (never a session's name).
 */
export function peopleListNames(
  people: { get(tableId: string, personId: string): Person | null; byName(name: string): Person | null }, tableId: string,
): (personId: string) => string | null {
  return (personId) => {
    const person = people.get(tableId, personId);
    const named = person ? people.byName(person.name) : null;
    return person && named && keyOf(named) === keyOf(person) ? person.name : null;
  };
}

/** The person id a forwarded name stands for, when it is a valid key at `tableId`. */
function personIdOf(name: string, tableId: string): string | null {
  if (!name.startsWith(KEY_PREFIX)) return null;
  const [table, personId, extra] = name.slice(KEY_PREFIX.length).split('/');
  return extra === undefined && table === tableId && isKeyId(table) && isPersonId(personId) ? personId : null;
}

/**
 * `text` as the receiver saves it: each forwarded tag names the people of `tableId` it holds by the names
 * `nameOf` gives (this Atlas's people list), and becomes private when none resolve. Anything else that
 * reached it as a tag also turns private, so nothing the receiver writes reaches more people than meant.
 */
export function localizeForwardedTags(text: string, tableId: string, nameOf: (personId: string) => string | null): string {
  let out = '';
  let at = 0;
  for (const tag of scanTags(text, 'inline-only')) {
    out += text.slice(at, tag.start);
    at = tag.end;
    if (tag.kind === 'end') {
      out += END_TAG;
      continue;
    }
    const names = tag.kind === 'open' && tag.rule.kind === 'only'
      ? tag.rule.names.slice(0, MAX_FORWARD_NAMES).map((name) => {
        const personId = personIdOf(name, tableId);
        const local = personId ? nameOf(personId) : null;
        return local && writableName(local) ? local : null;
      }).filter((name): name is string => name !== null)
      : [];
    const unique = [...new Map(names.map((name) => [name.toLowerCase(), name])).values()];
    out += unique.length > 0 ? openTag({ kind: 'only', names: unique }) : PRIVATE_TAG;
  }
  return out + text.slice(at);
}
