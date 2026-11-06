// online-client/ar/arPrefs.mts
/**
 * The player's augmented reality settings, kept in the browser: light enough for the scene switch to read before the
 * AR code loads (it picks room tracking or markers inside the player's tap).
 */

export type Tracking = 'room' | 'markers';

export interface ArSettings {
  /** How long a square of the map is on the table, in millimetres. */
  squareMm: number;
  /** The camera's field of view along its picture's long side (degrees), when not calibrated. */
  fov: number;
  /** The token standing on the first marker seen (or the placed point); null: the map's middle. */
  anchor: string | null;
  /** Room tracking (Android's ARCore) where the phone has it, or the printed markers. */
  tracking: Tracking;
  /** The numbers behind the tracking, shown over the picture. */
  debug: boolean;
}

const KEY = 'atlas-connect-ar';
export const SQUARES_MM = [10, 15, 20, 25, 30, 40, 50];
const DEFAULTS: ArSettings = { squareMm: 25, fov: 65, anchor: null, tracking: 'room', debug: false };

export function readArSettings(): ArSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ArSettings> | null;
    return {
      squareMm: typeof saved?.squareMm === 'number' && SQUARES_MM.includes(saved.squareMm) ? saved.squareMm : DEFAULTS.squareMm,
      fov: typeof saved?.fov === 'number' && saved.fov >= 35 && saved.fov <= 110 ? saved.fov : DEFAULTS.fov,
      anchor: typeof saved?.anchor === 'string' ? saved.anchor : null,
      tracking: saved?.tracking === 'markers' ? 'markers' : 'room',
      debug: saved?.debug === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveArSettings(settings: ArSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // A private window: the settings last as long as the page.
  }
}
