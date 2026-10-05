import { describe, expect, it } from 'vitest';
import { filterNoteFor } from '../../../../src/app/online/sharing/model/noteFilter';
import { shareWithEveryone, UNCLOSED_BEFORE_SELECTION, wrapSelection, type PartEdit } from '../../../../src/app/online/sharing/parts/partEdits';
import { TABLE_ID, testPeople, testPerson } from './sharingFixtures';
import { simpleSections } from './obsidianSections';

/** The text after the edit, and the text the selection covers then. */
function applied(text: string, edit: PartEdit | { refused: string } | null): { text: string; selected: string } {
  if (!edit || 'refused' in edit) return { text, selected: '' };
  const { change, selection } = edit;
  const next = text.slice(0, change.from) + change.text + text.slice(change.to);
  return { text: next, selected: next.slice(selection.from, selection.to) };
}

/** `[` and `]` in `marked` are the selection. */
function select(marked: string): { text: string; from: number; to: number } {
  const from = marked.indexOf('[');
  const to = marked.indexOf(']') - 1;
  return { text: marked.replace('[', '').replace(']', ''), from, to };
}

const wrap = (marked: string, rule: Parameters<typeof wrapSelection>[3] = { kind: 'private' }) => {
  const { text, from, to } = select(marked);
  return applied(text, wrapSelection(text, from, to, rule));
};
const unwrap = (text: string, selectedText: string, occurrence = 0) => {
  let from = -1;
  for (let index = 0; index <= occurrence; index++) from = text.indexOf(selectedText, from + 1);
  return applied(text, shareWithEveryone(text, from, from + selectedText.length));
};

const people = testPeople([testPerson('ana', 'Ana'), testPerson('ben', 'Ben'), testPerson('cara', 'Cara')]);
const forPerson = (personId: string, text: string): string => filterNoteFor(text, { sections: simpleSections(text), recipient: { tableId: TABLE_ID, personId }, people, shareable: [], links: () => null, marks: null });
const forBen = (text: string): string => filterNoteFor(text, { sections: simpleSections(text), recipient: { tableId: TABLE_ID, personId: 'ben' }, people, shareable: [], links: () => null, marks: null });

describe('wrapping a selection', () => {
  it('within one line: inline tags, the selection stays on the text', () => {
    expect(wrap('The door [is trapped] here.')).toEqual({ text: 'The door %%[!private]%%is trapped%%[!end]%% here.', selected: 'is trapped' });
  });

  it('whole lines: tags on their own lines, with the quote markers of the lines', () => {
    expect(wrap('a\n[b\nc]\nd')).toEqual({ text: 'a\n%%[!private]%%\nb\nc\n%%[!end]%%\nd', selected: 'b\nc' });
    expect(wrap('a\n[b\n]d')).toEqual({ text: 'a\n%%[!private]%%\nb\n%%[!end]%%\nd', selected: 'b' });
    expect(wrap('> a\n[> b]\n> c')).toEqual({ text: '> a\n> %%[!private]%%\n> b\n> %%[!end]%%\n> c', selected: '> b' });
  });

  it('cutting lines: inline tags at the ends', () => {
    expect(wrap('one t[wo\nthr]ee')).toEqual({ text: 'one t%%[!private]%%wo\nthr%%[!end]%%ee', selected: 'wo\nthr' });
  });

  it('only and except write the names as given', () => {
    expect(wrap('x [y] z', { kind: 'only', names: ['Ana', 'Ben'] }).text).toBe('x %%[!only|Ana, Ben]%%y%%[!end]%% z');
    expect(wrap('x [y] z', { kind: 'except', names: ['Cara'] }).text).toBe('x %%[!except|Cara]%%y%%[!end]%% z');
  });

  it('what it wraps is kept back', () => {
    expect(forBen(wrap('a [secret] b', { kind: 'only', names: ['Ana'] }).text)).toBe('a  b');
    expect(forBen(wrap('a\n[secret\n]b').text)).toBe('a\nb');
  });
});

