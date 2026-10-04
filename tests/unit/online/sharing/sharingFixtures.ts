/**
 * Identity fixtures for the table-proof tests. Node's crypto resolves at once, so tests driven by fake timers
 * never wait on Web Crypto, which finishes outside their control.
 * Trimmed to what these tests use; the sharing tests bring the rest of the fork's fixtures with them.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import type { IdentityCrypto, KeyPairJwk } from '../../../../src/app/online/sharing/identity/identityCrypto';

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
