/**
 * The GM's table as the rest of Atlas may use it: its id, a check of a player's device proof and the
 * signing of a table proof for a verified device. The private key stays in here.
 */
import type { Admission, SessionPlayer } from '../../gmSessionTypes';
import type { DeviceProof, TableProof } from '../../protocol';
import type { IdentityCrypto, TableIdentity } from './identityCrypto';
import { checkDeviceProof, makeTableProof } from './proofs';

export interface HostedTable {
  id: string;
  /** The device id of a proof made for this table and the current host id; null otherwise. */
  checkDevice(device: DeviceProof): Promise<string | null>;
  /** The table proof for a person on the device `deviceId` (from `checkDevice`) and its join `nonce`. */
  prove(deviceId: string, nonce: string, personId: string): Promise<TableProof>;
}

export function hostedTable(crypto: IdentityCrypto, table: TableIdentity, hostId: string, gmName: () => string): HostedTable {
  return {
    id: table.id,
    checkDevice: (device) => checkDeviceProof(crypto, device, table.id, hostId),
    prove: (deviceId, nonce, personId) => makeTableProof(crypto, table, { hostId, deviceId, nonce }, personId, gmName()),
  };
}

/** For a person admitted before who joins again with a new nonce: the same device, a fresh table proof. */
export function tableReissuer(table: HostedTable): (player: SessionPlayer, device: DeviceProof) => Promise<Admission | null> {
  return async (player, device) => {
    if (!player.personId) return null;
    const deviceId = await table.checkDevice(device);
    return deviceId === null ? null : { personId: player.personId, table: await table.prove(deviceId, device.nonce, player.personId) };
  };
}
