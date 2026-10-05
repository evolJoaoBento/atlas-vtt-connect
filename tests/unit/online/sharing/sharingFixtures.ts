/**
 * Fixtures for sharing tests. Node's crypto resolves at once, so tests driven by fake timers
 * never wait on Web Crypto, which finishes outside their control (as `nodeHash` for images).
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { IdentityCrypto, KeyPairJwk } from '../../../../src/app/online/sharing/identity/identityCrypto';
import { SenderCatalogue, type CatalogueSources } from '../../../../src/app/online/sharing/model/SenderCatalogue';
import { parseShareRule } from '../../../../src/app/online/sharing/model/shareRule';
import type { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import type { Person } from '../../../../src/app/online/sharing/people/peopleTypes';
import { isCalled, type Placeholder } from '../../../../src/app/online/sharing/people/placeholderTypes';
import { memoryImageFiles, nodeHash } from '../assetFixtures';
import { simpleSections } from './obsidianSections';

export const nodeIdentityCrypto: IdentityCrypto = {
  generate: (): Promise<KeyPairJwk> => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    return Promise.resolve({
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      privateKey: privateKey.export({ format: 'jwk' }) as JsonWebKey,
    });
  },
  sign: (privateKey: JsonWebKey, text: string): Promise<string> => Promise.resolve(
    sign('sha256', Buffer.from(text), { key: createPrivateKey({ key: privateKey as never, format: 'jwk' }), dsaEncoding: 'ieee-p1363' })
      .toString('base64url'),
  ),
  verify: (publicKey: string, text: string, signature: string): Promise<boolean> => {
    try {
      const key = createPublicKey({ key: Buffer.from(publicKey, 'base64url'), format: 'der', type: 'spki' });
      return Promise.resolve(verify('sha256', Buffer.from(text), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
    } catch {
      return Promise.resolve(false);
    }
  },
  keyId: (publicKey: string): Promise<string> =>
    Promise.resolve(createHash('sha256').update(Buffer.from(publicKey, 'base64url')).digest('base64url')),
};

/** A table identity for tests: a fresh key and its id. */
export async function testTable(): Promise<{ id: string; keys: KeyPairJwk }> {
  const keys = await nodeIdentityCrypto.generate();
  return { id: await nodeIdentityCrypto.keyId(keys.publicKey), keys };
}

export const TABLE_ID = 'T'.repeat(43);

export function testPerson(personId: string, name: string, tableId = TABLE_ID): Person {
  return { tableId, personId, name, formerNames: [], devices: [], aliases: [], lastSeen: 0 };
}

/** The people book's lookups over a fixed list (and fixed placeholders, people added by name), as the book answers them. */
export function testPeople(list: readonly Person[], placeholders: readonly Placeholder[] = []): Pick<PeopleBook,
  'byName' | 'allByName' | 'byKey' | 'get' | 'list' | 'ready' | 'placeholders' | 'placeholderByName' | 'isPlaceholder'> {
  const placeholderByName = (name: string): Placeholder | null => placeholders.find((placeholder) => isCalled(placeholder, name)) ?? null;
  return {
    get: (tableId, personId) => list.find((person) => person.tableId === tableId && person.personId === personId) ?? null,
    byName: (name) => list.find((person) => person.name.toLowerCase() === name.toLowerCase()) ?? null,
    allByName: (name) => list.filter((person) => [person.name, ...person.formerNames].some((own) => own.toLowerCase() === name.toLowerCase())),
    byKey: (key) => list.find((person) => `${person.tableId}/${person.personId}` === key || person.aliases.includes(key)) ?? null,
    list: () => list,
    ready: async () => {},
    placeholders: () => placeholders,
    placeholderByName,
    isPlaceholder: (name) => placeholderByName(name) !== null,
  };
}

/** A catalogue of notes only: path → text, each with its `atlas-share` value. */
export function noteCatalogue(notes: Record<string, { text: string; share: unknown }>, people: readonly Person[], placeholders: readonly Placeholder[] = []): SenderCatalogue {
  const ids = new Map<string, string>();
  const items = {
    idFor: (path: string): string => {
      if (!ids.has(path)) ids.set(path, `n${ids.size}`.padEnd(22, 'x'));
      return ids.get(path)!;
    },
    pathOf: (item: string): string | null => [...ids].find(([, id]) => id === item)?.[0] ?? null,
    ready: async (): Promise<void> => {},
  };
  const title = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/, '');
  const sources: CatalogueSources = {
    notes: () => Object.entries(notes).filter(([, note]) => note.share !== undefined)
      .map(([path, note]) => ({ path, title: title(path), rule: parseShareRule(note.share) })),
    note: (path) => (notes[path] ? { path, title: title(path), rule: parseShareRule(notes[path]!.share) } : null),
    readNote: async (path) => { const text = notes[path]?.text ?? ''; return { text, sections: simpleSections(text) }; },
    maps: async () => [],
    readMap: async () => null,
    images: memoryImageFiles({}).source,
    isFile: (path) => path in notes,
    resolveLink: (linkpath) => Object.keys(notes).find((path) => title(path) === linkpath) ?? null,
    shareable: () => [],
    rules: () => ({ showGrid: true, showTokenNameplates: false, showWidgets: true, showInitiative: true }),
    collectionGrid: () => null,
    coneAngle: () => 90,
    initiativeRules: () => ({ mode: 'turn-order', roll: '1d20', firstSide: 'players' }),
  };
  return new SenderCatalogue(sources, items, testPeople(people, placeholders), nodeHash, async () => null);
}
