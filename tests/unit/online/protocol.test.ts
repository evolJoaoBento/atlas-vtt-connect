import { describe, expect, it } from 'vitest';
import {
  decodeControl, encodeControl, normalizePlayerName, MAX_CONTROL_MESSAGE_BYTES, MAX_CONTROLLED_TOKENS, PLAYER_MESSAGE_TYPES, type ControlMessage,
} from '../../../src/app/online/protocol';
import { randomId } from '../../../src/app/online/ids';
import { isPhysicalRoll } from '../../../src/app/online/tools/toolMessages';

describe('online protocol', () => {
  it('round-trips every message type', () => {
    const messages: ControlMessage[] = [
      { v: 1, type: 'join', name: 'Anna', playerKey: 'k1', client: { kind: 'web', version: '0.5.0' } },
      { v: 1, type: 'admitted', playerId: 'p1', session: { title: 'Vault' } },
      { v: 1, type: 'denied', reason: 'kicked' },
      { v: 1, type: 'presence', players: [{ playerId: 'p1', name: 'Anna', connected: true }] },
      { v: 1, type: 'ping', t: 5 },
      { v: 1, type: 'pong', t: 5 },
      { v: 1, type: 'bye', reason: 'ended' },
    ];
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('refuses another protocol version', () => {
    expect(decodeControl(JSON.stringify({ v: 2, type: 'ping', t: 1 }))).toEqual({ kind: 'version' });
  });

  it('ignores types it does not know, for newer peers', () => {
    expect(decodeControl(JSON.stringify({ v: 1, type: 'snapshot', scene: {} }))).toEqual({ kind: 'ignored' });
  });

  it('ignores prototype keys and does not throw', () => {
    expect(decodeControl(JSON.stringify({ v: 1, type: '__proto__' }))).toEqual({ kind: 'ignored' });
    expect(decodeControl(JSON.stringify({ v: 1, type: 'constructor' }))).toEqual({ kind: 'ignored' });
    expect(decodeControl(JSON.stringify({ v: 1, type: 'toString' }))).toEqual({ kind: 'ignored' });
  });

  it('rejects malformed input', () => {
    expect(decodeControl('not json').kind).toBe('invalid');
    expect(decodeControl(42).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'denied', reason: 'bored' })).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'join', name: 'A', playerKey: 7, client: { kind: 'web', version: '1' } })).kind).toBe('invalid');
    expect(decodeControl(JSON.stringify({ v: 1, type: 'presence', players: [{ playerId: 'p', name: 'A' }] })).kind).toBe('invalid');
  });

  it('rejects oversized messages', () => {
    const big = JSON.stringify({ v: 1, type: 'bye', reason: 'x'.repeat(MAX_CONTROL_MESSAGE_BYTES) });
    expect(decodeControl(big)).toEqual({ kind: 'invalid', reason: 'too-large' });
  });

  it('rejects messages that are large in UTF-8 bytes even if under UTF-16 limit', () => {
    // 'é' is 1 UTF-16 unit but 2 UTF-8 bytes; 131073 repetitions = 131073 UTF-16 units but 262146 UTF-8 bytes
    const byteOversize = JSON.stringify({ v: 1, type: 'bye', reason: 'é'.repeat(131073) });
    expect(decodeControl(byteOversize)).toEqual({ kind: 'invalid', reason: 'too-large' });
  });

  it('normalizes player names and refuses empty ones', () => {
    expect(normalizePlayerName('  Anna   the\tBold  ')).toBe('Anna the Bold');
    expect(normalizePlayerName('Jo\u0000hn')).toBe('John');
    expect(normalizePlayerName('Bob\u0000\u0007')).toBe('Bob');
    expect(normalizePlayerName('G\u200BM')).toBe('GM');
    expect(normalizePlayerName('\u202EAnna\u2060 \ufeffB')).toBe('Anna B');
    expect(normalizePlayerName('\u200B\u200F')).toBeNull();
    expect(normalizePlayerName('   ')).toBeNull();
    expect(normalizePlayerName(12)).toBeNull();
    expect(normalizePlayerName('x'.repeat(41))).toBeNull();
    expect(normalizePlayerName('<b>Eve</b>')).toBe('<b>Eve</b>'); // kept as text; the UI never renders HTML
  });

  it('makes long unguessable ids', () => {
    const a = randomId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(randomId()).not.toBe(a);
  });

  it('round-trips the token control, move and refusal messages', () => {
    const messages: ControlMessage[] = [
      { v: 1, type: 'token-control', tokenIds: ['hero', 'ally'] },
      { v: 1, type: 'token-control', tokenIds: [] },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: 12.5, y: -3 },
      { v: 1, type: 'token-move-refused', tokenId: 'hero' },
    ];
    for (const message of messages) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('refuses malformed token messages', () => {
    const tooMany = Array.from({ length: MAX_CONTROLLED_TOKENS + 1 }, (_, index) => `t${index}`);
    const bad = [
      { v: 1, type: 'token-control', tokenIds: tooMany },
      { v: 1, type: 'token-control', tokenIds: ['__proto__'] },
      { v: 1, type: 'token-control', tokenIds: 'hero' },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: '1', y: 0 },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: null, y: 0 },
      { v: 1, type: 'token-move', tokenId: 'hero', x: 1, y: 0 },
      { v: 1, type: 'token-move', sceneId: 's1', tokenId: '', x: 1, y: 0 },
      { v: 1, type: 'token-move-refused', tokenId: 'x'.repeat(129) },
    ];
    for (const message of bad) {
      expect(decodeControl(JSON.stringify(message)), JSON.stringify(message).slice(0, 80)).toEqual({
        kind: 'invalid', reason: `bad-${message.type}`,
      });
    }
  });

  it('decodes a move whose coordinate JSON reads as Infinity, so the GM refuses it instead of counting it invalid', () => {
    expect(decodeControl('{"v":1,"type":"token-move","sceneId":"s1","tokenId":"hero","x":1e400,"y":0}')).toEqual({
      kind: 'message', message: { v: 1, type: 'token-move', sceneId: 's1', tokenId: 'hero', x: Infinity, y: 0 },
    });
  });

  it('names what players may send: a resync, a token move, a dice roll, a laser, a roll from their sheet, a ping, a template, a pin they open and the 3D board', () => {
    expect([...PLAYER_MESSAGE_TYPES].sort()).toEqual(['board-request', 'dice-result', 'dice-roll', 'laser', 'map-ping', 'map-template', 'note-request', 'scene-resync', 'sheet-roll', 'token-move']);
  });

  describe('dice-result and the dice offer', () => {
    const decode = (message: unknown) => decodeControl(JSON.stringify({ v: 1, type: 'dice-result', ...(message as object) }));
    const ok = { rolls: [{ die: 'd6', value: 3 }, { die: 'd6', value: 6 }], modifier: 2 };

    it('accepts a roll of 2d6, a d100 as one value, tags, a label and a sheet roll', () => {
      expect(decode(ok).kind).toBe('message');
      expect(decode({ rolls: [{ die: 'd100', value: 100 }, { die: 'd10', value: 10, exploded: true, dropped: true, color: '#aabbcc', colorName: 'Red' }], modifier: -999, label: 'x'.repeat(120) }).kind).toBe('message');
      expect(decode({ ...ok, sheet: { tokenId: 't1', roll: { kind: 'check', index: 1 } } }).kind).toBe('message');
      expect(PLAYER_MESSAGE_TYPES.has('dice-result')).toBe(true);
    });

    it('refuses what is not a read roll', () => {
      const bad: unknown[] = [
        { ...ok, rolls: [] },
        { ...ok, rolls: Array.from({ length: 21 }, () => ({ die: 'd6', value: 1 })) },
        { ...ok, rolls: [{ die: 'd6', value: 0 }] },
        { ...ok, rolls: [{ die: 'd6', value: 7 }] },
        { ...ok, rolls: [{ die: 'd100', value: 101 }] },
        { ...ok, rolls: [{ die: 'd100', value: 0 }] },
        { ...ok, rolls: [{ die: 'd6', value: Number.NaN }] },
        { ...ok, rolls: [{ die: 'd6', value: 2.5 }] },
        { ...ok, rolls: [{ die: 'd3', value: 1 }] },
        { ...ok, modifier: 1000 },
        { ...ok, modifier: -1000 },
        { ...ok, modifier: 1.5 },
        { ...ok, label: 'x'.repeat(121) },
        { ...ok, rolls: [{ die: 'd6', value: 1, color: 'red' }] },
        { ...ok, sheet: { tokenId: 't1', roll: { kind: 'nope' } } },
      ];
      for (const message of bad) expect(decode(message).kind, JSON.stringify(message)).toBe('invalid');
    });

    it('refuses rolls that are not a list of dice, dice that are not objects, unknown dice kinds and false flags', () => {
      const bad: unknown[] = [
        { ...ok, rolls: { 0: { die: 'd6', value: 3 }, length: 1 } },
        { ...ok, rolls: 'd6' },
        { ...ok, rolls: [3] },
        { ...ok, rolls: [null] },
        { ...ok, rolls: [[{ die: 'd6', value: 3 }]] },
        { ...ok, rolls: [{ die: '__proto__', value: 1 }] },
        { ...ok, rolls: [{ die: 'toString', value: 1 }] },
        { ...ok, rolls: [{ die: 'd6', value: 3, exploded: false }] },
        { ...ok, rolls: [{ die: 'd6', value: 3, dropped: false }] },
        { ...ok, rolls: [{ die: 'd6', value: 3, negative: 'yes' }] },
      ];
      for (const message of bad) expect(decode(message).kind, JSON.stringify(message)).toBe('invalid');
      // JSON carries no Infinity: the check itself refuses it.
      expect(isPhysicalRoll({ ...ok, modifier: Number.POSITIVE_INFINITY })).toBe(false);
      expect(isPhysicalRoll({ ...ok, rolls: [{ die: 'd6', value: Number.POSITIVE_INFINITY }] })).toBe(false);
      expect(isPhysicalRoll({ ...ok, rolls: [{ die: 'd6', value: Number.NEGATIVE_INFINITY }] })).toBe(false);
      expect(isPhysicalRoll(ok)).toBe(true);
    });

    it('an older page ignores dice-result', () => {
      const older = new Set(['ping']);
      expect(decodeControl(JSON.stringify({ v: 1, type: 'dice-result', ...ok }), older).kind).toBe('ignored');
    });

    it('reads board-offer with and without the dice fields', () => {
      const offer = (extra: object) => decodeControl(JSON.stringify({ v: 1, type: 'board-offer', available: true, ...extra })).kind;
      expect(offer({})).toBe('message');
      expect(offer({ diceResults: true, diceRules: { defaultRoll: '1d20', crit: 'natural' } })).toBe('message');
      expect(offer({ diceRules: { defaultRoll: '2d6', crit: 'none', explode: { dice: 'all', repeats: true, highFaces: 1, lowFaces: 0 } } })).toBe('message');
    });

    it('drops bad dice fields from a board-offer and keeps the offer', () => {
      const read = (extra: object) => decodeControl(JSON.stringify({ v: 1, type: 'board-offer', available: true, ...extra }));
      const rules = { defaultRoll: '1d20', crit: 'natural' };
      expect(read({ diceResults: false, diceRules: { defaultRoll: '1d20', crit: 'sometimes' } })).toEqual({ kind: 'message', message: { v: 1, type: 'board-offer', available: true } });
      expect(read({ diceRules: 'x', diceResults: true })).toEqual({ kind: 'message', message: { v: 1, type: 'board-offer', available: true, diceResults: true } });
      expect(read({ diceResults: 1, diceRules: rules })).toEqual({ kind: 'message', message: { v: 1, type: 'board-offer', available: true, diceRules: rules } });
      expect(read({ available: 'yes' }).kind).toBe('invalid');
    });
  });
});
