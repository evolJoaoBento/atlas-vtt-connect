/**
 * The `atlas-share` property: who a note is shared with. `public` is everyone in a session
 * with me, `private` (and no property) nobody, names only those people, `except Name`
 * everyone but them. `private` wins over everything and `except` over a name. Commas separate
 * names in a text value too. The property itself is never sent.
 */
import type { NameResolver } from './audience';

export const SHARE_PROPERTY = 'atlas-share';

export interface ShareRule {
  /** Set only by an explicit `private`. */
  private: boolean;
  public: boolean;
  only: string[];
  except: string[];
  /** Set when an entry could not be read (the rule is then private) so the dialog can say so. */
  unreadable?: boolean;
}

/** What the Share with… dialog chose: names for notes, person keys for maps. */
export interface ShareChoice {
  everyone: boolean;
  people: string[];
  except: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const split = (text: string): string[] => text.split(',').map((entry) => entry.trim()).filter(Boolean);

/**
 * The entries of a value, as the text they would be written as. YAML reads `[public, except Cara]`
 * as two strings but `[public, except: Cara]` as a string and a mapping, so `{except: X}` and
 * `{only: X}` (X a string or a list of strings) are read too. Anything else that is not a string
 * is `bad`: the rule then fails closed.
 */
function entriesOf(value: unknown): { entries: string[]; bad: boolean } {
  if (value === undefined || value === null) return { entries: [], bad: false };
  const items = Array.isArray(value) ? value : [value];
  const entries: string[] = [];
  let bad = false;
  for (const item of items) {
    if (typeof item === 'string') {
      for (const entry of split(item)) {
        // `except:Cara` (no space) is one string to YAML, not a mapping: read it like `except Cara`. Any other `word:` is unreadable.
        const labelled = /^([^\s:]+):\s*(.*)$/.exec(entry);
        if (!labelled) entries.push(entry);
        else if (/^(?:except|only)$/i.test(labelled[1] ?? '') && labelled[2]) entries.push(`${(labelled[1] ?? '').toLowerCase()} ${labelled[2]}`);
        else bad = true;
      }
      continue;
    }
    const keys = isRecord(item) ? Object.keys(item) : [];
    const key = keys.length === 1 ? (keys[0] ?? '').toLowerCase() : '';
    const names = isRecord(item) ? item[keys[0] ?? ''] : null;
    const list = typeof names === 'string' ? [names] : Array.isArray(names) ? names : [null];
    if ((key !== 'except' && key !== 'only') || !list.every((name): name is string => typeof name === 'string')) {
      bad = true;
      continue;
    }
    entries.push(...list.flatMap(split).map((name) => `${key} ${name}`));
  }
  return { entries, bad };
}

export function parseShareRule(value: unknown): ShareRule {
  const rule: ShareRule = { private: false, public: false, only: [], except: [] };
  const { entries, bad } = entriesOf(value);
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (lower === 'private') rule.private = true;
    else if (lower === 'public') rule.public = true;
    else if (/^except\s+/i.test(entry)) rule.except.push(entry.replace(/^except\s+/i, '').trim());
    else rule.only.push(entry.replace(/^only\s+/i, '').trim());
  }
  // An entry nobody can read is never taken to mean less than it says: the note shares with nobody.
  return bad ? { ...rule, private: true, unreadable: true } : rule;
}

/** The property value for a choice; null removes the property (nobody). */
export function formatShareRule(choice: ShareChoice): string | string[] | null {
  if (choice.everyone) return choice.except.length ? ['public', ...choice.except.map((name) => `except ${name}`)] : 'public';
  return choice.people.length ? [...choice.people] : null;
}

/** Names in the rule that are not in the people list, sorted. */
export function unknownRuleNames(rule: ShareRule, people: NameResolver): string[] {
  return [...new Set([...rule.only, ...rule.except].filter((name) => !people.byName(name) && !people.isPlaceholder?.(name)))].sort();
}
