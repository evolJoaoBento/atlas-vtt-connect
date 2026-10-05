/**
 * What the `atlas-share` property says, as labels in the colours of the share tags, and in one line who it
 * reaches. Every entry is read by the filter's own parser (`parseShareRule`) and every name through the
 * people list, the way `audience.ruleReaches` reads them, so the labels never disagree with what is shared.
 */
import type { NameResolver } from '../model/audience';
import { parseShareRule } from '../model/shareRule';
import type { TagTone } from './tagDisplay';

/** `not-met`: a name added before meeting them. `unrecognised`: an entry Atlas cannot read, or a name it does not know. */
export type ShareEntryStatus = 'ok' | 'not-met' | 'unrecognised';

export interface ShareEntryLabel {
  tone: TagTone;
  text: string;
  status: ShareEntryStatus;
  /** Why it is not plain (shown under the property); null when it is. */
  reason: string | null;
}

/** One entry of the property: `entry` is its text when it is a string (a list pill shows that text). */
export interface ShareItemView {
  entry: string | null;
  labels: ShareEntryLabel[];
}

export interface SharePropertyView {
  items: ShareItemView[];
  /** "Shared with: everyone except Dave". */
  summary: string;
}

export const UNRECOGNISED_LABEL = 'Not recognised';
export const NOT_MET = 'not met yet';

const known = (name: string, people: NameResolver, every: boolean): boolean =>
  (every && people.allByName ? people.allByName(name).length : people.byName(name) ? 1 : 0) > 0;

function nameLabel(kind: 'only' | 'except', name: string, people: NameResolver): ShareEntryLabel {
  const text = `${kind === 'only' ? 'Only' : 'Except'} ${name}`;
  if (known(name, people, kind === 'except')) return { tone: kind, text, status: 'ok', reason: null };
  if (people.isPlaceholder?.(name)) {
    const reason = kind === 'only'
      ? `${name} is ${NOT_MET}: they get the note once you meet them.`
      : `${name} is ${NOT_MET}: the note is shared with nobody until you meet them.`;
    return { tone: kind, text: `${text} (${NOT_MET})`, status: 'not-met', reason };
  }
  const reason = kind === 'only' ? `Not in your people list: ${name}.` : `Not in your people list: ${name}, so the note is shared with nobody.`;
  return { tone: 'private', text, status: 'unrecognised', reason };
}

/** The labels of one entry of the property (a list item, or the whole value when it is not a list). */
export function shareItemLabels(item: unknown, people: NameResolver): ShareEntryLabel[] {
  const rule = parseShareRule(item);
  if (rule.unreadable) {
    return [{ tone: 'private', text: UNRECOGNISED_LABEL, status: 'unrecognised', reason: 'Atlas cannot read this entry, so the note is shared with nobody.' }];
  }
  return [
    ...(rule.private ? [{ tone: 'private' as const, text: 'Private', status: 'ok' as const, reason: null }] : []),
    ...(rule.public ? [{ tone: 'public' as const, text: 'Public', status: 'ok' as const, reason: null }] : []),
    ...rule.only.map((name) => nameLabel('only', name, people)),
    ...rule.except.map((name) => nameLabel('except', name, people)),
  ];
}

const listed = (names: readonly string[]): string => names.join(', ');

/** Who the whole value reaches, in the order `ruleReaches` decides it. */
export function shareSummary(value: unknown, people: NameResolver): string {
  const rule = parseShareRule(value);
  if (rule.unreadable) return 'Shared with: nobody, an entry could not be read';
  if (rule.private) return 'Shared with: nobody (private)';
  const blocking = rule.except.filter((name) => !known(name, people, true));
  if (blocking.length > 0) return `Shared with: nobody until ${listed(blocking)} ${blocking.length === 1 ? 'is' : 'are'} in your people list`;
  if (rule.public) return rule.except.length > 0 ? `Shared with: everyone except ${listed(rule.except)}` : 'Shared with: everyone in your sessions';
  const excepted = (name: string): boolean => rule.except.some((other) => other.toLowerCase() === name.toLowerCase());
  const reached = rule.only.filter((name) => known(name, people, false) && !excepted(name));
  if (reached.length > 0) return `Shared with: ${listed(reached)}`;
  return rule.except.length > 0 && rule.only.length === 0 ? 'Shared with: nobody (add public to share with everyone except them)' : 'Shared with: nobody';
}

/** The property's entries with their labels, and its summary. */
export function sharePropertyView(value: unknown, people: NameResolver): SharePropertyView {
  const items = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  return {
    items: items.map((item: unknown) => ({ entry: typeof item === 'string' ? item : null, labels: shareItemLabels(item, people) })),
    summary: shareSummary(value, people),
  };
}
