/**
 * The online play wire format. Shared with the web player page, so this file
 * imports nothing but the scene wire format beside it: no Obsidian, no PIXI, no PeerJS.
 */
import type { SceneCamera } from './scene/sceneCamera';
import type { DiceSelection } from '@atlas-vtt/shared/rules';
import type { PlayerDrawing, PlayerFogOp, PlayerSceneBody, ScenePatchBody, ScenePoint } from './scene/sceneTypes';
import {
  isDrawingRecords, isFogRecords, isLastSeq, isPlayerSceneBody, isSceneCamera, isSceneCount, isSceneId, isSceneLook, isScenePatchBody, isSceneSeq, isSceneState,
} from './scene/sceneValidation';
import { cleanLoggedEntries, isDiceLogEntries, isDiceModifier, isDiceSelection, isLaserColor, isLaserPoints, isLaserTimes, type DiceLogEntry } from './tools/toolMessages';
export const PROTOCOL_VERSION = 1;
export const MAX_CONTROL_MESSAGE_BYTES = 256 * 1024;
export const MAX_PLAYER_NAME_LENGTH = 40;
/** The most tokens one player may control, and so the longest `token-control` list. */
export const MAX_CONTROLLED_TOKENS = 256;

/** A player's device key, proven for one GM table and host: its id is the device id. Sent by Obsidian players only. */
export interface DeviceProof {
  /** The table id from the join link. */
  table: string;
  /** Base64url SPKI of the device key. */
  key: string;
  /** Random, one per join; the GM's table proof signs it. */
  nonce: string;
  /** Base64url signature of `atlas-device-v1|table|host id|nonce`. */
  sig: string;
}

/** The GM's table, proven to one joining player: it signs their nonce and the person id it gives them. */
export interface TableProof {
  id: string;
  key: string;
  personId: string;
  gmName: string;
  sig: string;
}

const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PERSON_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const B64_PATTERN = /^[A-Za-z0-9_-]{1,200}$/;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** A table or device id: base64url SHA-256, 43 characters. */
export const isKeyId = (value: unknown): value is string => typeof value === 'string' && KEY_ID_PATTERN.test(value);
/** A person id the GM gives (`randomId()`), or `gm`. */
export const isPersonId = (value: unknown): value is string => typeof value === 'string' && PERSON_ID_PATTERN.test(value);
const isB64 = (value: unknown): value is string => typeof value === 'string' && B64_PATTERN.test(value);

export type DenyReason = 'denied' | 'kicked' | 'full' | 'version' | 'ended';
const DENY_REASONS: readonly DenyReason[] = ['denied', 'kicked', 'full', 'version', 'ended'];

export interface PresencePlayer {
  playerId: string;
  name: string;
  connected: boolean;
  /** The person the GM admitted them as; absent for web players. */
  personId?: string;
}

/**
 * GM to the players of one scene: whether it is paused (the GM is on another scene, so moves are refused) or live.
 * Unsequenced, like `scene-camera`: sent with `session.send`, never on the sequenced scene channel, so an older
 * page that ignores it sees no gap in its `seq` run. Scoped by `sceneId`: a page ignores it for any other scene.
 */
export interface SceneStateMessage { v: 1; type: 'scene-state'; sceneId: string; paused: boolean }

/**
 * GM to the players of one scene: the dice look of that scene's collection (a full look id, as Atlas's
 * `dice.lookFor` answers it), or null for none. Unsequenced, like `scene-state`, and scoped by `sceneId`. A page or
 * player that does not know it ignores it; the web page has no extension looks, and ignores the id.
 */
export interface SceneLookMessage { v: 1; type: 'scene-look'; sceneId: string; look: string | null }

