import { describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '../../../../src/app/online/GmSession';
import { JsonDataFile } from '../../../../src/app/online/sharing/dataFile';
import { hostedTable } from '../../../../src/app/online/sharing/identity/reissue';
import { makeDeviceProof } from '../../../../src/app/online/sharing/identity/proofs';
import { isPerson, partAllows, ruleReaches } from '../../../../src/app/online/sharing/model/audience';
import { mapShareReaches, type MapShare } from '../../../../src/app/online/sharing/model/mapShare';
import { unknownNamesIn, unlinkedExceptNames } from '../../../../src/app/online/sharing/model/noteFilter';
import { parseShareRule, unknownRuleNames } from '../../../../src/app/online/sharing/model/shareRule';
import { IdentityDesk } from '../../../../src/app/online/sharing/people/IdentityDesk';
import { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import { parsePeopleData, personKey } from '../../../../src/app/online/sharing/people/peopleTypes';
import { parsePlaceholders, placeholderKey, type Placeholder } from '../../../../src/app/online/sharing/people/placeholderTypes';
import { unlinkedMapWarnings } from '../../../../src/app/online/sharing/ui/unlinkedWarnings';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { PATHS } from './sharingPathsFixture';
import { noteCatalogue, nodeIdentityCrypto as crypto, testPeople, testPerson, testTable } from './sharingFixtures';

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

describe('a placeholder grants nothing', () => {
  const ana = testPerson('ana', 'Ana');
  const people = testPeople([ana], [dave]);
  const ruleOf = (value: unknown) => parseShareRule(value);
  const recipient = { tableId: ana.tableId, personId: 'ana' };

  it('only|Dave and atlas-share: [Dave] reach nobody, and are no longer "unknown"', () => {
    expect(ruleReaches(ruleOf(['Dave']), recipient, people)).toBe(false);
    expect(partAllows({ kind: 'only', names: ['Dave'] }, recipient, people)).toBe(false);
    expect(partAllows({ kind: 'only', names: ['Dave', 'Ana'] }, recipient, people)).toBe(true);
    expect(unknownRuleNames(ruleOf(['Dave', 'Zed']), people)).toEqual(['Zed']);
    expect(unknownNamesIn('---\natlas-share: [Dave]\n---\n%%[!only|Dave, Zed]%%x%%[!end]%%', people)).toEqual(['Zed']);
  });

  it('except|Dave, with Dave not linked yet, hides the part from everyone, like an unknown name', () => {
    expect(partAllows({ kind: 'except', names: ['Dave'] }, recipient, people)).toBe(false);
    expect(partAllows({ kind: 'except', names: ['Zed'] }, recipient, people)).toBe(false);
    expect(ruleReaches(ruleOf(['public', 'except Dave']), recipient, people)).toBe(false);
    expect(ruleReaches(ruleOf(['public', 'except Zed']), recipient, people)).toBe(false);
  });

  it('the real Dave arriving as "Dave (2)" does not see what was kept back from Dave', async () => {
    const real = book();
    await real.ready();
    real.addPlaceholder('Dave');
    const arrived = real.seen(T, 'dave2', 'Dave');
    expect(arrived.name).toBe('Dave (2)');
    const them = { tableId: T, personId: 'dave2' };
    expect(partAllows({ kind: 'except', names: ['Dave'] }, them, real)).toBe(false);
    expect(partAllows({ kind: 'only', names: ['Dave'] }, them, real)).toBe(false);
    expect(ruleReaches(ruleOf(['public', 'except Dave']), them, real)).toBe(false);
    expect(ruleReaches(ruleOf(['Dave']), them, real)).toBe(false);
    // Once linked, except|Dave hides it from Dave and shows it to others; only|Dave reaches Dave.
    real.linkPlaceholder(personKey(T, 'dave2'), named(real, 'Dave').id);
    const eve = real.seen(T, 'eve', 'Eve');
    expect(partAllows({ kind: 'except', names: ['Dave'] }, them, real)).toBe(false);
    expect(partAllows({ kind: 'except', names: ['Dave'] }, { tableId: eve.tableId, personId: 'eve' }, real)).toBe(true);
    expect(partAllows({ kind: 'only', names: ['Dave'] }, them, real)).toBe(true);
  });

  it('names the unlinked placeholders an except uses, for the sender’s warning', () => {
    const text = '---\natlas-share: [public, except Dave]\n---\n%%[!except|Dave, Ana, Zed]%%x%%[!end]%%%%[!only|Dave]%%y%%[!end]%%';
    expect(unlinkedExceptNames(text, people)).toEqual(['Dave']);
    expect(unlinkedExceptNames('%%[!only|Dave]%%y%%[!end]%%', people)).toEqual([]);
  });

  it('a resolver that cannot tell placeholders treats the name as unknown', () => {
    const plain = { byName: people.byName, allByName: people.allByName };
    expect(partAllows({ kind: 'except', names: ['Dave'] }, recipient, plain)).toBe(false);
    expect(partAllows({ kind: 'only', names: ['Dave'] }, recipient, plain)).toBe(false);
  });

  it('a map share with a placeholder key reaches nobody until linked, then the linked person', async () => {
    const share = (key: string, field: 'people' | 'except'): MapShare => ({
      item: 'i'.repeat(22), everyone: field === 'except', people: field === 'people' ? [key] : [], except: field === 'except' ? [key] : [], mode: 'full', notes: [],
    });
    const real = book();
    await real.ready();
    real.addPlaceholder('Dave');
    const key = placeholderKey(named(real, 'Dave').id);
    const eve = real.admit(T, 'Eve', D1);
    expect(mapShareReaches(share(key, 'people'), { tableId: T, personId: eve.personId }, real)).toBe(false);
    expect(mapShareReaches(share(key, 'except'), { tableId: T, personId: eve.personId }, real)).toBe(false);
    const linked = real.admitAsPlaceholder(T, named(real, 'Dave').id, D2)!;
    const recipientOf = { tableId: T, personId: linked.personId };
    expect(mapShareReaches(share(key, 'people'), recipientOf, real)).toBe(true);
    expect(mapShareReaches(share(key, 'except'), recipientOf, real)).toBe(false);
    expect(mapShareReaches(share(key, 'except'), { tableId: T, personId: eve.personId }, real)).toBe(true);
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
    expect(ruleReaches(parseShareRule(['Dave']), { tableId: people.list()[0]!.tableId, personId: result.admission.personId }, people)).toBe(false);
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
    expect(isPerson(linked, { tableId: U, personId: 'dave1' })).toBe(true);
    expect(people.linkPlaceholder(personKey(U, 'dave1'), 'x'.repeat(22))).toBe('Pick another person.');
  });
});

describe('preview as a placeholder', () => {
  const text = 'Open. %%[!only|Dave]%%Dave’s secret. %%[!end]%%%%[!except|Dave]%%Not for Dave. %%[!end]%%%%[!only|Ana]%%Ana’s. %%[!end]%%';

  it('shows what they would get once linked, and nothing real is touched', async () => {
    const ana = testPerson('ana', 'Ana');
    const catalogue = noteCatalogue({ 'N.md': { text, share: ['Dave'] } }, [ana], [dave]);
    const got = await catalogue.previewNoteAsPlaceholder('Dave', 'N.md');
    expect(got).toContain('Open.');
    expect(got).toContain('Dave’s secret.');
    expect(got).not.toContain('Not for Dave.');
    expect(got).not.toContain('Ana’s.');
    // A real recipient is unaffected: Dave is not linked, so what is kept back from him is kept back from everyone.
    const asAna = await catalogue.previewNote({ tableId: ana.tableId, personId: 'ana' }, 'N.md');
    expect(asAna).not.toContain('Not for Dave.');
    expect(asAna).not.toContain('Dave’s secret.');
    expect(await catalogue.list({ tableId: ana.tableId, personId: 'ana' })).toEqual([]);
    expect(await catalogue.previewNoteAsPlaceholder('Nobody', 'N.md')).toBeNull();
  });

  it('never shows the placeholder a note it does not share, as a real stand-in would not be listed either', async () => {
    const catalogue = noteCatalogue({ 'N.md': { text: 'Hi', share: ['Ana'] } }, [testPerson('ana', 'Ana')], [dave]);
    expect(await catalogue.list({ tableId: 'preview', personId: 'placeholder' })).toEqual([]);
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

describe('a map shared with everyone except an unlinked placeholder', () => {
  const share = (except: string[]): MapShare => ({ item: 'i'.repeat(22), everyone: true, people: [], except, mode: 'full', notes: [] });

  it('reaches nobody until Dave is linked; then everyone but the real Dave', async () => {
    const people = book();
    await people.ready();
    people.addPlaceholder('Dave');
    const key = placeholderKey(named(people, 'Dave').id);
    const eve = people.seen(T, 'eve', 'Eve');
    const arrived = people.seen(T, 'dave2', 'Dave');
    expect(arrived.name).toBe('Dave (2)');
    const asDave2 = { tableId: T, personId: 'dave2' };
    const asEve = { tableId: eve.tableId, personId: 'eve' };
    expect(mapShareReaches(share([key]), asDave2, people)).toBe(false);
    expect(mapShareReaches(share([key]), asEve, people)).toBe(false);
    expect(unlinkedMapWarnings([key], people)).toEqual(['Dave isn’t linked yet; this map is kept back from everyone until you link Dave.']);
    people.linkPlaceholder(personKey(T, 'dave2'), named(people, 'Dave').id);
    expect(mapShareReaches(share([key]), asDave2, people)).toBe(false);
    expect(mapShareReaches(share([key]), asEve, people)).toBe(true);
    expect(unlinkedMapWarnings([key], people)).toEqual([]);
    expect(unlinkedMapWarnings([personKey(T, 'gone')], people)).toEqual([]);
  });
});
