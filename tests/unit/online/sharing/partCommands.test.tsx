import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor, Plugin } from 'obsidian';
import { NOT_IN_PEOPLE_LIST, partPeopleFrom, UNWRITABLE_NAME_HINT } from '../../../../src/app/online/sharing/parts/partPeople';
import { PartPeopleForm } from '../../../../src/app/online/sharing/parts/PartPeopleModal';
import { TABLE_ID, testPeople, testPerson } from './sharingFixtures';
import { registerPartCommands } from '../../../../src/app/online/sharing/parts/registerPartCommands';
import type { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import { shareSessionStore } from '../../../../src/app/online/sharing/shareSessionStore';

type Pos = { line: number; ch: number };

/** An editor over a string: offsets and positions as Obsidian's, each transaction counted. */
function fakeEditor(initial: string, from: number, to: number) {
  let text = initial;
  let selection = { from, to };
  const toPos = (offset: number): Pos => {
    const before = text.slice(0, offset).split('\n');
    return { line: before.length - 1, ch: before[before.length - 1]!.length };
  };
  const toOffset = (pos: Pos): number => text.split('\n').slice(0, pos.line).reduce((sum, line) => sum + line.length + 1, 0) + pos.ch;
  const transactions: unknown[] = [];
  const editor = {
    getValue: () => text,
    somethingSelected: () => selection.from !== selection.to,
    getCursor: (which: 'from' | 'to') => toPos(which === 'from' ? selection.from : selection.to),
    posToOffset: toOffset,
    offsetToPos: toPos,
    transaction: (tx: { changes: Array<{ from: Pos; to: Pos; text: string }> }) => {
      transactions.push(tx);
      const edits = tx.changes.map((change) => ({ from: toOffset(change.from), to: toOffset(change.to), text: change.text })).sort((a, b) => b.from - a.from);
      for (const edit of edits) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to);
    },
    setSelection: (anchor: Pos, head: Pos) => { selection = { from: toOffset(anchor), to: toOffset(head) }; },
  };
  return { editor: editor as unknown as Editor, text: () => text, selected: () => text.slice(selection.from, selection.to), transactions };
}

function fakePlugin() {
  const commands = new Map<string, { name: string; editorCheckCallback: (checking: boolean, editor: Editor, info: unknown) => boolean }>();
  let menuHandler: ((menu: unknown, editor: Editor, info: unknown) => void) | null = null;
  const plugin = {
    app: { workspace: { on: (_name: string, handler: typeof menuHandler) => { menuHandler = handler; return {}; } } },
    addCommand: (command: { id: string; name: string; editorCheckCallback: never }) => { commands.set(command.id, command); },
    registerEvent: () => {},
  };
  return { plugin: plugin as unknown as Plugin, commands, menu: (editor: Editor, info: unknown) => {
    const titles: string[] = [];
    const clicks: Array<() => void> = [];
    const item = { setTitle: (title: string) => { titles.push(title); return item; }, setIcon: () => item, setSection: () => item, onClick: (fn: () => void) => { clicks.push(fn); return item; } };
    menuHandler?.({ addItem: (build: (i: typeof item) => void) => build(item) }, editor, info);
    return { titles, clicks };
  } };
}

const note = { file: { extension: 'md' } };
const people = { ready: async () => {}, list: () => [] } as unknown as PeopleBook;
afterEach(() => shareSessionStore.setState({ session: null, people: [], pushes: [] }));

