import { describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '../../../../src/app/online/GmSession';
import { JsonDataFile } from '../../../../src/app/online/sharing/dataFile';
import { hostedTable } from '../../../../src/app/online/sharing/identity/reissue';
import { makeDeviceProof } from '../../../../src/app/online/sharing/identity/proofs';
import { IdentityDesk } from '../../../../src/app/online/sharing/people/IdentityDesk';
import { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import { parsePeopleData, personKey } from '../../../../src/app/online/sharing/people/peopleTypes';
import { parsePlaceholders, placeholderKey, type Placeholder } from '../../../../src/app/online/sharing/people/placeholderTypes';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { PATHS } from './sharingPathsFixture';
import { nodeIdentityCrypto as crypto, testTable } from './sharingFixtures';

const T = 'T'.repeat(43);
const U = 'U'.repeat(43);
const D1 = 'a'.repeat(43);
const D2 = 'b'.repeat(43);
const FILE = PATHS.people;
const dave = { id: 'd'.repeat(22), name: 'Dave', formerNames: [] };
const named = (people: PeopleBook, name: string): Placeholder => people.placeholderByName(name)!;

function book(app = createInMemoryApp().app): PeopleBook {
  return new PeopleBook(new JsonDataFile(app.vault.adapter, FILE, parsePeopleData), () => 1000);
}

describe('people added by name', () => {
  it('adds a placeholder with no ids, devices or table, and keeps it across a reload', async () => {
    const { app } = createInMemoryApp();
    const people = book(app);
    await people.ready();
    expect(people.addPlaceholder('  Dave ')).toBeNull();
    expect(people.placeholders()).toEqual([{ id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/), name: 'Dave', formerNames: [] }]);
    expect(people.list()).toEqual([]);
    expect(people.byName('Dave')).toBeNull();
    expect(people.isPlaceholder('DAVE')).toBe(true);
    await vi.waitFor(async () => expect(await app.vault.adapter.read(FILE)).toContain('placeholders'));
    const again = book(app);
    await again.ready();
    expect(again.placeholders()).toEqual(people.placeholders());
  });

  it('refuses a name that is taken, now or formerly, by a person, a placeholder or someone removed, and never suffixes it', async () => {
    const people = book();
    await people.ready();
    const ana = people.admit(T, 'Ana', D1);
    people.rename(personKey(T, ana.personId), 'Anna');
    const ben = people.admit(T, 'Ben', D2);
    people.remove(personKey(T, ben.personId));
    expect(people.addPlaceholder('Dave')).toBeNull();
    for (const taken of ['anna', 'ANA', 'Ben', 'dave']) {
      expect(people.addPlaceholder(taken)).toBe(`Someone in your people list is already called ${taken}.`);
    }
    expect(people.placeholders().map((placeholder) => placeholder.name)).toEqual(['Dave']);
    expect(people.addPlaceholder('   ')).toBe('Enter a name of up to 40 characters.');
    expect(people.addPlaceholder('x'.repeat(41))).toBe('Enter a name of up to 40 characters.');
  });

  it('keeps its name away from people who join with it: they become "Dave (2)"', async () => {
    const people = book();
    await people.ready();
    people.addPlaceholder('Dave');
    expect(people.admit(T, 'dave', D1).name).toBe('dave (2)');
    expect(people.seen(U, 'p1', 'Dave').name).toBe('Dave (3)');
    expect(people.placeholders().map((placeholder) => placeholder.name)).toEqual(['Dave']);
  });

  it('renames (the old name stays) and removes (the names stay taken)', async () => {
    const people = book();
    await people.ready();
    people.addPlaceholder('Dave');
    people.addPlaceholder('Eve');
    expect(people.renamePlaceholder('Dave', 'Eve')).toBe('Someone in your people list is already called Eve.');
    expect(people.renamePlaceholder('Dave', 'David')).toBeNull();
    expect(people.placeholderByName('Dave')?.name).toBe('David');
    expect(people.addPlaceholder('Dave')).not.toBeNull();
    people.removePlaceholder('David');
    expect(people.isPlaceholder('David')).toBe(false);
    expect(people.admit(T, 'David', D1).name).toBe('David (2)');
    expect(people.admit(T, 'Dave', D2).name).toBe('Dave (2)');
  });

  it('tolerates older files and damaged entries', () => {
    expect(parsePeopleData({ version: 1, people: [] }).placeholders).toEqual([]);
    expect(parsePeopleData({ version: 1, people: [], placeholders: 'x' }).placeholders).toEqual([]);
    expect(parsePeopleData(null).placeholders).toEqual([]);
    expect(parsePlaceholders([
      { id: dave.id, name: 'Dave', formerNames: ['Davey', 3, ''] }, { name: 'dave' }, { name: '' }, { name: 5 }, null, 'x', { formerNames: [] }, { name: 'Eve' },
    ])).toEqual([{ id: dave.id, name: 'Dave', formerNames: ['Davey'] }, { id: expect.any(String), name: 'Eve', formerNames: [] }]);
  });
});

describe('meeting a placeholder', () => {
  const player = (playerId: string, name: string): SessionPlayer => ({ playerId, name, status: 'pending', client: 'obsidian' });
  async function setup() {
    const table = await testTable();
    const people = book();
    const desk = new IdentityDesk({ people, table: hostedTable(crypto, table, 'host-1', () => 'Morgan') });
    const device = async () => {
      const keys = await crypto.generate();
      const deviceId = await crypto.keyId(keys.publicKey);
      return { deviceId, proof: (nonce: string) => makeDeviceProof(crypto, keys, table.id, 'host-1', nonce) };
    };
    return { table, people, desk, device };
  }

  it('flags a new device with a placeholder’s name, and linking binds the identity to it, keeping name and references', async () => {
    const { table, people, desk, device } = await setup();
    await people.ready();
    people.addPlaceholder('Dave');
    const phone = await device();
    const id = named(people, 'Dave').id;
    expect(await desk.identify(player('p1', 'dave'), await phone.proof('nonce-aaaaaaaaaaaaaaaa')))
      .toEqual({ kind: 'new', sameName: { personId: null, name: 'Dave', placeholder: id } });
    const result = await desk.admission('p1', { placeholder: id });
    if ('refused' in result) throw new Error('refused');
    const person = people.get(table.id, result.admission.personId)!;
    expect(person).toMatchObject({ name: 'Dave', devices: [phone.deviceId] });
    expect(person.aliases).toContain(placeholderKey(id));
    expect(people.placeholders()).toEqual([]);
    expect(people.byName('Dave')?.personId).toBe(person.personId);
    // Their device knows them next time.
    expect(await desk.identify(player('p2', 'Anything'), await phone.proof('nonce-bbbbbbbbbbbbbbbb'))).toEqual({ kind: 'known', personId: person.personId, name: 'Dave' });
  });

  it('Allow keeps them separate: a typed name never links by itself, the new person is "Dave (2)"', async () => {
    const { people, desk, device } = await setup();
    await people.ready();
    people.addPlaceholder('Dave');
    await desk.identify(player('p1', 'Dave'), await (await device()).proof('nonce-aaaaaaaaaaaaaaaa'));
    const result = await desk.admission('p1');
    if ('refused' in result) throw new Error('refused');
    expect(people.get(people.list()[0]!.tableId, result.admission.personId)?.name).toBe('Dave (2)');
    expect(people.placeholders().map((placeholder) => placeholder.name)).toEqual(['Dave']);
    // The name still stands for the placeholder, not for the new person: nothing that names Dave reaches them.
    expect(people.unlinkedKey(placeholderKey(named(people, 'Dave').id))).toBe(true);
  });

  it('refuses to link when the placeholder is gone or the device already belongs to someone', async () => {
    const { people, desk, device } = await setup();
    await people.ready();
    people.addPlaceholder('Dave');
    const phone = await device();
    await desk.identify(player('p1', 'Dave'), await phone.proof('nonce-aaaaaaaaaaaaaaaa'));
    const id = named(people, 'Dave').id;
    people.removePlaceholder('Dave');
    expect(await desk.admission('p1', { placeholder: id })).toEqual({ refused: 'person' });
    expect(people.list()).toEqual([]);
    people.addPlaceholder('Eve');
    await desk.admission('p1');
    expect(await desk.admission('p1', { placeholder: named(people, 'Eve').id })).toEqual({ refused: 'person' });
    expect(people.placeholders().map((placeholder) => placeholder.name)).toEqual(['Eve']);
  });

  it('answering a link twice (a re-sign) gives the same person, not a refusal', async () => {
    const { people, desk, device } = await setup();
    await people.ready();
    people.addPlaceholder('Dave');
    const id = named(people, 'Dave').id;
    await desk.identify(player('p1', 'Dave'), await (await device()).proof('nonce-aaaaaaaaaaaaaaaa'));
    const first = await desk.admission('p1', { placeholder: id });
    const second = await desk.admission('p1', { placeholder: id });
    if ('refused' in first || 'refused' in second) throw new Error('refused');
    expect(second.admission.personId).toBe(first.admission.personId);
    expect(people.list()).toHaveLength(1);
  });

  it('a person met in a session is never linked on their own; linking in People merges them and keeps every name', async () => {
    const people = book();
    await people.ready();
    people.addPlaceholder('Dave');
    people.renamePlaceholder('Dave', 'David');
    const met = people.seen(U, 'dave1', 'Dave');
    expect(met.name).toBe('Dave (2)');
    expect(people.placeholders()).toHaveLength(1);
    expect(people.linkPlaceholder(personKey(U, 'dave1'), named(people, 'David').id)).toBeNull();
    const linked = people.get(U, 'dave1')!;
    expect(linked).toMatchObject({ name: 'David', devices: [] });
    expect(linked.formerNames).toEqual(expect.arrayContaining(['Dave', 'Dave (2)']));
    expect(people.placeholders()).toEqual([]);
    for (const name of ['David', 'Dave', 'Dave (2)']) expect(people.byName(name)?.personId).toBe('dave1');
    expect(people.linkPlaceholder(personKey(U, 'dave1'), 'x'.repeat(22))).toBe('Pick another person.');
  });
});

describe('stored map-share keys follow people', () => {
  it('a rename, a link and a reload all keep resolving the stored key, and a stale key resolves to nobody', async () => {
    const { app } = createInMemoryApp();
    const people = book(app);
    await people.ready();
    people.addPlaceholder('Dave');
    const { id } = named(people, 'Dave');
    const key = placeholderKey(id);
    expect(people.currentKey(key)).toBe(key);
    people.renamePlaceholder('Dave', 'David');
    expect(people.currentKey(key)).toBe(key);
    expect(named(people, 'David').id).toBe(id);
    const linked = people.admitAsPlaceholder(T, id, D1)!;
    expect(people.currentKey(key)).toBe(personKey(T, linked.personId));
    await vi.waitFor(async () => expect(await app.vault.adapter.read(FILE)).toContain(linked.personId));
    const again = book(app);
    await again.ready();
    expect(again.currentKey(key)).toBe(personKey(T, linked.personId));
    expect(again.currentKey(personKey(T, 'gone'))).toBeNull();
    expect(again.currentKey(placeholderKey('z'.repeat(22)))).toBeNull();
  });

  it('keys older versions wrote by name still resolve, and ids given to an older file are saved so they hold', async () => {
    const { app } = createInMemoryApp();
    await app.vault.adapter.mkdir(PATHS.root);
    await app.vault.adapter.write(FILE, JSON.stringify({ version: 1, people: [], placeholders: [{ name: 'Dave', formerNames: ['Davey'] }] }));
    const people = book(app);
    await people.ready();
    const { id } = named(people, 'Dave');
    expect(people.currentKey('placeholder:dave')).toBe(placeholderKey(id));
    expect(people.currentKey('placeholder:davey')).toBe(placeholderKey(id));
    await vi.waitFor(async () => expect(await app.vault.adapter.read(FILE)).toContain(id));
    const again = book(app);
    await again.ready();
    expect(named(again, 'Dave').id).toBe(id);
    // A person linked by an older version keeps the name key as an alias.
    const linked = again.admitAsPlaceholder(T, id, D1)!;
    expect(again.currentKey('placeholder:dave')).toBe(personKey(T, linked.personId));
  });
});

describe('a placeholder that is not linked yet', () => {
  it('is unlinked until a person is linked or admitted as it, however it was renamed; an unknown key is not a placeholder', async () => {
    const people = book();
    await people.ready();
    people.addPlaceholder('Dave');
    const key = placeholderKey(named(people, 'Dave').id);
    expect(people.unlinkedKey(key)).toBe(true);
    people.renamePlaceholder('Dave', 'David');
    expect(people.unlinkedKey(key)).toBe(true);
    // Older shares named it, so the name key counts too.
    expect(people.unlinkedKey('placeholder:david')).toBe(true);
    expect(people.unlinkedKey('placeholder:dave')).toBe(true);
    expect(people.unlinkedKey(personKey(T, 'gone'))).toBe(false);
    expect(people.unlinkedKey(placeholderKey('z'.repeat(22)))).toBe(false);
    const met = people.seen(T, 'dave2', 'David');
    expect(met.name).toBe('David (2)');
    // A person met under the same name does not link it: what is kept back from "Dave" stays kept back from everyone.
    expect(people.unlinkedKey(key)).toBe(true);
    expect(people.linkPlaceholder(personKey(T, 'dave2'), named(people, 'David').id)).toBeNull();
    expect(people.unlinkedKey(key)).toBe(false);
    expect(people.currentKey(key)).toBe(personKey(T, 'dave2'));
  });

  it('is no longer unlinked when the person is admitted as it, or after a reload', async () => {
    const { app } = createInMemoryApp();
    const people = book(app);
    await people.ready();
    people.addPlaceholder('Dave');
    const { id } = named(people, 'Dave');
    people.admitAsPlaceholder(T, id, D1);
    expect(people.unlinkedKey(placeholderKey(id))).toBe(false);
    await vi.waitFor(async () => expect(await app.vault.adapter.read(FILE)).toContain(id));
    const again = book(app);
    await again.ready();
    expect(again.unlinkedKey(placeholderKey(id))).toBe(false);
  });
});
