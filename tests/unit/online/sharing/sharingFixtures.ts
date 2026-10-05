/**
 * Fixtures for sharing tests. Node's crypto resolves at once, so tests driven by fake timers
 * never wait on Web Crypto, which finishes outside their control (as `nodeHash` for images).
 * The fork's `noteCatalogue` comes back with B13, which ports the `SenderCatalogue` it builds.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { IdentityCrypto, KeyPairJwk } from '../../../../src/app/online/sharing/identity/identityCrypto';
import type { PeopleBook } from '../../../../src/app/online/sharing/people/PeopleBook';
import type { Person } from '../../../../src/app/online/sharing/people/peopleTypes';
import { isCalled, type Placeholder } from '../../../../src/app/online/sharing/people/placeholderTypes';

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
