import { describe, expect, it } from 'vitest';
import { forwardedOpenTag, localizeForwardedTags, MAX_FORWARD_NAMES, peopleListNames } from '../../../../src/app/online/sharing/model/forwardedParts';
import { filterNoteFor } from '../../../../src/app/online/sharing/model/noteFilter';
import type { SenderCatalogue } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import type { Recipient } from '../../../../src/app/online/sharing/model/audience';
import { nodeHash } from '../assetFixtures';
import { noteCatalogue, TABLE_ID, testPeople, testPerson } from './sharingFixtures';
import { simpleSections } from './obsidianSections';

const T = TABLE_ID;
const OTHER = 'O'.repeat(43);
const gmList = [testPerson('ana', 'Ana'), testPerson('ben', 'Ben'), testPerson('cara', 'Cara'), testPerson('zoe', 'Zoe', OTHER)];
const as = (personId: string): Recipient => ({ tableId: T, personId });
const decode = (bytes: ArrayBuffer): string => new TextDecoder().decode(bytes);

/** What `recipient` is sent of a GM note shared with everyone. */
async function sent(text: string, recipient: Recipient, catalogue?: SenderCatalogue): Promise<{ text: string; version: string; bytes: ArrayBuffer }> {
  const notes = noteCatalogue({ 'Lore/Note.md': { text, share: 'public' } }, gmList);
  const source = catalogue ?? notes;
  const [item] = await source.list(recipient, 'gm');
  const payload = await source.open(recipient, item!.item, 'gm');
  return { text: decode(payload!.bytes), version: payload!.version, bytes: payload!.bytes };
}

/** As Ana's Atlas writes it: `known` are the person ids Ana's people list has. */
const asAnaWrites = (text: string, known: Record<string, string>): string => localizeForwardedTags(text, T, (personId) => known[personId] ?? null);
const anaKnows = { gm: 'Morgan', ben: 'Ben', cara: 'Cara' };

describe('restricted parts the recipient gets arrive marked (sender side)', () => {
  it('only|Ana reaches Ana marked for the GM alone, never for herself', async () => {
    const got = await sent('Open.\n%%[!only|Ana]%%\nFor Ana.\n%%[!end]%%', as('ana'));
    expect(got.text).toBe(`Open.\n%%[!only|@${T}/gm]%%\nFor Ana.\n%%[!end]%%`);
    expect(got.version).toBe(await nodeHash(got.bytes));
  });

  it('only|Ana, Ben names the sender and Ben; except|Cara names everyone else at the table', async () => {
    expect((await sent('%%[!only|Ana, Ben]%%x%%[!end]%%', as('ana'))).text).toBe(`%%[!only|@${T}/gm, @${T}/ben]%%x%%[!end]%%`);
    expect((await sent('%%[!except|Cara]%%x%%[!end]%%', as('ana'))).text).toBe(`%%[!only|@${T}/gm, @${T}/ben]%%x%%[!end]%%`);
    expect((await sent('%%[!except|Cara]%%x%%[!end]%%', as('cara'))).text).toBe('');
  });

  it('people at other tables are never named', async () => {
    const got = await sent('%%[!except|Cara]%%x%%[!end]%%', as('ben'));
    expect(got.text).not.toContain(OTHER);
  });

  it('nested parts keep both tags; a part the recipient may not see is still never sent', async () => {
    const source = '%%[!only|Ana, Ben]%%Both. %%[!except|Ben]%%Not Ben. %%[!end]%%%%[!private]%%GM. %%[!end]%%End.%%[!end]%%';
    expect((await sent(source, as('ana'))).text).toBe(`%%[!only|@${T}/gm, @${T}/ben]%%Both. %%[!only|@${T}/gm, @${T}/cara]%%Not Ben. %%[!end]%%End.%%[!end]%%`);
    expect((await sent(source, as('ben'))).text).toBe(`%%[!only|@${T}/gm, @${T}/ana]%%Both. End.%%[!end]%%`);
  });

  it('a part whose end tag falls in hidden text is not sent at all, so no tag goes without its end', async () => {
    const stray = 'Top\n%%[!only|Ana]%%\nFor Ana.\n[!private] old\n%%[!end]%%\nAfter';
    expect((await sent(stray, as('ana'))).text).toBe('Top');
    const unclosedComment = 'Top\n%%[!only|Ana]%%\nFor Ana. `%%`\n%%[!end]%%\nAfter';
    expect((await sent(unclosedComment, as('ana'))).text).toBe('Top');
  });

  it('a note with a stray end is neither listed nor served, and its preview says why (T-stray)', async () => {
    const note = { text: 'Open.', share: 'public' };
    const notes = noteCatalogue({ 'Lore/Note.md': note }, gmList);
    const [item] = await notes.list(as('ana'), 'gm');
    expect(await notes.open(as('ana'), item!.item, 'gm')).not.toBeNull();
    note.text = 'Open.\n%%[!end]%%\nRest.';
    expect(await notes.list(as('ana'), 'gm')).toEqual([]);
    expect(await notes.open(as('ana'), item!.item, 'gm')).toBeNull();
    expect(await notes.previewNote(as('ana'), 'Lore/Note.md', 'gm')).toContain('line 2');
  });

  it('the preview shows the tags with the sender’s names', async () => {
    const catalogue = noteCatalogue({ 'Lore/Note.md': { text: '%%[!only|Ana, Ben]%%x%%[!end]%%', share: 'public' } }, gmList);
    expect(await catalogue.previewNote(as('ana'), 'Lore/Note.md', 'gm')).toBe('%%[!only|you, Ben]%%x%%[!end]%%');
    expect(await catalogue.previewNote(as('cara'), 'Lore/Note.md', 'gm')).toBe('');
  });
});

