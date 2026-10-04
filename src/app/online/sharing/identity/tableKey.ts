/** The GM's table key, kept in Connect's settings: made the first time this Atlas hosts, then stable. */
import type { OnlineSettings } from '../../onlineSettings';
import type { IdentityCrypto, TableIdentity } from './identityCrypto';

export interface TableSettings {
  get(): OnlineSettings;
  set(settings: Partial<OnlineSettings>): void;
}

export async function ensureTableIdentity(settings: TableSettings, crypto: IdentityCrypto): Promise<TableIdentity> {
  const stored = settings.get().table;
  if (stored) return { id: stored.id, keys: { publicKey: stored.publicKey, privateKey: stored.privateKey } };
  const keys = await crypto.generate();
  const id = await crypto.keyId(keys.publicKey);
  settings.set({ table: { id, publicKey: keys.publicKey, privateKey: keys.privateKey } });
  return { id, keys };
}
