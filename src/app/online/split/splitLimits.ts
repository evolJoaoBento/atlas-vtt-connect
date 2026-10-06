/**
 * The split party's limits. `scenesInUse`: at most 4 scenes in use at once, the presented one counted (spec 8.3, D13).
 * `goLiveWaitMs`: how long a lit scene going live keeps its parked projection while sight is pending (P8, D14).
 */
export const SPLIT_LIMITS = { scenesInUse: 4, goLiveWaitMs: 2000 } as const;
