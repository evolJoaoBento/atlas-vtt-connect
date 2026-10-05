import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { Decoration } from '@codemirror/view';
import { revealedAt, tagDisplayOf, UNREADABLE_TAG_LABEL } from '../../../../../src/app/online/sharing/display/tagDisplay';
import { LARGE_NOTE, mappedDisplay, shareTagDecorations } from '../../../../../src/app/online/sharing/display/tagDecorations';

const at = (text: string, part: string, from = 0): number => text.indexOf(part, from);

describe('tagDisplayOf: labels, highlights and hidden end tags', () => {
  it('inline: a label over the start tag, the covered text highlighted, the end tag hidden', () => {
    const text = 'A %%[!only|Ana, Ben]%%for two%%[!end]%% B';
    const display = tagDisplayOf(text, 'inline-only');
    expect(display.labels).toEqual([{ from: 2, to: at(text, 'for'), tone: 'only', text: 'Only Ana, Ben' }]);
    expect(display.highlights).toEqual([{ from: at(text, 'for'), to: at(text, '%%[!end'), tone: 'only', depth: 0 }]);
    expect(display.hidden).toEqual([{ from: at(text, '%%[!end'), to: text.lastIndexOf(' B') }]);
  });

  it('labels each kind in sentence case with its own tone', () => {
    const text = '%%[!private]%%a%%[!end]%%%%[!public]%%b%%[!end]%%%%[! EXCEPT | Cara ]%%c%%[!end]%%';
    expect(tagDisplayOf(text, 'inline-only').labels.map(({ tone, text: label }) => [tone, label]))
      .toEqual([['private', 'Private'], ['public', 'Public'], ['except', 'Except Cara']]);
  });

  it('block: tags on their own lines cover the lines between', () => {
    const text = 'Top\n%%[!private]%%\nSecret line\n%%[!end]%%\nAfter';
    const display = tagDisplayOf(text, 'inline-only');
    expect(display.highlights[0]).toMatchObject({ from: at(text, '\nSecret'), to: at(text, '%%[!end') });
    expect(display.hidden).toHaveLength(1);
  });

  it('nested: the inner part is one deeper, the end closes the innermost', () => {
    const text = '%%[!only|Ana]%%a %%[!except|Ben]%%b%%[!end]%% c%%[!end]%%';
    const { highlights } = tagDisplayOf(text, 'inline-only');
    expect(highlights.map((h) => [h.tone, h.depth, text.slice(h.from, h.to)]))
      .toEqual([['only', 0, 'a %%[!except|Ben]%%b%%[!end]%% c'], ['except', 1, 'b']]);
  });

  it('unterminated: highlights to the end of the text', () => {
    const text = 'x %%[!private]%%rest of note';
    expect(tagDisplayOf(text, 'inline-only').highlights[0]).toMatchObject({ to: text.length, tone: 'private' });
  });

  it('a stray end is hidden and highlights nothing', () => {
    const display = tagDisplayOf('a %%[!end]%% b', 'inline-only');
    expect(display).toEqual({ labels: [], highlights: [], hidden: [{ from: 2, to: 12 }] });
  });

  it('malformed: an "Unreadable tag" label in the private colour, highlighting to its end', () => {
    const text = '%%[!secret]%%x%%[!end]%%';
    const display = tagDisplayOf(text, 'inline-only');
    expect(display.labels[0]).toMatchObject({ tone: 'private', text: UNREADABLE_TAG_LABEL });
    expect(display.highlights[0]).toMatchObject({ tone: 'private' });
    expect(display.hidden).toHaveLength(1);
  });

  it('a tag token in code is not a tag: nothing is shown for it', () => {
    expect(tagDisplayOf('`%%[!private]%%` x', 'inline-only')).toEqual({ labels: [], highlights: [], hidden: [] });
  });

  it('cursor or selection on a tag shows it as written; highlights stay', () => {
    const text = 'A %%[!private]%%x%%[!end]%% B';
    const display = tagDisplayOf(text, 'inline-only');
    const onStart = revealedAt(display, [{ from: 5, to: 5 }]);
    expect(onStart.labels).toEqual([]);
    expect(onStart.hidden).toHaveLength(1);
    expect(onStart.highlights).toEqual(display.highlights);
    const rightAfterEnd = revealedAt(display, [{ from: at(text, ' B'), to: at(text, ' B') }]);
    expect(rightAfterEnd.hidden).toEqual([]);
    expect(rightAfterEnd.labels).toHaveLength(1);
    expect(revealedAt(display, [{ from: text.length, to: text.length }])).toEqual(display);
  });
});

/** The decorations of `doc` with the cursor at `cursor`, as [from, to, kind] triples. */
function decorationsOf(doc: string, cursor: number): Array<[number, number, string]> {
  const state = EditorState.create({ doc, selection: EditorSelection.cursor(cursor) });
  const set = shareTagDecorations(state, tagDisplayOf(doc, 'inline-only'));
  const out: Array<[number, number, string]> = [];
  set.between(0, doc.length, (from, to, value: Decoration) => {
    const spec = value.spec as { widget?: unknown; class?: string };
    out.push([from, to, spec.class ?? (spec.widget ? 'label' : 'hidden')]);
  });
  return out;
}

describe('editor decorations', () => {
  it('replace the start tag with a label, mark the covered text, hide the end tag', () => {
    const doc = 'A %%[!only|Ana]%%x%%[!end]%% B';
    expect(decorationsOf(doc, doc.length)).toEqual([
      [2, 17, 'label'],
      [17, 18, 'atlas-share-tag-hl atlas-share-tag-hl--only'],
      [18, 28, 'hidden'],
    ]);
  });

  it('a line holding only an end tag folds away with the line break before it, unless the cursor is on it', () => {
    const doc = '%%[!private]%%\nSecret\n%%[!end]%%\n- After';
    const endLine = at(doc, '%%[!end');
    // The next line keeps its start, where Obsidian puts list, quote and heading styling.
    expect(decorationsOf(doc, doc.length)).toContainEqual([endLine - 1, endLine + 10, 'hidden']);
    expect(decorationsOf(doc, endLine + 3).some(([, , kind]) => kind === 'hidden')).toBe(false);
    expect(decorationsOf('%%[!end]%%\nNext', 15)).toContainEqual([0, 11, 'hidden']);
  });

  it('in a long note, the ranges follow an edit until the note is scanned again', () => {
    const doc = `${'x'.repeat(LARGE_NOTE)}\nA %%[!private]%%secret%%[!end]%% B`;
    const state = EditorState.create({ doc });
    const edit = state.update({ changes: { from: 0, insert: 'typed ' } });
    expect(mappedDisplay(tagDisplayOf(doc, 'inline-only'), edit.changes)).toEqual(tagDisplayOf(edit.state.doc.toString(), 'inline-only'));
  });

  it('the cursor inside a start tag shows it raw', () => {
    const doc = 'A %%[!only|Ana]%%x%%[!end]%% B';
    expect(decorationsOf(doc, 6).map(([, , kind]) => kind)).not.toContain('label');
  });

  it('nested highlights get the nested class', () => {
    const doc = '%%[!only|Ana]%%a %%[!private]%%b%%[!end]%%%%[!end]%%';
    expect(decorationsOf(doc, doc.length).map(([, , kind]) => kind)).toContain('atlas-share-tag-hl atlas-share-tag-hl--private atlas-share-tag-hl--nested');
  });
});