describe('sharing a selection with everyone', () => {
  it('selecting exactly the wrapped text removes its tags', () => {
    expect(unwrap('a %%[!private]%%secret%%[!end]%% b', 'secret')).toEqual({ text: 'a secret b', selected: 'secret' });
    expect(unwrap('a\n%%[!private]%%\nb\nc\n%%[!end]%%\nd', 'b\nc')).toEqual({ text: 'a\nb\nc\nd', selected: 'b\nc' });
    expect(unwrap('> a\n> %%[!private]%%\n> b\n> %%[!end]%%\n> c', '> b')).toEqual({ text: '> a\n> b\n> c', selected: '> b' });
  });

  it('a selection inside a larger part frees only itself', () => {
    const text = 'x %%[!private]%%one two three%%[!end]%% y';
    const done = unwrap(text, 'two');
    expect(done.text).toBe('x %%[!private]%%one %%[!end]%%two%%[!private]%% three%%[!end]%% y');
    expect(done.selected).toBe('two');
    expect(forBen(done.text)).toBe('x two y');
  });

  it('whole lines inside a larger block part: the closing and opening tags go on lines of their own', () => {
    const text = '%%[!private]%%\none\ntwo\nthree\n%%[!end]%%';
    const done = unwrap(text, 'two\n');
    expect(done.text).toBe('%%[!private]%%\none\n%%[!end]%%\ntwo\n%%[!private]%%\nthree\n%%[!end]%%');
    expect(forBen(done.text)).toBe('two');
  });

  it('a part that begins inside the selection and ends after it stays closed after it', () => {
    const done = unwrap('a b %%[!private]%%c d%%[!end]%% e', 'b %%[!private]%%c');
    expect(done.text).toBe('a b c%%[!private]%% d%%[!end]%% e');
    expect(forBen(done.text)).toBe('a b c e');
  });

  it('nested parts are closed and opened again in order', () => {
    const text = '%%[!only|Ana]%%a %%[!private]%%b c%%[!end]%%%%[!end]%%';
    const done = unwrap(text, 'b');
    // The private tag right before the selection is taken in, so only the outer part closes before it.
    expect(done.text).toBe('%%[!only|Ana]%%a %%[!end]%%b%%[!only|Ana]%%%%[!private]%% c%%[!end]%%%%[!end]%%');
    expect(forBen(done.text)).toBe('b');
  });

  it('a malformed or unclosed part stays closed after the selection', () => {
    expect(forBen(unwrap('a %%[!secret]%%b c', 'b').text)).toBe('a b');
    expect(forBen(unwrap('a %%[!private]%%b c', 'b').text)).toBe('a b');
  });

  it('nothing to change: null', () => {
    expect(shareWithEveryone('plain text', 0, 5)).toBeNull();
  });
});