describe('Share part commands and menu', () => {
  it('the menu offers the four items only with a selection in a Markdown note', () => {
    const { plugin, menu } = fakePlugin();
    registerPartCommands(plugin, people);
    expect(menu(fakeEditor('abc', 0, 2).editor, note).titles).toEqual(['Share part: Private', 'Share part: Only…', 'Share part: Except…', 'Share part: Everyone']);
    expect(menu(fakeEditor('abc', 1, 1).editor, note).titles).toEqual([]);
    expect(menu(fakeEditor('abc', 0, 2).editor, { file: { extension: 'canvas' } }).titles).toEqual([]);
  });

  it('Mark selection as private is one transaction and keeps the selection on the text', () => {
    const { plugin, commands } = fakePlugin();
    registerPartCommands(plugin, people);
    const command = commands.get('part-private')!;
    expect(command.name).toBe('Mark selection as private');
    const fake = fakeEditor('a secret b', 2, 8);
    expect(command.editorCheckCallback(true, fake.editor, note)).toBe(true);
    command.editorCheckCallback(false, fake.editor, note);
    expect(fake.text()).toBe('a %%[!private]%%secret%%[!end]%% b');
    expect(fake.selected()).toBe('secret');
    expect(fake.transactions).toHaveLength(1);
    expect(command.editorCheckCallback(true, fakeEditor('abc', 1, 1).editor, note)).toBe(false);
  });

  it('Share selection with everyone unwraps it, from the menu too', () => {
    const { plugin, menu } = fakePlugin();
    registerPartCommands(plugin, people);
    const fake = fakeEditor('a %%[!private]%%secret%%[!end]%% b', 16, 22);
    menu(fake.editor, note).clicks[3]!();
    expect(fake.text()).toBe('a secret b');
    expect(fake.selected()).toBe('secret');
  });

  it('the commands carry the brief’s names', () => {
    const { plugin, commands } = fakePlugin();
    registerPartCommands(plugin, people);
    expect([...commands.values()].map((command) => command.name)).toEqual([
      'Mark selection as private', 'Share selection only with…', 'Share selection with everyone except…', 'Share selection with everyone',
    ]);
  });
});

describe('the people picker', () => {
  it('lists the session’s people, keeps a name a tag cannot hold unpickable, and applies the ticked ones', () => {
    const apply = vi.fn();
    render(<PartPeopleForm choice={{ people: [{ name: 'Ana' }, { name: 'Ben' }, { name: 'Odd, name', problem: UNWRITABLE_NAME_HINT }], inSession: true }} onApply={apply} onCancel={() => {}} />);
    expect(screen.getByText('People in this session')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Odd, name') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Ben'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(apply).toHaveBeenCalledWith(['Ben']);
  });

  it('says when it shows the people list because there is no session', () => {
    render(<PartPeopleForm choice={{ people: [{ name: 'Ana' }], inSession: false }} onApply={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('Not in a session: your people list')).toBeTruthy();
  });
});

describe('the picker names people as the people list does, never by join name (T-I2)', () => {
  const session = { role: 'player' as const, tableId: TABLE_ID, self: 'ana', node: {} as never };

  it('another table’s "Ben": this table’s Ben is offered as "Ben (2)"', () => {
    const book = testPeople([testPerson('ben', 'Ben', 'O'.repeat(43)), testPerson('ben', 'Ben (2)'), testPerson('gm', 'Morgan')]);
    const choice = partPeopleFrom({ session, people: [{ personId: 'gm', name: 'Morgan' }, { personId: 'ben', name: 'Ben' }] }, book);
    expect(choice.people).toEqual([{ name: 'Morgan' }, { name: 'Ben (2)' }]);
  });

  it('a join name that is someone’s former name is not written; the list name is', () => {
    const ana = { ...testPerson('ana2', 'Ana'), formerNames: ['Bea'] };
    const book = testPeople([ana, testPerson('bea', 'Bea (2)')]);
    const choice = partPeopleFrom({ session, people: [{ personId: 'bea', name: 'Bea' }] }, book);
    expect(choice.people).toEqual([{ name: 'Bea (2)' }]);
  });

  it('someone the list does not hold yet is shown but cannot be picked', () => {
    const choice = partPeopleFrom({ session, people: [{ personId: 'new', name: 'Ben' }] }, testPeople([testPerson('ben', 'Ben', 'O'.repeat(43))]));
    expect(choice.people).toEqual([{ name: 'Ben', problem: NOT_IN_PEOPLE_LIST }]);
  });

  it('without a session: the people list', () => {
    const choice = partPeopleFrom({ session: null, people: [] }, testPeople([testPerson('ana', 'Ana'), testPerson('odd', 'Odd, name')]));
    expect(choice).toEqual({ people: [{ name: 'Ana' }, { name: 'Odd, name', problem: UNWRITABLE_NAME_HINT }], inSession: false });
  });
});
