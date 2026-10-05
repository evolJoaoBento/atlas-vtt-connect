import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OnlinePlayerList } from '../../../../src/app/online/gm-ui/OnlinePlayerList';
import type { PresentedSceneSummaries } from '../../../../src/app/online/ui/presentedSceneSummary';
import { JsonDataFile } from '../../../../src/app/online/sharing/dataFile';
import { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import { parsePeopleData, personKey } from '../../../../src/app/online/sharing/people/peopleTypes';
import { PeopleList } from '../../../../src/app/online/sharing/people/ui/PeopleList';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { PATHS } from './sharingPathsFixture';

/** No scene is presented: the list names no characters. */
const NOTHING_PRESENTED = { tabId: null, name: null, characters: [] };
const NO_SCENE: PresentedSceneSummaries = { read: () => NOTHING_PRESENTED, subscribe: () => () => undefined };

const T = 'T'.repeat(43);

describe('waiting players with identities', () => {
  it('shows known and new, the warning, and Link to Ana', () => {
    const service = { allow: vi.fn(), deny: vi.fn(), kick: vi.fn(), link: vi.fn(), linkPlaceholder: vi.fn() };
    render(<OnlinePlayerList
      players={[
        { playerId: 'p1', name: 'Ana', status: 'pending', client: 'obsidian' },
        { playerId: 'p2', name: 'Ben', status: 'pending', client: 'obsidian' },
      ]}
      requests={{ p1: { kind: 'new', sameName: { personId: 'ana_1', name: 'Ana' } }, p2: { kind: 'known', personId: 'ben_1', name: 'Ben' } }}
      control={null}
      service={service}
      summaries={NO_SCENE}
    />);
    expect(screen.getByText('(new)')).toBeTruthy();
    expect(screen.getByText('(known)')).toBeTruthy();
    expect(screen.getByText('Someone named Ana is already in your people list')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Link to Ana' }));
    expect(service.link).toHaveBeenCalledWith('p1', 'ana_1');
    expect(screen.getAllByRole('button', { name: 'Link to Ana' })).toHaveLength(1);
  });
});

describe('People list', () => {
  it('renames on Enter, shows a refused name, links and removes', async () => {
    const people = new PeopleBook(new JsonDataFile(createInMemoryApp().app.vault.adapter, PATHS.people, parsePeopleData));
    await people.ready();
    const ana = people.admit(T, 'Ana', 'a'.repeat(43));
    const ben = people.admit(T, 'Ben', 'b'.repeat(43));
    render(<PeopleList people={people} ownTableId={T} confirmRemove={async () => true} />);
    const input = screen.getByLabelText('Name of Ana') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Ben' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('Someone in your people list is already called Ben.');
    fireEvent.change(input, { target: { value: 'Anna' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(people.get(T, ana.personId)?.name).toBe('Anna');
    fireEvent.change(screen.getByLabelText('Link Ben to'), { target: { value: personKey(T, ana.personId) } });
    expect(people.list()).toHaveLength(1);
    expect(people.byKey(personKey(T, ben.personId))?.personId).toBe(ana.personId);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Remove Anna' })); });
    expect(people.list()).toEqual([]);
    expect(screen.getByText('Nobody yet. People are added when you let them into your session or join someone else’s.')).toBeTruthy();
  });
});
