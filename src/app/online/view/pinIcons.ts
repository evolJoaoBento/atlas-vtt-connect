/**
 * Atlas's pin icons as the player views draw them: the silhouettes (game-icons.net, CC BY 3.0, see README credits),
 * each icon's colour in both themes, and what a stored icon reads as. The data and the rule are Atlas's own files
 * (`packages/atlas-shared`: `types/pinIconPaths.ts`, `types/pinIcons.ts`); nothing of them is copied here.
 */
import { pinIcons } from '../../../../packages/atlas-shared/src/index';

/** Path data on a 512×512 canvas, by icon id. */
export const PIN_ICON_PATHS = pinIcons.PIN_ICON_PATHS;
export type PinIconId = pinIcons.PinIconId;

/** Each icon's colour in both themes, as Atlas's pin palette tones it: deeper on light, brighter on dark. */
export const PIN_ICON_TONES: Readonly<Record<string, { readonly light: string; readonly dark: string }>> = Object.freeze(Object.fromEntries(
  (Object.keys(PIN_ICON_PATHS) as PinIconId[]).flatMap((id) => {
    // An icon Atlas offers nowhere has no tone of its own; the pins layer then takes its default.
    try {
      const { tone } = pinIcons.getPinIconDefinition(id);
      return [[id, { light: tone.light, dark: tone.dark }] as const];
    } catch {
      return [];
    }
  }),
));

export const DEFAULT_PIN_ICON: PinIconId = pinIcons.DEFAULT_PIN_ICON;

/**
 * Atlas's `resolvePinIcon`: a stored icon (legacy Lucide ids too) as a pin icon or a label sequence. What is stored
 * comes from a map file, so anything that is no text, or that names a member every object has (`constructor`), reads
 * as none before Atlas's rule is asked.
 */
export function resolvePinIcon(stored: unknown): PinIconId | 'number' | 'letter' {
  const own = typeof stored === 'string' && !(stored in Object.prototype) ? stored : undefined;
  return pinIcons.resolvePinIcon(own);
}
