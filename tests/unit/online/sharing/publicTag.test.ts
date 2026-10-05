import { describe, expect, it } from 'vitest';
import type { Recipient } from '../../../../src/app/online/sharing/model/audience';
import { filterNoteFor, partProblemsInNote } from '../../../../src/app/online/sharing/model/noteFilter';
import { openTag, scanTags } from '../../../../src/app/online/sharing/model/privateTags';
import { noteCatalogue, TABLE_ID, testPeople, testPerson } from './sharingFixtures';
import { simpleSections } from './obsidianSections';

const T = TABLE_ID;
const list = [testPerson('ana', 'Ana'), testPerson('ben', 'Ben'), testPerson('cara', 'Cara')];
const people = testPeople(list);
const as = (personId: string): Recipient => ({ tableId: T, personId });
const forPerson = (personId: string, source: string): string =>
  filterNoteFor(source, { sections: simpleSections(source), recipient: as(personId), people, shareable: [], links: () => null, marks: null });
const everyone = ['ana', 'ben', 'cara'];

describe('%%[!public]%% (everyone the note is shared with)', () => {
  it('is a tag, case and whitespace tolerated, and writes back as %%[!public]%%', () => {
    expect(scanTags('%%[!public]%%x%% [! PUBLIC ] %%', 'inline-only').map((tag) => tag.kind)).toEqual(['open', 'open']);
    expect(openTag({ kind: 'public' })).toBe('%%[!public]%%');
  });

  it('shows its part to everyone the note reaches, without its tags', () => {
    for (const id of everyone) expect(forPerson(id, 'A %%[!public]%%shared%%[!end]%% B')).toBe('A shared B');
  });

  it('inside a private or only part, the outer rule still applies', () => {
    const source = 'Top %%[!private]%%gm %%[!public]%%still gm%%[!end]%%%%[!end]%% End';
    for (const id of everyone) expect(forPerson(id, source)).not.toContain('gm');
    const only = '%%[!only|Ana]%%for ana %%[!public]%%inner%%[!end]%%%%[!end]%%';
    expect(forPerson('ana', only)).toBe('for ana inner');
    expect(forPerson('ben', only)).toBe('');
  });

  it('a restriction inside a public part still applies', () => {
    const source = '%%[!public]%%all %%[!except|Ben]%%not ben%%[!end]%%%%[!end]%%';
    expect(forPerson('ana', source)).toBe('all not ben');
    expect(forPerson('ben', source)).toBe('all');
  });

  it('unclosed, it hides the rest of the note from everyone, and is warned', () => {
    for (const id of everyone) expect(forPerson(id, 'Top\n%%[!public]%%\nRest')).toBe('Top');
    expect(partProblemsInNote('Top\n%%[!public]%%\nRest', simpleSections('Top\n%%[!public]%%\nRest')).unclosed).toBe(1);
  });

  it('[!public|names] is malformed: it hides its part from everyone', () => {
    expect(scanTags('%%[!public|Ana]%%', 'inline-only')[0]?.kind).toBe('malformed');
    for (const id of everyone) expect(forPerson(id, 'A %%[!public|Ana]%%x%%[!end]%% B')).toBe('A  B');
  });

  it('is never forwarded: a public part in an only part sends only the outer tag', async () => {
    const text = '%%[!only|Ana, Ben]%%both %%[!public]%%inner%%[!end]%% end%%[!end]%%';
    const catalogue = noteCatalogue({ 'Lore/Note.md': { text, share: 'public' } }, list);
    const [item] = await catalogue.list(as('ana'), 'gm');
    const payload = await catalogue.open(as('ana'), item!.item, 'gm');
    expect(new TextDecoder().decode(payload!.bytes)).toBe(`%%[!only|@${T}/gm, @${T}/ben]%%both inner end%%[!end]%%`);
    const alone = noteCatalogue({ 'Lore/Note.md': { text: 'a %%[!public]%%b%%[!end]%% c', share: 'public' } }, list);
    const [single] = await alone.list(as('ana'), 'gm');
    expect(new TextDecoder().decode((await alone.open(as('ana'), single!.item, 'gm'))!.bytes)).toBe('a b c');
  });
});
