/**
 * A player's device key per table, kept in Obsidian's local storage: on this device only,
 * never in the vault (which may sync to other devices) and never sent. One key is made per
 * table, the first time this device joins it.
 */
import type { App } from 'obsidian';
import type { IdentityCrypto, KeyPairJwk } from './identityCrypto';

export const DEVICE_KEYS_STORAGE = 'atlas-vtt-connect-device-keys';

export interface KeyValueStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored key pair of the right shape: a P-256 private JWK and a public key string. */
export function isKeyPairJwk(value: unknown): value is KeyPairJwk {
  if (!isRecord(value) || typeof value.publicKey !== 'string' || value.publicKey.length > 200) return false;
  const key = value.privateKey;
  return isRecord(key) && key.kty === 'EC' && key.crv === 'P-256' && typeof key.d === 'string';
}

export function memoryKeyValueStore(): KeyValueStore {
  const values = new Map<string, unknown>();
  return { get: (key) => values.get(key) ?? null, set: (key, value) => { values.set(key, value); } };
}

export function obsidianLocalStore(app: App): KeyValueStore {
  return {
    get: (key): unknown => {
      try {
        return app.loadLocalStorage(key) as unknown;
      } catch {
        return null;
      }
    },
    set: (key, value): void => {
      try {
        app.saveLocalStorage(key, value);
      } catch (error) {
        console.error('[Atlas online] Could not keep the device key:', error);
      }
    },
  };
}

export class DeviceKeys {
  private readonly making = new Map<string, Promise<KeyPairJwk>>();

  constructor(private readonly store: KeyValueStore, private readonly crypto: IdentityCrypto) {}

  /** This device's key for the table; made and stored on first use, once even when asked twice at once. */
  forTable(tableId: string): Promise<KeyPairJwk> {
    const stored = this.stored()[tableId];
    if (isKeyPairJwk(stored)) return Promise.resolve(stored);
    const running = this.making.get(tableId);
    if (running) return running;
    const made = this.crypto.generate().then((keys) => {
      this.store.set(DEVICE_KEYS_STORAGE, { ...this.stored(), [tableId]: keys });
      this.making.delete(tableId);
      return keys;
    }, (error: unknown) => {
      this.making.delete(tableId);
      throw error;
    });
    this.making.set(tableId, made);
    return made;
  }

  private stored(): Record<string, unknown> {
    const value = this.store.get(DEVICE_KEYS_STORAGE);
    return isRecord(value) ? value : {};
  }
}
