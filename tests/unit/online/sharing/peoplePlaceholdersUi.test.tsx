import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JsonDataFile } from '../../../../src/app/online/sharing/dataFile';
import { partPeopleFrom } from '../../../../src/app/online/sharing/parts/partPeople';
import { PartPeopleForm } from '../../../../src/app/online/sharing/parts/PartPeopleModal';
import { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import { parsePeopleData, personKey } from '../../../../src/app/online/sharing/people/peopleTypes';
import { PeopleList } from '../../../../src/app/online/sharing/people/ui/PeopleList';
import { ShareWithForm } from '../../../../src/app/online/sharing/ui/ShareWithForm';
import { OnlinePlayerList } from '../../../../src/app/online/gm-ui/OnlinePlayerList';
import type { PresentedSceneSummaries } from '../../../../src/app/online/ui/presentedSceneSummary';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { PATHS } from './sharingPathsFixture';

/** No scene is presented: the list names no characters. */
const NOTHING_PRESENTED = { tabId: null, name: null, characters: [] };
const NO_SCENE: PresentedSceneSummaries = { read: () => NOTHING_PRESENTED, subscribe: () => () => undefined };
import { testPeople, testPerson } from './sharingFixtures';

const T = 'T'.repeat(43);

async function setup(): Promise<PeopleBook> {
  const people = new PeopleBook(new JsonDataFile(createInMemoryApp().app.vault.adapter, PATHS.people, parsePeopleData));
  await people.ready();
  return people;
}

describe('People dialog: add people by name', () => {
  it('adds a name with Add or Enter, lists it as not met yet, and says why a taken name is refused', async () => {
    const people = await setup();
    people.admit(T, 'Ana', 'a'.repeat(43));
    render(<PeopleList people={people} ownTableId={T} confirmRemove={async () => true} />);
    const field = screen.getByLabelText('Name of the person to add') as HTMLInputElement;
    const add = screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(field, { target: { value: 'ana' } });
    fireEvent.click(add);
    expect(screen.getByRole('alert').textContent).toBe('Someone in your people list is already called ana.');
    expect(people.placeholders()).toEqual([]);
    fireEvent.change(field, { target: { value: 'Dave' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(people.placeholders().map((placeholder) => placeholder.name)).toEqual(['Dave']);
    expect(field.value).toBe('');
    const section = screen.getByRole('region', { name: 'Not met yet' });
    expect((within(section).getByLabelText('Name of Dave') as HTMLInputElement).value).toBe('Dave');
    expect(within(section).getAllByText('Not met yet').length).toBeGreaterThan(0);
  });

  it('shows the add field before anyone is known, and renames and removes a placeholder', async () => {
    const people = await setup();
    people.addPlaceholder('Dave');
    people.addPlaceholder('Eve');
    render(<PeopleList people={people} ownTableId={T} confirmRemove={async () => true} />);
    const input = screen.getByLabelText('Name of Dave') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Eve' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Someone in your people list is already called Eve.');
    fireEvent.change(input, { target: { value: 'David' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(people.placeholders().map((placeholder) => placeholder.name)).toEqual(['David', 'Eve']);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove David' })); });
    expect(people.placeholders().map((placeholder) => placeholder.name)).toEqual(['Eve']);
  });

  it('offers placeholders in a person’s Link to… and links them there, so the user decides', async () => {
    const people = await setup();
    people.addPlaceholder('Dave');
    const met = people.seen(T, 'dave1', 'Dave');
    expect(met.name).toBe('Dave (2)');
    render(<PeopleList people={people} ownTableId={T} confirmRemove={async () => true} />);
    fireEvent.change(screen.getByLabelText('Link Dave (2) to'), { target: { value: `placeholder:${people.placeholderByName('Dave')!.id}` } });
    expect(people.placeholders()).toEqual([]);
    expect(people.get(T, 'dave1')?.name).toBe('Dave');
    expect(people.byKey(personKey(T, 'dave1'))?.formerNames).toContain('Dave (2)');
  });
});

describe('pickers list people not met yet', () => {
  it('Share part: placeholders come after the session people, can be ticked, and are marked', () => {
    const ana = testPerson('ana', 'Ana');
    const book = testPeople([ana], [{ id: 'd'.repeat(22), name: 'Dave', formerNames: [] }, { id: 'o'.repeat(22), name: 'Odd, one', formerNames: [] }]);
    const inSession = partPeopleFrom({ session: { tableId: ana.tableId } as never, people: [{ personId: 'ana', name: 'Ana' }] }, book);
    expect(inSession.people.map((person) => person.name)).toEqual(['Ana', 'Dave', 'Odd, one']);
    expect(inSession.people[1]).toEqual({ name: 'Dave', notMet: true });
    expect(inSession.people[2]?.problem).toBeDefined();
    const noSession = partPeopleFrom({ session: null, people: [] }, book);
    expect(noSession.people.map((person) => person.name)).toEqual(['Ana', 'Dave', 'Odd, one']);
    const onApply = vi.fn();
    render(<PartPeopleForm choice={noSession} onApply={onApply} onCancel={() => undefined} />);
    expect(screen.getByText('Not met yet')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Dave'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith(['Dave']);
  });

  it('Share with…: placeholders are rows and preview choices, labelled not met yet', async () => {
    const preview = vi.fn(async () => 'as Dave');
    render(
      <ShareWithForm
        rows={[{ key: 'T/ana', name: 'Ana', known: true }, { key: `placeholder:${'d'.repeat(22)}`, name: 'Dave', known: true, placeholder: true }]}
        initial={{ everyone: false, people: [], except: [] }}
        map={null} preview={preview} warnings={[]} onSave={() => undefined} onCancel={() => undefined}
      />,
    );
    expect(screen.getByText('Not met yet')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Preview as'), { target: { value: `placeholder:${'d'.repeat(22)}` } });
    expect(preview).toHaveBeenCalledWith(`placeholder:${'d'.repeat(22)}`);
    expect(await screen.findByText('as Dave')).toBeTruthy();
  });
});

describe('join requests with a placeholder’s name', () => {
  it('Link to Dave links the new device to the placeholder', () => {
    const service = { allow: vi.fn(), deny: vi.fn(), kick: vi.fn(), link: vi.fn(), linkPlaceholder: vi.fn() };
    render(<OnlinePlayerList
      players={[{ playerId: 'p1', name: 'Dave', status: 'pending', client: 'obsidian' }]}
      requests={{ p1: { kind: 'new', sameName: { personId: null, name: 'Dave', placeholder: 'd'.repeat(22) } } }}
      control={null}
      service={service}
      summaries={NO_SCENE}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Link to Dave' }));
    expect(service.linkPlaceholder).toHaveBeenCalledWith('p1', 'd'.repeat(22));
    expect(service.link).not.toHaveBeenCalled();
  });
});
