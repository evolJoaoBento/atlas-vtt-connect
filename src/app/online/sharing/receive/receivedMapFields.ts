/**
 * The saved map fields of API 1.13.0 (pins, walls, lights, light zones, camera, token settings and the tracker) as a
 * received map hands them to Atlas. Atlas's `addToCollection` refuses the whole map for one malformed field, so each
 * is rebuilt here from what it may hold, failing closed: a field that cannot be read is left out (Atlas writes what a
 * new map has), a pin is kept only with a note the receiver has, and a pin's `gmOnly` that is set at all stays set.
 * An older Atlas ignores these fields.
 */
import type { NotePin, SavedMapInput, TokenSettings } from '@atlas-vtt/api-types';
import { setOwn } from '../../scene/sceneDiff';

export type MapFields = Pick<SavedMapInput, 'pins' | 'walls' | 'lights' | 'lightZones' | 'camera' | 'tokenSettings' | 'initiativeTrackerOpen'>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The entries of a record that are records themselves, each under its own key; undefined when `value` is no record. */
export function recordsOf<T>(value: unknown): Record<string, T> | undefined {
  if (!isRecord(value)) return undefined;
  const result: Record<string, T> = {};
  for (const [id, entry] of Object.entries(value)) if (isRecord(entry)) setOwn(result, id, entry);
  return result;
}

/** The pins Atlas accepts (its `checkedPin`) whose note path is one the receiver wrote (`allowed`); the others are dropped. */
export function receivedPins(value: unknown, allowed: ReadonlySet<string>): Record<string, NotePin> {
  const pins: Record<string, NotePin> = {};
  for (const [key, pin] of Object.entries(recordsOf<Record<string, unknown>>(value) ?? {})) {
    const { id, kind, x, y, notePath, icon, label, gmOnly, hex } = pin;
    if (typeof id !== 'string' || kind !== 'pin' || !isFiniteNumber(x) || !isFiniteNumber(y) || typeof notePath !== 'string' || !allowed.has(notePath)) continue;
    setOwn(pins, key, {
      id, kind, x, y, notePath,
      ...(typeof icon === 'string' ? { icon } : {}), ...(typeof label === 'string' ? { label } : {}),
      ...(gmOnly !== undefined && gmOnly !== false ? { gmOnly: true } : {}), ...(typeof hex === 'boolean' ? { hex } : {}),
    });
  }
  return pins;
}

function camera(value: unknown): MapFields['camera'] | undefined {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y) || !isFiniteNumber(value.scale) || value.scale <= 0) return undefined;
  return { x: value.x, y: value.y, scale: value.scale };
}

/** The four token settings Atlas knows, each of the right type; the rest are Atlas's defaults. */
function tokenSettings(value: unknown): Partial<TokenSettings> | undefined {
  if (!isRecord(value)) return undefined;
  const { showNameplates, hiddenResources, showInstanceBadges, tokenRingSize } = value;
  return {
    ...(typeof showNameplates === 'boolean' ? { showNameplates } : {}),
    ...(Array.isArray(hiddenResources) && hiddenResources.every((key) => typeof key === 'string') ? { hiddenResources: [...hiddenResources] as string[] } : {}),
    ...(typeof showInstanceBadges === 'boolean' ? { showInstanceBadges } : {}),
    ...(isFiniteNumber(tokenRingSize) && tokenRingSize > 0 ? { tokenRingSize } : {}),
  };
}

/**
 * The fields of a full map's body: pins, walls, lights and light zones from its objects, the rest beside them. The
 * pins are only records here; `receivedPins` keeps those Atlas accepts once their paths are cleared.
 */
export function fullMapFields(map: Record<string, unknown>): MapFields {
  const objects = isRecord(map.objects) ? map.objects : {};
  const walls = recordsOf<NonNullable<MapFields['walls']>[string]>(objects.walls);
  const lights = recordsOf<NonNullable<MapFields['lights']>[string]>(objects.lights);
  const lightZones = recordsOf<NonNullable<MapFields['lightZones']>[string]>(objects.lightZones);
  const view = camera(map.camera);
  const settings = tokenSettings(map.tokenSettings);
  return {
    pins: recordsOf<NotePin>(objects.pins) ?? {},
    ...(walls ? { walls } : {}), ...(lights ? { lights } : {}), ...(lightZones ? { lightZones } : {}),
    ...(view ? { camera: view } : {}), ...(settings ? { tokenSettings: settings } : {}),
    ...(map.initiativeTrackerOpen === true ? { initiativeTrackerOpen: true } : {}),
  };
}
