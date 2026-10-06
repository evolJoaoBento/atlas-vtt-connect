import { describe, expect, it } from 'vitest';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, PROTOCOL_VERSION, type ControlMessage } from '../../../src/app/online/protocol';
import { PlayerSceneMirror } from '../../../src/app/online/scene/PlayerSceneMirror';
import { sceneStateMessage } from '../../../src/app/online/scene/sceneMessages';
import { cleanSceneLabel, isDiceLogEntry, type DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { playerScene, playerToken, sceneBody } from './sceneFixtures';

/** The message types Connect 0.1.0-beta.3 knew, copied as they were before `scene-state`: an older page's decoder. */
const BETA_3_TYPES: ReadonlySet<string> = new Set([
  'join', 'admitted', 'denied', 'presence', 'ping', 'pong', 'bye',
  'scene-snapshot', 'scene-fog', 'scene-drawings', 'scene-patch', 'scene-clear', 'scene-resync', 'scene-camera',
  'token-control', 'token-move', 'token-move-refused', 'dice-roll', 'dice-log', 'laser',
]);

const roll: DiceLogEntry = { id: 'r1', name: 'Anna', formula: 'd20', dice: [{ die: 'd20', value: 12 }], modifier: 0, total: 12, at: 5 };
const logMessage = (entry: object): string => JSON.stringify({ v: 1, type: 'dice-log', entries: [entry], replay: false });
const decodedEntry = (entry: object): DiceLogEntry | undefined => {
  const decoded = decodeControl(logMessage(entry));
  return decoded.kind === 'message' && decoded.message.type === 'dice-log' ? decoded.message.entries[0] : undefined;
};

describe('the split party protocol additions', () => {
  it('decodes a well-formed scene-state', () => {
    const message = sceneStateMessage('scene-1', true);
    expect(message).toEqual({ v: 1, type: 'scene-state', sceneId: 'scene-1', paused: true });
    expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    const live: ControlMessage = sceneStateMessage('scene-1', false);
    expect(decodeControl(encodeControl(live))).toEqual({ kind: 'message', message: live });
    // Unsequenced: it carries no seq.
    expect('seq' in message).toBe(false);
  });

  it('rejects a scene-state with a long id or a non-boolean paused', () => {
    const state = (fields: object): string => JSON.stringify({ v: 1, type: 'scene-state', sceneId: 's', paused: false, ...fields });
    expect(decodeControl(state({ sceneId: 'x'.repeat(129) }))).toEqual({ kind: 'invalid', reason: 'bad-scene-state' });
    expect(decodeControl(state({ sceneId: '' })).kind).toBe('invalid');
    expect(decodeControl(state({ sceneId: '__proto__' })).kind).toBe('invalid');
    expect(decodeControl(state({ sceneId: 7 })).kind).toBe('invalid');
    expect(decodeControl(state({ paused: 'yes' })).kind).toBe('invalid');
    expect(decodeControl(state({ paused: 1 })).kind).toBe('invalid');
    expect(decodeControl(state({ paused: undefined })).kind).toBe('invalid');
    expect(decodeControl(state({ sceneId: 'x'.repeat(128) })).kind).toBe('message');
  });

  it('a player may not send scene-state, so the GM drops it', () => {
    expect(PLAYER_MESSAGE_TYPES.has('scene-state')).toBe(false);
  });

  it('an older decoder ignores scene-state and the dice scene', () => {
    expect(decodeControl(encodeControl(sceneStateMessage('scene-1', true)), BETA_3_TYPES)).toEqual({ kind: 'ignored' });
    // The older table still decodes what it knew.
    expect(decodeControl(JSON.stringify({ v: 1, type: 'ping', t: 1 }), BETA_3_TYPES).kind).toBe('message');
    // An older validator takes an entry with a scene label as it is: the field is extra and unread.
    const labelled = { ...roll, scene: 'Cave' };
    expect(isDiceLogEntry(labelled)).toBe(true);
    expect(decodeControl(logMessage(labelled), BETA_3_TYPES).kind).toBe('message');
  });

  it('keeps a clean dice scene label, trimmed', () => {
    expect(decodedEntry({ ...roll, scene: '  Cave  ' })?.scene).toBe('Cave');
    expect(decodedEntry({ ...roll, scene: 'Der Höhleneingang · Süd' })?.scene).toBe('Der Höhleneingang · Süd');
    expect(decodedEntry(roll)).toEqual(roll);
  });

  it('drops a dice scene label with control characters and keeps the roll', () => {
    for (const scene of ['Ca\u0000ve', 'Cave\nfloor', 'Ca‮ve', 'Ca​ve', 'x'.repeat(65), '   ', '', 7, null, { name: 'Cave' }]) {
      const entry = decodedEntry({ ...roll, scene });
      expect(entry, JSON.stringify(scene)).toEqual(roll);
      expect(entry && 'scene' in entry).toBe(false);
    }
    // 64 code points pass, even when some take two UTF-16 units.
    expect(decodedEntry({ ...roll, scene: '🐉'.repeat(64) })?.scene).toBe('🐉'.repeat(64));
    expect(decodedEntry({ ...roll, scene: '🐉'.repeat(65) })).toEqual(roll);
  });

  it('cleans a scene label the same way on the GM side', () => {
    expect(cleanSceneLabel(' Cave ')).toBe('Cave');
    expect(cleanSceneLabel('Ca\u0007ve')).toBeUndefined();
    expect(cleanSceneLabel(42)).toBeUndefined();
  });

  it('PROTOCOL_VERSION is still 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it("an older page's mirror sees snapshot, scene-state and patch and asks for no resync", () => {
    const resyncs: number[] = [];
    const mirror = new PlayerSceneMirror({ sendResync: (seq) => resyncs.push(seq), onChange: () => {} });
    const scene = playerScene({ fog: {}, drawings: {} });
    const feed = (message: ControlMessage): void => {
      // The older page decodes with its own type table: scene-state comes back 'ignored' and never reaches the mirror.
      const decoded = decodeControl(encodeControl(message), BETA_3_TYPES);
      if (decoded.kind !== 'message') return;
      const { message: known } = decoded;
      if (known.type === 'scene-snapshot' || known.type === 'scene-patch') mirror.receive(known);
    };
    feed({ v: 1, type: 'scene-snapshot', seq: 1, scene: sceneBody(scene), fogParts: 0, drawingParts: 0 });
    expect(mirror.scene).not.toBeNull();
    feed(sceneStateMessage(scene.sceneId, true));
    feed({ v: 1, type: 'scene-patch', seq: 2, set: {}, upsert: { tokens: { t1: playerToken({ x: 400 }) } }, remove: {} });
    expect(resyncs).toEqual([]);
    expect(mirror.scene?.tokens.t1?.x).toBe(400);
    mirror.dispose();
  });
});
