/**
 * The `atlas-share` line of a note's frontmatter in Source mode: each entry gets the colour of its label,
 * read by the same function as the properties panel (`shareItemLabels`, which uses the filter's parser).
 * Entries are found as YAML writes them: a scalar after the key, a flow list `[public, except Dave]` or a block
 * list of `- entry` lines; `{except: Dave}` and `- except: Dave` read as the parser reads `except: Dave`.
 */
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import type { NameResolver } from '../model/audience';
import { SHARE_PROPERTY } from '../model/shareRule';
import { shareItemLabels, type ShareEntryLabel } from './shareProperty';
import { refreshShareTags } from './tagDecorations';

/** An entry of the property in the text: `[from, to)` and the value the parser reads. */
export interface YamlEntry {
  from: number;
  to: number;
  value: string;
}

/** Frontmatter longer than this is not looked at (the end marker is searched for in it only). */
const FRONTMATTER_LIMIT = 20_000;
const KEY = new RegExp(`^["']?${SHARE_PROPERTY}["']?[ \\t]*:[ \\t]*(.*)$`);

/** A YAML scalar as the parser should read it: quotes and flow-mapping braces off. */
function scalar(raw: string): string {
  const text = raw.trim();
  if (/^(['"]).*\1$/.test(text)) return text.slice(1, -1);
  return /^\{.*\}$/.test(text) ? text.slice(1, -1).trim() : text;
}

/** The pieces of a flow list's inside, split at commas outside quotes and braces. */
function flowPieces(inside: string, offset: number): YamlEntry[] {
  const out: YamlEntry[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  const push = (end: number): void => {
    const raw = inside.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    if (raw.trim()) out.push({ from: offset + start + lead, to: offset + start + raw.trimEnd().length, value: scalar(raw) });
  };
  for (let at = 0; at < inside.length; at++) {
    const char = inside[at] ?? '';
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '{') depth++;
    else if (char === '}') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) { push(at); start = at + 1; }
  }
  push(inside.length);
  return out;
}

/** The entries of the `atlas-share` property in `text`'s frontmatter, in order. */
export function shareYamlEntries(text: string): YamlEntry[] {
  const head = text.slice(0, FRONTMATTER_LIMIT);
  const first = /^---\r?\n/.exec(head);
  if (!first) return [];
  const end = head.slice(first[0].length).search(/^---[ \t]*\r?$/m);
  if (end < 0) return [];
  const lines = head.slice(0, first[0].length + end).split('\n');
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = (lines[index] ?? '').replace(/\r$/, '');
    const key = index > 0 ? KEY.exec(line) : null;
    if (!key) { offset += (lines[index] ?? '').length + 1; continue; }
    const rest = (key[1] ?? '').replace(/[ \t]+#.*$/, '');
    const restAt = offset + line.length - (key[1] ?? '').length;
    if (rest.trim().startsWith('[')) {
      const open = rest.indexOf('[');
      const close = rest.lastIndexOf(']');
      return flowPieces(rest.slice(open + 1, close > open ? close : rest.length), restAt + open + 1);
    }
    if (rest.trim()) return [{ from: restAt + (rest.length - rest.trimStart().length), to: restAt + rest.trimEnd().length, value: scalar(rest) }];
    const out: YamlEntry[] = [];
    let at = offset + (lines[index] ?? '').length + 1;
    for (const next of lines.slice(index + 1)) {
      const item = /^([ \t]*-[ \t]+)(.*?)\r?$/.exec(next);
      if (item) {
        const raw = item[2] ?? '';
        if (raw.trim()) out.push({ from: at + (item[1] ?? '').length, to: at + (item[1] ?? '').length + raw.trimEnd().length, value: scalar(raw) });
      } else if (!/^[ \t]/.test(next) && next.trim() !== '') break;
      at += next.length + 1;
    }
    return out;
  }
  return [];
}

/** The class of an entry with these labels: its first label's colour, or the unrecognised look. */
export function yamlEntryClass(labels: readonly ShareEntryLabel[]): string | null {
  const first = labels[0];
  if (!first) return null;
  const worst = labels.find((label) => label.status === 'unrecognised') ?? labels.find((label) => label.status === 'not-met');
  if (worst?.status === 'unrecognised') return 'atlas-share-yaml atlas-share-yaml--private atlas-share-unrecognised';
  return `atlas-share-yaml atlas-share-yaml--${first.tone}${worst ? ' atlas-share-not-met' : ''}`;
}

function decorationsOf(state: EditorState, people: NameResolver): DecorationSet {
  const ranges: Array<Range<Decoration>> = [];
  for (const entry of shareYamlEntries(state.doc.sliceString(0, FRONTMATTER_LIMIT))) {
    const cls = yamlEntryClass(shareItemLabels(entry.value, people));
    if (cls && entry.to > entry.from) ranges.push(Decoration.mark({ class: cls }).range(entry.from, entry.to));
  }
  return Decoration.set(ranges, true);
}

/** The editor extension; `refreshShareTags` (people changed) recolours it. */
export function shareYamlExtension(people: NameResolver): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => decorationsOf(state, people),
    update(value, tr) {
      if (tr.effects.some((effect) => effect.is(refreshShareTags))) return decorationsOf(tr.state, people);
      // Only an edit that reaches into the frontmatter can change it.
      let touched = false;
      tr.changes.iterChangedRanges((from) => { if (from < FRONTMATTER_LIMIT) touched = true; });
      return touched ? decorationsOf(tr.state, people) : value.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
