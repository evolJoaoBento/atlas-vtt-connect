/**
 * A received map payload as the saved map Atlas writes (`SavedMapInput`), pointing only at files the receiver
 * wrote: the images it saved and the notes it pulled (or pulled before). Every other path is cleared: any
 * string under a path key (`notePath`, `imagePath`, `notePaths`, an audio's `path`, the `background`, any
 * future `*Path`) goes unless allowed, and so does any other string naming a file of the receiver's vault, so a
 * crafted map can never point at (and later re-share) the receiver's own files. Only the fields of `SavedMapInput`
 * are built, one by one: nothing else in a payload reaches Atlas, and no lighting ever does, so a received map
 * is unlit. Atlas writes no pins, walls or lights for a new scene, so pins arrive as token note links only.
 */
import type { GridState, SavedMapInput, TokenEntity } from '@atlas-vtt/api-types';
import { atlasWidgets } from '../../obsidian/convertPanels';
import { playerSceneRecords } from '../../obsidian/playerSceneRecords';
import { setOwn } from '../../scene/sceneDiff';
import { createDefaultInitiativeState } from '../../../types/initiativeDefaults';
import { PATH_KEY, replaceStrings } from '../model/buildMapPayload';
import { IMAGE_REF_PREFIX, NOTE_REF_PREFIX, type FullMapPayload, type MapPayload, type PlayerSafeMapPayload } from '../model/mapPayload';

export interface ReceivedMapContext {
  /** Fingerprint → how the map names that image: its path in the upload, or the vault path of the one saved before. */
  images: ReadonlyMap<string, string>;
  /** Item id → the vault path of that note on the receiver's side, pulled now or before. */
  notes: ReadonlyMap<string, string>;
  /** Whether a string is a path of the receiver's vault. */
  isFile: (path: string) => boolean;
}

type Records = Record<string, Record<string, unknown>>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The records of a kind: only entries that are records themselves, each under its own key. */
function records(value: unknown): Records {
  const result: Records = {};
  if (isRecord(value)) for (const [id, record] of Object.entries(value)) if (isRecord(record)) setOwn(result, id, record);
  return result;
}

function numbers(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (isRecord(value)) for (const [id, number] of Object.entries(value)) if (typeof number === 'number' && Number.isFinite(number)) setOwn(result, id, number);
  return result;
}

function fromPlayerSafe(payload: PlayerSafeMapPayload, context: ReceivedMapContext): SavedMapInput {
  const image = (id: string | null): string | null => (id ? context.images.get(id) ?? null : null);
  const scene = playerSceneRecords(payload.scene, { background: image, token: image });
  const tokens: Record<string, TokenEntity> = { ...scene.objects.tokens };
  for (const [id, note] of Object.entries(payload.tokenNotes)) {
    const path = context.notes.get(note);
    const token = Object.hasOwn(tokens, id) ? tokens[id] : undefined;
    if (path && token) setOwn(tokens, id, { ...token, notePath: path });
  }
  return { background: scene.background, grid: scene.grid, objects: { ...scene.objects, tokens }, widgets: scene.widgets, initiative: scene.initiative };
}

function fromFull(payload: FullMapPayload, context: ReceivedMapContext): SavedMapInput {
  // Rebuilt with own properties only (`Object.fromEntries`), so a `__proto__` key in the payload stays a plain key.
  const map = replaceStrings(payload.map, (text) => {
    if (text.startsWith(IMAGE_REF_PREFIX)) return context.images.get(text.slice(IMAGE_REF_PREFIX.length)) ?? '';
    if (text.startsWith(NOTE_REF_PREFIX)) return context.notes.get(text.slice(NOTE_REF_PREFIX.length)) ?? '';
    return text;
  }) as Record<string, unknown>;
  const objects = isRecord(map.objects) ? map.objects : {};
  return {
    background: typeof map.background === 'string' && map.background ? map.background : null,
    grid: isRecord(map.grid) ? (map.grid as unknown as GridState) : null,
    objects: {
      tokens: records(objects.tokens) as unknown as SavedMapInput['objects']['tokens'],
      texts: records(objects.texts) as unknown as SavedMapInput['objects']['texts'],
      drawings: records(objects.drawings) as unknown as SavedMapInput['objects']['drawings'],
      fog: records(objects.fog) as unknown as SavedMapInput['objects']['fog'],
    },
    widgets: {
      settings: { ...atlasWidgets([]).widgetSettings, ...(isRecord(map.widgetSettings) ? map.widgetSettings : {}) },
      values: numbers(map.widgetValues),
    },
    initiative: { ...createDefaultInitiativeState(), ...(isRecord(map.initiative) ? map.initiative : {}) },
  };
}

/** Clears every path not allowed (by key, or because it names a file here); a token's cleared note link goes, its cleared art stays empty. */
export function clearForeignPaths(map: SavedMapInput, allowed: ReadonlySet<string>, isFile: (path: string) => boolean): SavedMapInput {
  const swept = replaceStrings(map, (text, underPathKey) => (allowed.has(text) || !(underPathKey || isFile(text)) ? text : '')) as SavedMapInput;
  const tokens: Record<string, TokenEntity> = {};
  for (const [id, token] of Object.entries(swept.objects.tokens)) {
    const kept = Object.entries(token).filter(([key, value]) => !(PATH_KEY.test(key) && value === '' && key !== 'imagePath'));
    setOwn(tokens, id, Object.fromEntries(kept));
  }
  return { ...swept, background: swept.background || null, objects: { ...swept.objects, tokens } };
}

export function receivedMapInput(payload: MapPayload, context: ReceivedMapContext): SavedMapInput {
  const body = payload.mode === 'player-safe' ? fromPlayerSafe(payload, context) : fromFull(payload, context);
  const allowed = new Set([...context.images.values(), ...context.notes.values()]);
  return clearForeignPaths(body, allowed, context.isFile);
}
