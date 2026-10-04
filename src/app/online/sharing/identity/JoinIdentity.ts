/**
 * A player's identity in one joined session: the device proof for the link's table (made before the
 * join starts) and the GM's table proof (checked once, after the first admission). Sharing works
 * only when `identity` is set; a session without it plays on as before.
 */
import type { JoinTarget } from '../../joinLink';
import { randomId } from '../../ids';
import type { DeviceProof, TableProof } from '../../protocol';
import type { DeviceKeys } from './deviceKeys';
import type { IdentityCrypto } from './identityCrypto';
import { checkTableProof, makeDeviceProof } from './proofs';

/** Who this Atlas is in the joined session, once the GM's table proof checked: sharing works only then. */
export interface SessionIdentity {
  tableId: string;
  /** This player's person id at that table. */
  personId: string;
  gmName: string;
}

export class JoinIdentity {
  /** One per join; every join message of it carries the same proof. */
  readonly nonce = randomId();
  /** The device proof for the link's table; null without a table, or until it is made. */
  device: DeviceProof | null = null;
  identity: SessionIdentity | null = null;
  private checked = false;

  constructor(
    private readonly target: JoinTarget,
    private readonly crypto: IdentityCrypto,
    private readonly keys: Pick<DeviceKeys, 'forTable'>,
  ) {}

  /** Makes the device proof for the link's table; on failure there is none (no sharing). */
  async prepare(): Promise<void> {
    const tableId = this.target.tableId;
    if (!tableId) return;
    try {
      const keys = await this.keys.forTable(tableId);
      this.device = await makeDeviceProof(this.crypto, keys, tableId, this.target.hostId, this.nonce);
    } catch (error) {
      console.error('[Atlas online] Could not prove this device; joining without sharing:', error);
    }
  }

  /**
   * Takes the GM's table proof when it is for the link's table and host, this device and this join's nonce, once per join.
   * True when the identity was set now; otherwise sharing stays off.
   */
  async verify(proof: TableProof | null): Promise<boolean> {
    if (this.checked) return false;
    this.checked = true;
    const tableId = this.target.tableId;
    if (!proof || !tableId || !this.device) return false;
    try {
      const deviceId = await this.crypto.keyId(this.device.key);
      if (!(await checkTableProof(this.crypto, proof, tableId, { hostId: this.target.hostId, deviceId, nonce: this.nonce }))) return false;
    } catch {
      return false;
    }
    this.identity = { tableId, personId: proof.personId, gmName: proof.gmName };
    return true;
  }
}
