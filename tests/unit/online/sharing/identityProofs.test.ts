import { describe, expect, it } from 'vitest';
import { webIdentityCrypto } from '../../../../src/app/online/sharing/identity/identityCrypto';
import {
  checkDeviceProof, checkTableProof, deviceProofText, makeDeviceProof, makeTableProof,
} from '../../../../src/app/online/sharing/identity/proofs';
import { nodeIdentityCrypto as crypto, testTable } from './sharingFixtures';

describe('device proofs', () => {
  it('stand for the device key and check only for their table and host', async () => {
    const table = await testTable();
    const device = await crypto.generate();
    const proof = await makeDeviceProof(crypto, device, table.id, 'host-1', 'nonce-aaaaaaaaaaaaaaaa');
    const deviceId = await crypto.keyId(device.publicKey);
    expect(await checkDeviceProof(crypto, proof, table.id, 'host-1')).toBe(deviceId);
    // Made for another host: a forged link's host collects a proof worthless at the real GM.
    expect(await checkDeviceProof(crypto, proof, table.id, 'host-2')).toBeNull();
    expect(await checkDeviceProof(crypto, proof, (await testTable()).id, 'host-1')).toBeNull();
  });

  it('fail for a changed nonce, a signature of other text or another key', async () => {
    const table = await testTable();
    const device = await crypto.generate();
    const other = await crypto.generate();
    const proof = await makeDeviceProof(crypto, device, table.id, 'h', 'nonce-aaaaaaaaaaaaaaaa');
    expect(await checkDeviceProof(crypto, { ...proof, nonce: 'nonce-bbbbbbbbbbbbbbbb' }, table.id, 'h')).toBeNull();
    expect(await checkDeviceProof(crypto, { ...proof, key: other.publicKey }, table.id, 'h')).toBeNull();
    const wrongText = await crypto.sign(device.privateKey, `${deviceProofText(table.id, 'h', proof.nonce)}x`);
    expect(await checkDeviceProof(crypto, { ...proof, sig: wrongText }, table.id, 'h')).toBeNull();
    expect(await checkDeviceProof(crypto, { ...proof, key: 'not base64 !!' }, table.id, 'h')).toBeNull();
  });
});

describe('table proofs', () => {
  const bound = { hostId: 'host-1', deviceId: 'D'.repeat(43), nonce: 'nonce-aaaaaaaaaaaaaaaa' };

  it('check against the link table id, host, the player device and nonce', async () => {
    const table = await testTable();
    const proof = await makeTableProof(crypto, table, bound, 'person-1', 'Morgan');
    expect(proof).toMatchObject({ id: table.id, personId: 'person-1', gmName: 'Morgan' });
    expect(await checkTableProof(crypto, proof, table.id, bound)).toBe(true);
    expect(await checkTableProof(crypto, proof, table.id, { ...bound, nonce: 'nonce-bbbbbbbbbbbbbbbb' })).toBe(false);
    expect(await checkTableProof(crypto, { ...proof, personId: 'person-2' }, table.id, bound)).toBe(false);
  });

  it('fail when signed for another host or another device: a relayed proof is worthless', async () => {
    const table = await testTable();
    const proof = await makeTableProof(crypto, table, bound, 'person-1', 'Morgan');
    expect(await checkTableProof(crypto, proof, table.id, { ...bound, hostId: 'host-2' })).toBe(false);
    expect(await checkTableProof(crypto, proof, table.id, { ...bound, deviceId: 'E'.repeat(43) })).toBe(false);
  });

  it('fail for a key that does not hash to the table id, even when signed with it', async () => {
    const real = await testTable();
    const fake = await testTable();
    // A fake GM signs with its own key but claims the real table id.
    const forged = { ...(await makeTableProof(crypto, fake, bound, 'p', 'GM')), id: real.id };
    expect(await checkTableProof(crypto, forged, real.id, bound)).toBe(false);
  });
});

describe('Web Crypto', () => {
  it('signs what node verifies and the other way round, with the same key ids', async () => {
    const web = await webIdentityCrypto.generate();
    const node = await crypto.generate();
    expect(await webIdentityCrypto.keyId(web.publicKey)).toBe(await crypto.keyId(web.publicKey));
    expect(await crypto.verify(web.publicKey, 'hello', await webIdentityCrypto.sign(web.privateKey, 'hello'))).toBe(true);
    expect(await webIdentityCrypto.verify(node.publicKey, 'hello', await crypto.sign(node.privateKey, 'hello'))).toBe(true);
    expect(await webIdentityCrypto.verify(node.publicKey, 'hellO', await crypto.sign(node.privateKey, 'hello'))).toBe(false);
    expect(await webIdentityCrypto.verify('%%%', 'hello', 'AAAA')).toBe(false);
  });
});