describe('the receiver writes the marks with its own names', () => {
  it('Ana knows Ben: her copy names the GM and Ben', () => {
    expect(asAnaWrites(`%%[!only|@${T}/gm, @${T}/ben]%%x%%[!end]%%`, anaKnows)).toBe('%%[!only|Morgan, Ben]%%x%%[!end]%%');
  });

  it('Ana does not know Ben: her copy names the GM only (fail closed)', () => {
    expect(asAnaWrites(`%%[!only|@${T}/gm, @${T}/ben]%%x%%[!end]%%`, { gm: 'Morgan' })).toBe('%%[!only|Morgan]%%x%%[!end]%%');
  });

  it('a key nobody resolves goes; with nobody left the part is private', () => {
    expect(asAnaWrites(`%%[!only|@${T}/ghost]%%x%%[!end]%%`, anaKnows)).toBe('%%[!private]%%x%%[!end]%%');
  });

  it('keys of another table, malformed keys and plain names are dropped', () => {
    for (const name of [`@${OTHER}/gm`, '@short/gm', `@${T}/b a d`, `@${T}/gm/x`, 'Morgan', `${T}/gm`]) {
      expect(asAnaWrites(`%%[!only|${name}]%%x%%[!end]%%`, anaKnows), name).toBe('%%[!private]%%x%%[!end]%%');
    }
  });

  it('a name its people list holds that a tag cannot carry is dropped', () => {
    expect(asAnaWrites(`%%[!only|@${T}/gm, @${T}/ben]%%x%%[!end]%%`, { gm: 'Morgan, the GM', ben: 'Ben' })).toBe('%%[!only|Ben]%%x%%[!end]%%');
  });

  it('anything else that arrives as a tag turns private; ends stay ends', () => {
    expect(asAnaWrites('%%[!except|Ben]%%x%%[!end]%% %%[!secret]%%y%%[!end]%%', anaKnows)).toBe('%%[!private]%%x%%[!end]%% %%[!private]%%y%%[!end]%%');
  });

  it('reads no more names than the limit', () => {
    const keys = Array.from({ length: MAX_FORWARD_NAMES + 5 }, (_, index) => `${T}/p${index}`);
    const known = Object.fromEntries(keys.map((key, index) => [key.split('/')[1]!, `P${index}`]));
    const tag = `%%[!only|${keys.map((key) => `@${key}`).join(', ')}]%%`;
    const written = asAnaWrites(`${tag}x%%[!end]%%`, known);
    expect(written).toContain(`P${MAX_FORWARD_NAMES - 1}]`);
    expect(written).not.toContain(`P${MAX_FORWARD_NAMES},`);
    expect(forwardedOpenTag(keys).split('@').length - 1).toBe(MAX_FORWARD_NAMES);
  });
});

describe('the receiver’s names come from its own people list only', () => {
  it('a person of the table by their people-list name; nobody else, and no session name', () => {
    // Ana's list knows another table's Ben, so this table's Ben is "Ben (2)" there.
    const anaBook = testPeople([testPerson('ben', 'Ben', OTHER), testPerson('ben', 'Ben (2)'), testPerson('gm', 'Morgan')]);
    const names = peopleListNames(anaBook, T);
    expect(names('ben')).toBe('Ben (2)');
    expect(names('gm')).toBe('Morgan');
    expect(names('cara')).toBeNull();
    expect(asAnaWrites(`%%[!only|@${T}/gm, @${T}/ben, @${T}/cara]%%x%%[!end]%%`, { gm: names('gm')!, ben: names('ben')! })).toBe('%%[!only|Morgan, Ben (2)]%%x%%[!end]%%');
  });

  it('a name that reads back as someone else is dropped', () => {
    // Older data: two people called Ben; the list reads "Ben" as the other table's.
    const book = testPeople([testPerson('ben', 'Ben', OTHER), testPerson('ben', 'Ben')]);
    expect(peopleListNames(book, T)('ben')).toBeNull();
  });
});

describe('a re-share runs the received tags through the normal filter', () => {
  const anaList = testPeople([testPerson('gm', 'Morgan'), testPerson('ben', 'Ben')]);
  const reshare = (text: string, personId: string): string => filterNoteFor(text, { sections: simpleSections(text),
    recipient: as(personId), people: anaList, shareable: [], links: () => null, marks: null,
  });

  it('Ben does not get the part meant for Ana; the GM does', () => {
    const copy = asAnaWrites(`Open.\n%%[!only|@${T}/gm]%%\nFor Ana.\n%%[!end]%%`, anaKnows);
    expect(reshare(copy, 'ben')).toBe('Open.');
    expect(reshare(copy, 'gm')).toBe('Open.\nFor Ana.');
  });
});
