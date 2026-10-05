/**
 * How the join page shows the player's own rolls: Atlas's dice display setting (`DICE_DISPLAY_OPTIONS`:
 * Result card, Fast dice, Dice), kept in the browser so it is theirs on the next visit, Dice when
 * nothing is kept. Storage can throw (private windows) or hold anything: only a known option is
 * taken. Shared with the web page.
 */
import { isDiceDisplay, type DiceDisplay } from '../../dice3d/diceDisplay';

export const DICE_DISPLAY_KEY = 'atlas-online:dice-display';
/** Atlas's own default. */
export const DEFAULT_PAGE_DICE_DISPLAY: DiceDisplay = 'full';

/** The page passes `() => localStorage`: reaching for it can throw, so it is read inside the guard. */
type Reader = () => Pick<Storage, 'getItem'>;
type Writer = () => Pick<Storage, 'setItem'>;

export function loadDiceDisplay(storage: Reader): DiceDisplay {
  try {
    const kept = storage().getItem(DICE_DISPLAY_KEY);
    return isDiceDisplay(kept) ? kept : DEFAULT_PAGE_DICE_DISPLAY;
  } catch {
    return DEFAULT_PAGE_DICE_DISPLAY;
  }
}

export function saveDiceDisplay(display: DiceDisplay, storage: Writer): void {
  if (!isDiceDisplay(display)) return;
  try {
    storage().setItem(DICE_DISPLAY_KEY, display);
  } catch {
    // The choice still applies to this visit.
  }
}
