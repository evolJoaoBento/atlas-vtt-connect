/**
 * What each side of a join signs. A device proof binds the player's device key to one GM's
 * table and current host id, so a proof collected by any other host is worthless. A table
 * proof binds the GM's table key to the player's nonce and the person id it gives them, so a
 * fake GM cannot pose as the table. Neither carries a secret.
 */
import { isKeyId, type DeviceProof, type TableProof } from '../../protocol';
import type { IdentityCrypto, KeyPairJwk, TableIdentity } from './identityCrypto';

export function deviceProofText(table: string, hostId: string, nonce: string): string {
  return `atlas-device-v1|${table}|${hostId}|${nonce}`;
}

/** What a table proof is bound to besides the table: one GM host, one device and one join of it. */
export interface TableBinding {
  /** The GM's host id: a proof relayed from another host's session fails. */
  hostId: string;
  /** The device id (the key id of the player's device key) the proof is for: a proof made for another player's join fails. */
  deviceId: string;
  /** The player's nonce of this join. */
  nonce: string;
}

export function tableProofText(table: string, binding: TableBinding, personId: string): string {
  return `atlas-table-v1|${table}|${binding.hostId}|${binding.deviceId}|${binding.nonce}|${personId}`;
}

export async function makeDeviceProof(
  crypto: IdentityCrypto, keys: KeyPairJwk, table: string, hostId: string, nonce: string,
): Promise<DeviceProof> {
  return { table, key: keys.publicKey, nonce, sig: await crypto.sign(keys.privateKey, deviceProofText(table, hostId, nonce)) };
}

/** The device id the proof stands for; null unless it was made for this table and host and its signature checks. */
export async function checkDeviceProof(crypto: IdentityCrypto, proof: DeviceProof, table: string, hostId: string): Promise<string | null> {
  if (proof.table !== table) return null;
  try {
    if (!(await crypto.verify(proof.key, deviceProofText(table, hostId, proof.nonce), proof.sig))) return null;
    const id = await crypto.keyId(proof.key);
    return isKeyId(id) ? id : null;
  } catch {
    return null;
  }
}

export async function makeTableProof(
  crypto: IdentityCrypto, table: TableIdentity, binding: TableBinding, personId: string, gmName: string,
): Promise<TableProof> {
  return {
    id: table.id, key: table.keys.publicKey, personId, gmName,
    sig: await crypto.sign(table.keys.privateKey, tableProofText(table.id, binding, personId)),
  };
}

/** Whether the proof's key is the link's table (its id) and it signed this player's join: the link's host, their device and nonce. */
export async function checkTableProof(crypto: IdentityCrypto, proof: TableProof, tableId: string, binding: TableBinding): Promise<boolean> {
  if (proof.id !== tableId) return false;
  try {
    if ((await crypto.keyId(proof.key)) !== tableId) return false;
    return await crypto.verify(proof.key, tableProofText(tableId, binding, proof.personId), proof.sig);
  } catch {
    return false;
  }
}
