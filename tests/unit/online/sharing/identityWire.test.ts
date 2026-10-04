import { describe, expect, it } from 'vitest';
import { buildJoinUrl, parseJoinFragment, parseJoinLink } from '../../../../src/app/online/joinLink';
import { DEFAULT_ONLINE_SETTINGS } from '../../../../src/app/online/onlineSettings';
import { decodeControl, encodeControl } from '../../../../src/app/online/protocol';

const TABLE = 'T'.repeat(43);
const KEY = 'K'.repeat(120);
const SIG = 'S'.repeat(86);
const NONCE = 'N'.repeat(22);

describe('join links with a table', () => {
  it('carry the table id after the host id and read it back', () => {
    const url = buildJoinUrl('https://example.org/atlas/', 'gm1', DEFAULT_ONLINE_SETTINGS, TABLE);
    expect(url).toBe(`https://example.org/atlas/#id=gm1&table=${TABLE}`);
    expect(parseJoinLink(url)).toMatchObject({ hostId: 'gm1', tableId: TABLE });
  });

  it('ignore a malformed table id and still join', () => {
    expect(parseJoinFragment('#id=gm1&table=short')).toMatchObject({ hostId: 'gm1', tableId: null });
    expect(parseJoinFragment(`#id=gm1&table=${TABLE}!`)).toMatchObject({ tableId: null });
    expect(buildJoinUrl('https://example.org/', 'gm1', DEFAULT_ONLINE_SETTINGS, 'bad')).toBe('https://example.org/#id=gm1');
  });

  it('still parse as the web page does: host and servers unchanged', () => {
    expect(parseJoinFragment(`#id=gm1&table=${TABLE}`)?.hostId).toBe('gm1');
    expect(parseJoinFragment('#id=gm1')).toMatchObject({ hostId: 'gm1', tableId: null });
  });
});

describe('identity fields on the wire', () => {
  const join = (device: unknown): string => JSON.stringify({
    v: 1, type: 'join', name: 'Ana', playerKey: 'k', client: { kind: 'obsidian', version: '1' }, ...(device === undefined ? {} : { device }),
  });

  it('accept a join with or without a well-formed device proof', () => {
    expect(decodeControl(join(undefined)).kind).toBe('message');
    expect(decodeControl(join({ table: TABLE, key: KEY, nonce: NONCE, sig: SIG }))).toMatchObject({ kind: 'message' });
    expect(decodeControl(join({ table: 'x', key: KEY, nonce: NONCE, sig: SIG }))).toEqual({ kind: 'invalid', reason: 'bad-join' });
    expect(decodeControl(join({ table: TABLE, key: 'K'.repeat(400), nonce: NONCE, sig: SIG }))).toEqual({ kind: 'invalid', reason: 'bad-join' });
    expect(decodeControl(join('device'))).toEqual({ kind: 'invalid', reason: 'bad-join' });
  });

  it('accept an admission with a table proof and presence with person ids', () => {
    const table = { id: TABLE, key: KEY, personId: 'p_1', gmName: 'Morgan', sig: SIG };
    expect(decodeControl(encodeControl({ v: 1, type: 'admitted', playerId: 'x', session: { title: 'V' }, table })).kind).toBe('message');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'admitted', playerId: 'x', session: { title: 'V' }, table: { ...table, personId: 'bad id' } })).kind)
      .toBe('invalid');
    expect(decodeControl(encodeControl({ v: 1, type: 'presence', players: [{ playerId: 'a', name: 'Ana', connected: true, personId: 'p_1' }] })).kind)
      .toBe('message');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'presence', players: [{ playerId: 'a', name: 'Ana', connected: true, personId: 7 }] })).kind)
      .toBe('invalid');
  });
});