export type ControlMessage =
  | { v: 1; type: 'join'; name: string; playerKey: string; client: { kind: 'web' | 'obsidian'; version: string }; device?: DeviceProof }
  | { v: 1; type: 'admitted'; playerId: string; session: { title: string }; table?: TableProof }
  | { v: 1; type: 'denied'; reason: DenyReason }
  | { v: 1; type: 'presence'; players: PresencePlayer[] }
  | { v: 1; type: 'ping'; t: number }
  | { v: 1; type: 'pong'; t: number }
  | { v: 1; type: 'bye'; reason: string }
  | { v: 1; type: 'scene-snapshot'; seq: number; scene: PlayerSceneBody; fogParts: number; drawingParts: number }
  | { v: 1; type: 'scene-fog'; seq: number; part: number; records: Record<string, PlayerFogOp> }
  | { v: 1; type: 'scene-drawings'; seq: number; part: number; records: Record<string, PlayerDrawing> }
  | {
    v: 1; type: 'scene-patch'; seq: number;
    set: ScenePatchBody['set']; upsert: ScenePatchBody['upsert']; remove: ScenePatchBody['remove'];
  }
  | { v: 1; type: 'scene-clear'; seq: number }
  | { v: 1; type: 'scene-resync'; seq: number }
  | ({ v: 1; type: 'scene-camera' } & SceneCamera)
  | SceneStateMessage
  | SceneLookMessage
  /** GM to one player: the tokens that player may move, for this session. */
  | { v: 1; type: 'token-control'; tokenIds: string[] }
  /** Player to GM, once per drop: where the player let go of one of their tokens, in world units. */
  | { v: 1; type: 'token-move'; sceneId: string; tokenId: string; x: number; y: number }
  /** GM to the player who sent the move: it failed a check, so the token stays where the scene has it. */
  | { v: 1; type: 'token-move-refused'; tokenId: string }
  /** Player to GM: a roll from the dice tray, rolled on the GM's side. */
  | { v: 1; type: 'dice-roll'; dice: DiceSelection; modifier: number }
  /** GM to players: dice log entries, newest first; `replay` replaces a player's log (sent on every admission). */
  | { v: 1; type: 'dice-log'; entries: DiceLogEntry[]; replay: boolean }
  /**
   * New points of someone's laser, in world units. Players send it without `from`; the GM relays
   * it with `from`, the sender's session id (`gm` for the GM's own). `dt` times the points: the
   * milliseconds from each to the one before it in the stroke, so receivers can play the motion back smoothly.
   */
  | { v: 1; type: 'laser'; sceneId: string; points: ScenePoint[]; lifted: boolean; dt?: number[]; color?: string; from?: string };

/** What an admitted player may send besides `ping`, `pong` and `bye`; the GM drops every other type from a player. */
export const PLAYER_MESSAGE_TYPES: ReadonlySet<ControlMessage['type']> = new Set<ControlMessage['type']>([
  'scene-resync', 'token-move', 'dice-roll', 'laser',
]);

export type Decoded =
  | { kind: 'message'; message: ControlMessage }
  | { kind: 'ignored' }
  | { kind: 'version' }
  | { kind: 'invalid'; reason: string };

type Fields = Record<string, unknown>;

const isString = (value: unknown, max = 1024): value is string => typeof value === 'string' && value.length <= max;
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

function isDeviceProof(value: unknown): value is DeviceProof {
  return isRecord(value) && isKeyId(value.table) && isB64(value.key) && typeof value.nonce === 'string'
    && NONCE_PATTERN.test(value.nonce) && isB64(value.sig);
}

function isTableProof(value: unknown): value is TableProof {
  return isRecord(value) && isKeyId(value.id) && isB64(value.key) && isPersonId(value.personId)
    && isString(value.gmName, 200) && isB64(value.sig);
}

