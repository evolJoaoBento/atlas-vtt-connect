/** The bodies in the tray, in the order they stand in the formula. */
export declare const TRAY_DICE: readonly [4, 6, 8, 10, 12, 20, 100];
export type TrayDie = (typeof TRAY_DICE)[number];
/** How many dice of one kind the tray holds. */
export declare const MAX_PER_DIE = 20;
/** How many dice the tray holds in all, so a finger resting on d100 cannot build a roll of hundreds. */
export declare const MAX_DICE = 100;
export declare const MAX_MODIFIER = 20;
export type TrayPool = Partial<Record<TrayDie, number>>;
/**
 * What lies in the tray, as a formula: `2d6 + 1d20 + 3`. The dice stand in
 * ascending order whatever order they were picked in, so the same tray always
 * reads the same; a modifier of 0 is left out.
 */
export declare function trayFormula(pool: TrayPool, modifier: number): string;
export declare function trayDiceCount(pool: TrayPool): number;
/** One more die of this kind, within the limits. */
export declare function addDie(pool: TrayPool, sides: TrayDie): TrayPool;
export declare function removeDie(pool: TrayPool, sides: TrayDie): TrayPool;
export declare function clampModifier(modifier: number): number;
/** The tray's dice keyed by die name (`d6`), as a roll's dice are. */
export declare function trayPoolByDie(pool: TrayPool): Record<string, number>;
