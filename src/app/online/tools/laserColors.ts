/**
 * Whose laser has which colour: Atlas's laser swatches in order, the GM's first, then each
 * player's by their place in the session (join order, as `presence` lists them). The GM and
 * every page compute the same colours from the same order. Shared with the web page.
 */
import { LASER_COLOR_SWATCHES } from '@atlas-vtt/shared/rules';

/** The `from` of the GM's own laser. */
export const GM_LASER_ID = 'gm';

export const LASER_PALETTE: readonly string[] = LASER_COLOR_SWATCHES.map((swatch) => swatch.value);

/** `from`'s colour among `order`, the session's players; someone not in it gets the last colour. */
export function laserColor(from: string, order: readonly string[]): string {
  const place = from === GM_LASER_ID ? 0 : order.indexOf(from) + 1;
  const index = from === GM_LASER_ID || place > 0 ? place : LASER_PALETTE.length - 1;
  return LASER_PALETTE[index % LASER_PALETTE.length]!;
}

/** The swatch `value` names (any letter case), as the palette spells it; null for any other colour. */
export function swatchLaserColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const lower = value.toLowerCase();
  return LASER_PALETTE.find((swatch) => swatch === lower) ?? null;
}
