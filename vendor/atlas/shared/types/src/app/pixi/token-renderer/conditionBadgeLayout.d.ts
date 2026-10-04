/**
 * Where condition badges sit on a token's ring, and their size. Used by
 * `ConditionBadge` and `ConditionBadgeRing`, and part of the shared drawing contract; no PIXI imports.
 */
export declare const CONDITION_BADGE: {
    /** Badge radius in UI units (a medium token is 62 wide). */
    readonly radius: 6;
    /** Dark rim that separates the badge from any token art or map behind it. */
    readonly bezelWidth: 1;
    readonly bezelColor: 1118484;
    /** Value pip radius as a share of the badge radius, and where its centre sits. */
    readonly pipShare: 0.6;
    readonly pipOffset: 0.72;
    readonly pipColor: 1842210;
    /** The "+3" badge that counts the conditions that do not fit. */
    readonly overflowColor: 3816002;
};
/**
 * How many badges fit between the handles on a ring `ringRadius` world units from the
 * token centre, with badges `scale` world units per UI unit; on medium tokens that is three.
 */
export declare function badgeSlots(ringRadius: number, scale: number): number;
/** The items shown as badges; when more than fit, all but the last slot, which counts the rest (`overflow`). */
export declare function fitBadges<T>(items: readonly T[], ringRadius: number, scale: number): {
    shown: T[];
    overflow: number;
};
/** Badge centres relative to the token centre: the first nearest the top, the rest following down the token's left. */
export declare function badgePositions(count: number, ringRadius: number, scale: number): Array<{
    x: number;
    y: number;
}>;
