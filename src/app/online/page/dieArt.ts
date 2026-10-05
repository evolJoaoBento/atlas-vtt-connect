/**
 * The dice tray's art on the join page: Atlas's pencil-drawn dice (`DieFace.tsx`), the same files.
 * Copies of Atlas's files (`src/app/assets/dice-icons`), imported as files, not inlined, so the page's
 * script stays small (the shared package's `DIE_ICONS` sits in the dice chunk with three.js); d100 has no
 * body and shows two d10s, as Atlas's tray does. `tests/unit/online/toolIcons.test.tsx` checks them against `DIE_ICONS`.
 */
import d4 from '../../assets/dice-icons/d4.webp';
import d6 from '../../assets/dice-icons/d6.webp';
import d8 from '../../assets/dice-icons/d8.webp';
import d10 from '../../assets/dice-icons/d10.webp';
import d12 from '../../assets/dice-icons/d12.webp';
import d20 from '../../assets/dice-icons/d20.webp';
import type { TrayDie } from '@atlas-vtt/shared/rules';

/** Each body's drawing; d100 is drawn as two of its d10. */
export const DIE_ART: Record<TrayDie, readonly string[]> = { 4: [d4], 6: [d6], 8: [d8], 10: [d10], 12: [d12], 20: [d20], 100: [d10, d10] };
