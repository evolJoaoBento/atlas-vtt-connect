/** The GM's table key, kept in Obsidian's local storage on this device (`ConnectSettingsStore`): made the first time this Atlas hosts, then stable. */
import type { OnlineSettings, StoredTable } from '../../onlineSettings';
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

/** A new table key pair and its id, not stored yet. */
export async function newTableIdentity(crypto: IdentityCrypto): Promise<TableIdentity> {
  const keys = await crypto.generate();
  return { id: await crypto.keyId(keys.publicKey), keys };
}

/** The table as the settings store it. */
export const storedTable = ({ id, keys }: TableIdentity): StoredTable => ({ id, publicKey: keys.publicKey, privateKey: keys.privateKey });

/** A new table key pair, stored (the settings keep it on this device only). */
async function makeTableIdentity(settings: TableSettings, crypto: IdentityCrypto): Promise<TableIdentity> {
  const table = await newTableIdentity(crypto);
  settings.set({ table: storedTable(table) });
  return table;
}
