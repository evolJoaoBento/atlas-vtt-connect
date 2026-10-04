import { describe, expect, it } from 'vitest';
import type { SessionPlayer } from '../../../../src/app/online/GmSession';
import { checkTableProof, makeDeviceProof } from '../../../../src/app/online/sharing/identity/proofs';
import { hostedTable, tableReissuer } from '../../../../src/app/online/sharing/identity/reissue';
import { nodeIdentityCrypto as crypto, testTable } from './sharingFixtures';

const NONCE = 'nonce-aaaaaaaaaaaaaaaa';
const ana: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'gone', personId: 'ana_1' };

async function setup() {
  const table = await testTable();
  const device = await crypto.generate();
  const reissue = tableReissuer(hostedTable(crypto, table, 'gm', () => 'Morgan'));
  return { table, device, reissue };
}

describe('tableReissuer', () => {
  it('signs a table proof bound to the host, the device and the new nonce', async () => {
    const { table, device, reissue } = await setup();
    const proof = await makeDeviceProof(crypto, device, table.id, 'gm', NONCE);
    const admission = await reissue(ana, proof);
    expect(admission?.personId).toBe('ana_1');
    const deviceId = await crypto.keyId(device.publicKey);
    expect(await checkTableProof(crypto, admission!.table, table.id, { hostId: 'gm', deviceId, nonce: NONCE })).toBe(true);
    expect(await checkTableProof(crypto, admission!.table, table.id, { hostId: 'other', deviceId, nonce: NONCE })).toBe(false);
  });

  it('refuses a device proof for another host or another table', async () => {
    const { table, device, reissue } = await setup();
    expect(await reissue(ana, await makeDeviceProof(crypto, device, table.id, 'other-host', NONCE))).toBeNull();
    expect(await reissue(ana, await makeDeviceProof(crypto, device, (await testTable()).id, 'gm', NONCE))).toBeNull();
  });

  it('refuses a forged signature and a player without a person id', async () => {
    const { table, device, reissue } = await setup();
    const proof = await makeDeviceProof(crypto, device, table.id, 'gm', NONCE);
    expect(await reissue(ana, { ...proof, sig: 'A'.repeat(86) })).toBeNull();
    expect(await reissue({ playerId: 'p2', name: 'Web', status: 'gone' }, proof)).toBeNull();
  });
});