/** Checks the fields of each known type; returns whether the shape is right. */
const VALIDATORS: Record<ControlMessage['type'], (m: Fields) => boolean> = {
  join: (m) => isString(m.name, 200) && isString(m.playerKey, 64) && m.playerKey.length > 0
    && isRecord(m.client) && (m.client.kind === 'web' || m.client.kind === 'obsidian') && isString(m.client.version, 32)
    && (m.device === undefined || isDeviceProof(m.device)),
  admitted: (m) => isString(m.playerId, 64) && isRecord(m.session) && isString(m.session.title, 200)
    && (m.table === undefined || isTableProof(m.table)),
  denied: (m) => DENY_REASONS.includes(m.reason as DenyReason),
  presence: (m) => Array.isArray(m.players) && m.players.length <= 64 && m.players.every((p) =>
    isRecord(p) && isString(p.playerId, 64) && isString(p.name, 200) && typeof p.connected === 'boolean'
    && (p.personId === undefined || isPersonId(p.personId))),
  ping: (m) => isNumber(m.t),
  pong: (m) => isNumber(m.t),
  bye: (m) => isString(m.reason, 200),
  'scene-snapshot': (m) => isSceneSeq(m.seq) && isSceneCount(m.fogParts) && isSceneCount(m.drawingParts)
    && isPlayerSceneBody(m.scene),
  'scene-fog': (m) => isSceneSeq(m.seq) && isSceneCount(m.part) && isFogRecords(m.records),
  'scene-drawings': (m) => isSceneSeq(m.seq) && isSceneCount(m.part) && isDrawingRecords(m.records),
  'scene-patch': (m) => isSceneSeq(m.seq) && isScenePatchBody(m),
  'scene-clear': (m) => isSceneSeq(m.seq),
  'scene-resync': (m) => isLastSeq(m.seq),
  'scene-camera': (m) => isSceneCamera(m),
  'scene-state': (m) => isSceneState(m),
  'scene-look': (m) => isSceneLook(m),
  'token-control': (m) => Array.isArray(m.tokenIds) && m.tokenIds.length <= MAX_CONTROLLED_TOKENS
    && m.tokenIds.every((id) => isSceneId(id)),
  // Any number: one JSON reads as Infinity (`1e400`) is the GM's check to refuse, not a broken message.
  'token-move': (m) => isSceneId(m.sceneId) && isSceneId(m.tokenId) && typeof m.x === 'number' && typeof m.y === 'number',
  'token-move-refused': (m) => isSceneId(m.tokenId),
  'dice-roll': (m) => isDiceSelection(m.dice) && isDiceModifier(m.modifier),
  'dice-log': (m) => isDiceLogEntries(m.entries) && typeof m.replay === 'boolean',
  laser: (m) => isSceneId(m.sceneId) && isLaserPoints(m.points) && typeof m.lifted === 'boolean'
    && isLaserTimes(m.dt, m.points) && (m.color === undefined || isLaserColor(m.color)) && (m.from === undefined || isSceneId(m.from)),
};

export function encodeControl(message: ControlMessage): string {
  return JSON.stringify(message);
}

/**
 * One message off the wire. `known` limits the types this decoder reads, as an older client's would be:
 * any other type decodes as `ignored` (the tests use it to replay a message to an older page's table).
 */
export function decodeControl(raw: unknown, known?: ReadonlySet<string>): Decoded {
  if (typeof raw !== 'string') return { kind: 'invalid', reason: 'not-text' };
  if (raw.length > MAX_CONTROL_MESSAGE_BYTES) return { kind: 'invalid', reason: 'too-large' };
  // Check UTF-8 byte length only if string is potentially large
  if (raw.length > MAX_CONTROL_MESSAGE_BYTES / 3) {
    const byteLength = new TextEncoder().encode(raw).length;
    if (byteLength > MAX_CONTROL_MESSAGE_BYTES) return { kind: 'invalid', reason: 'too-large' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'invalid', reason: 'not-json' };
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return { kind: 'invalid', reason: 'no-type' };
  if (parsed.v !== PROTOCOL_VERSION) return { kind: 'version' };
  const type = parsed.type as ControlMessage['type'];
  if (!Object.hasOwn(VALIDATORS, type) || (known !== undefined && !known.has(type))) return { kind: 'ignored' };
  const validate = VALIDATORS[type];
  if (!validate(parsed)) return { kind: 'invalid', reason: `bad-${type}` };
  const message = parsed as unknown as ControlMessage;
  if (message.type === 'dice-log') cleanLoggedEntries(message.entries);
  return { kind: 'message', message };
}

/** A player's display name, cleaned up; null when nothing usable is left or it is too long. */
export function normalizePlayerName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const cleaned = name
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') // delete non-whitespace control chars
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '') // delete zero-width and bidi controls, so "G\u200BM" is "GM"
    .replace(/[\t\n\r]/g, ' ') // replace whitespace control chars with space
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
  return cleaned.length > 0 && cleaned.length <= MAX_PLAYER_NAME_LENGTH ? cleaned : null;
}
