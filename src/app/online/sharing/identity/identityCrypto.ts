/**
 * Keys that prove who is who at a table without any secret leaving a device: ECDSA P-256
 * with SHA-256 (Web Crypto, in Obsidian and every browser). Public keys travel as base64url
 * SPKI, signatures as base64url raw (r‖s, IEEE P1363), and a key's id is the base64url
 * SHA-256 of its SPKI bytes: a table id for the GM's key, a device id for a player's.
 */
import { base64Url } from '../../ids';

export interface KeyPairJwk {
  /** Base64url SPKI. */
  publicKey: string;
  privateKey: JsonWebKey;
}

/** The GM's table: its id (the key's id) and its keys. */
export interface TableIdentity {
  id: string;
  keys: KeyPairJwk;
}

export interface IdentityCrypto {
  generate(): Promise<KeyPairJwk>;
  sign(privateKey: JsonWebKey, text: string): Promise<string>;
  /** False for a bad signature and for a key or signature that cannot be read. */
  verify(publicKey: string, text: string, signature: string): Promise<boolean>;
  /** Rejects for a key that is not base64url. */
  keyId(publicKey: string): Promise<string>;
}

const KEY_ALGORITHM: EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGNATURE: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url');
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(text));

export const webIdentityCrypto: IdentityCrypto = {
  async generate(): Promise<KeyPairJwk> {
    const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign', 'verify']);
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    return { publicKey: base64Url(new Uint8Array(spki)), privateKey: await crypto.subtle.exportKey('jwk', pair.privateKey) };
  },
  async sign(privateKey: JsonWebKey, text: string): Promise<string> {
    const key = await crypto.subtle.importKey('jwk', privateKey, KEY_ALGORITHM, false, ['sign']);
    return base64Url(new Uint8Array(await crypto.subtle.sign(SIGNATURE, key, utf8(text))));
  },
  async verify(publicKey: string, text: string, signature: string): Promise<boolean> {
    try {
      const key = await crypto.subtle.importKey('spki', fromBase64Url(publicKey), KEY_ALGORITHM, false, ['verify']);
      return await crypto.subtle.verify(SIGNATURE, key, fromBase64Url(signature), utf8(text));
    } catch {
      return false;
    }
  },
  async keyId(publicKey: string): Promise<string> {
    return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', fromBase64Url(publicKey))));
  },
};