describe('wrapping a selection that crosses other parts (T-I1)', () => {
  it('a selection across an existing end keeps every selected character in the new part', () => {
    const text = 'Intro.\n\n%%[!only|Ana]%%\nFor Ana.\n%%[!end]%%\nSecret for nobody.';
    const from = text.indexOf('For Ana.');
    const done = applied(text, wrapSelection(text, from, text.length, { kind: 'private' }));
    for (const personId of ['ana', 'ben', 'cara']) {
      expect(forPerson(personId, done.text)).not.toContain('Secret for nobody');
      expect(forPerson(personId, done.text)).not.toContain('For Ana');
    }
    const inline = '%%[!except|Cara]%%visible%%[!end]%% GM ONLY';
    const wrapped = applied(inline, wrapSelection(inline, inline.indexOf('visible'), inline.length, { kind: 'private' }));
    for (const personId of ['ana', 'ben']) expect(forPerson(personId, wrapped.text)).toBe('');
  });

  it('a selection across an existing start, or holding a stray end, is wrapped stretch by stretch', () => {
    const text = 'one two %%[!only|Ana]%%three%%[!end]%%';
    const done = applied(text, wrapSelection(text, text.indexOf('two'), text.indexOf('three') + 5, { kind: 'only', names: ['Ben'] }));
    expect(done.text).toBe('one %%[!only|Ben]%%two %%[!end]%%%%[!only|Ana]%%%%[!only|Ben]%%three%%[!end]%%%%[!end]%%');
    const stray = 'a x %%[!end]%% y b';
    const wrappedStray = applied(stray, wrapSelection(stray, 2, stray.length - 2, { kind: 'private' }));
    expect(wrappedStray.text).toBe('a %%[!private]%%x %%[!end]%%%%[!end]%%%%[!private]%% y%%[!end]%% b');
  });

  it('a selection end inside a tag or a comment takes it in whole (M3)', () => {
    const text = 'a %%[!only|Ana]%%x%%[!end]%% b %% note %% c';
    const done = applied(text, wrapSelection(text, text.indexOf('only'), text.indexOf('note'), { kind: 'private' }));
    expect(done.text).toBe('a %%[!only|Ana]%%%%[!private]%%x%%[!end]%%%%[!end]%%%%[!private]%% b %% note %%%%[!end]%% c');
    const everyone = shareWithEveryone('a %%[!only|Ana]%%X%%[!only|Ana]%% Y%%[!end]%% b', 5, 16);
    expect(everyone).not.toBeNull();
  });

  it('fuzz: after any wrap, no one the new part keeps out gets any wholly selected word', () => {
    let seed = 12345;
    const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pieces = [' ', ' ', '\n', '\n\n', '%%[!private]%%', '%%[!only|Ana]%%', '%%[!except|Ben]%%', '%%[!end]%%', '%%[!end]%%', '%% c %%', '> ', '- '];
    const rules: Array<[Parameters<typeof wrapSelection>[3], string[]]> = [
      [{ kind: 'private' }, ['ana', 'ben', 'cara']],
      [{ kind: 'only', names: ['Ana'] }, ['ben', 'cara']],
      [{ kind: 'except', names: ['Ben'] }, ['ben']],
    ];
    for (let round = 0; round < 3000; round++) {
      let text = '';
      const words: Array<{ word: string; start: number }> = [];
      // Selections start and end between pieces, never inside a word, so no two cut words can join into a selected one.
      const bounds = [0];
      for (let index = 0; index < 4 + Math.floor(random() * 14); index++) {
        if (random() < 0.5) {
          const word = `w${round}x${index}`;
          words.push({ word, start: text.length });
          // A space after each word, so text on either side of a selection cannot run together into one.
          text += `${word} `;
        } else text += pieces[Math.floor(random() * pieces.length)];
        bounds.push(text.length);
      }
      const a = bounds[Math.floor(random() * bounds.length)]!;
      const b = bounds[Math.floor(random() * bounds.length)]!;
      const [from, to] = a <= b ? [a, b] : [b, a];
      if (from === to) continue;
      const [rule, kept] = rules[Math.floor(random() * rules.length)]!;
      const done = applied(text, wrapSelection(text, from, to, rule));
      const selected = words.filter((entry) => entry.start >= from && entry.start + entry.word.length <= to);
      for (const personId of kept) {
        const got = forPerson(personId, done.text);
        for (const { word } of selected) expect(got.split(/[^A-Za-z0-9]+/).includes(word), `${JSON.stringify(text)} [${from},${to}) ${rule.kind} → ${personId}`).toBe(false);
      }
    }
  });
});

describe('sharing with everyone after an unclosed part (M2)', () => {
  it('is refused, so text the part hides from everyone is not shared with the people it names', () => {
    expect(shareWithEveryone('a %%[!only|Ana]%%hidden b c', 'a %%[!only|Ana]%%hidden '.length, 'a %%[!only|Ana]%%hidden b'.length)).toEqual({ refused: UNCLOSED_BEFORE_SELECTION });
  });
});
