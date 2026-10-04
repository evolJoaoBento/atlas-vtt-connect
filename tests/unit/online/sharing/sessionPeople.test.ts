import { describe, expect, it } from 'vitest';
import { JsonDataFile } from '../../../../src/app/online/sharing/dataFile';
import { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import { GM_PERSON_ID, parsePeopleData } from '../../../../src/app/online/sharing/people/peopleTypes';
import { recordSessionPeople } from '../../../../src/app/online/sharing/people/sessionPeople';
import { PATHS } from './sharingPathsFixture';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';

describe('recording the people of a joined session', () => {
  it('adds the GM and everyone with a person id, never me or web players', async () => {
    const people = new PeopleBook(new JsonDataFile(createInMemoryApp().app.vault.adapter, PATHS.people, parsePeopleData));
    await people.ready();
    const identity = { tableId: 'T'.repeat(43), personId: 'me', gmName: 'Morgan' };
    recordSessionPeople(people, identity, [
      { playerId: 'a', name: 'Me', connected: true, personId: 'me' },
      { playerId: 'b', name: 'Ben', connected: true, personId: 'ben' },
      { playerId: 'c', name: 'Web', connected: true },
    ]);
    expect(people.list().map((person) => [person.personId, person.name]).sort()).toEqual([['ben', 'Ben'], [GM_PERSON_ID, 'Morgan']]);
  });
});
