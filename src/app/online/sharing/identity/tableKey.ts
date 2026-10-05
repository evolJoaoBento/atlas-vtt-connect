/** The GM's table key, kept in Obsidian's local storage on this device (`ConnectSettingsStore`): made the first time this Atlas hosts, then stable. */
import type { OnlineSettings } from '../../onlineSettings';
import type { IdentityCrypto, TableIdentity } from './identityCrypto';

export interface TableSettings {
  get(): OnlineSettings;
  set(settings: Partial<OnlineSettings>): void;
}

export async function ensureTableIdentity(settings: TableSettings, crypto: IdentityCrypto): Promise<TableIdentity> {
  const stored = settings.get().table;
  if (stored) return { id: stored.id, keys: { publicKey: stored.publicKey, privateKey: stored.privateKey } };
  return makeTableIdentity(settings, crypto);
}

/** A new table key pair, stored in place of any earlier one (the settings keep it on this device only). */
export async function makeTableIdentity(settings: TableSettings, crypto: IdentityCrypto): Promise<TableIdentity> {
  const keys = await crypto.generate();
  const id = await crypto.keyId(keys.publicKey);
  settings.set({ table: { id, publicKey: keys.publicKey, privateKey: keys.privateKey } });
  return { id, keys };
}
