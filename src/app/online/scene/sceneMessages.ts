/** Scene messages before each player's `seq` is set, kept under the control channel's size limit. */
import { MAX_CONTROL_MESSAGE_BYTES, type ControlMessage, type SceneLookMessage, type SceneStateMessage } from '../protocol';
import { sortedByOrder, type PlayerScene, type ScenePatchBody } from './sceneTypes';

type SceneMessage = Extract<
  ControlMessage,
  { type: 'scene-snapshot' | 'scene-fog' | 'scene-drawings' | 'scene-patch' | 'scene-clear' }
>;
type Unsequenced<M> = M extends unknown ? Omit<M, 'seq'> : never;

/** A scene message without its per-player `seq`. */
export type SceneOutgoing = Unsequenced<SceneMessage>;

/** Room left in every message for its `seq`. */
const ENVELOPE_BYTES = 64;
export const MESSAGE_BUDGET_BYTES = MAX_CONTROL_MESSAGE_BYTES - ENVELOPE_BYTES;
/** One fog or drawing part's records; a single record (at most 5 000 points) stays well under it. */
export const PART_BUDGET_BYTES = 192 * 1024;

const encoder = new TextEncoder();

/** UTF-8 size of `value` as JSON, as the player's decoder measures it. */
export function byteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Records in replay order, split into parts of at most `budget` bytes. */
export function splitParts<T>(
  records: Readonly<Record<string, T>>,
  orderOf: (record: T) => number,
  budget: number = PART_BUDGET_BYTES,
): Array<Record<string, T>> {
  const parts: Array<Record<string, T>> = [];
  let part: Record<string, T> = {};
  let size = 0;
  let count = 0;
  for (const [id, record] of sortedByOrder(records, orderOf)) {
    const recordSize = byteLength(record) + byteLength(id) + 2;
    if (count > 0 && size + recordSize > budget) {
      parts.push(part);
      part = {};
      size = 0;
      count = 0;
    }
    part[id] = record;
    size += recordSize;
    count++;
  }
  if (count > 0) parts.push(part);
  return parts;
}

/**
 * A snapshot without fog and drawings, then their parts; null when any message
 * would exceed the limit (in practice: the rest of the scene alone is too large).
 */
export function snapshotMessages(scene: PlayerScene): SceneOutgoing[] | null {
  const { fog, drawings, ...body } = scene;
  const fogParts = splitParts(fog, (op) => op.order);
  const drawingParts = splitParts(drawings, (drawing) => drawing.order);
  const messages: SceneOutgoing[] = [
    { v: 1, type: 'scene-snapshot', scene: body, fogParts: fogParts.length, drawingParts: drawingParts.length },
    ...fogParts.map((records, part): SceneOutgoing => ({ v: 1, type: 'scene-fog', part, records })),
    ...drawingParts.map((records, part): SceneOutgoing => ({ v: 1, type: 'scene-drawings', part, records })),
  ];
  return messages.every((message) => byteLength(message) <= MESSAGE_BUDGET_BYTES) ? messages : null;
}

/** A patch message; null when it would exceed the limit, so a snapshot is sent instead. */
export function patchMessage(patch: ScenePatchBody): SceneOutgoing | null {
  const message: SceneOutgoing = { v: 1, type: 'scene-patch', set: patch.set, upsert: patch.upsert, remove: patch.remove };
  return byteLength(message) <= MESSAGE_BUDGET_BYTES ? message : null;
}

/** Tells a scene's players it is paused or live again. Unsequenced: send it with `session.send`, never on a sequenced channel. */
export function sceneStateMessage(sceneId: string, paused: boolean): SceneStateMessage {
  return { v: 1, type: 'scene-state', sceneId, paused };
}

/** Tells a scene's players the dice look of its collection (null: none). Unsequenced, like `sceneStateMessage`. */
export function sceneLookMessage(sceneId: string, look: string | null): SceneLookMessage {
  return { v: 1, type: 'scene-look', sceneId, look };
}
