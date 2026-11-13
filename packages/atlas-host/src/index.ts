/**
 * Obsidian-side code shared by Connect and Tabletop: the Atlas version floor, the pairing notice, the one Atlas host
 * that follows a board, and the wake of Atlas's deferred tab. Tabletop holds a copy made by its `npm run sync:connect`.
 */
export { atlasFloor, compareVersions, floorNotice, FLOOR_POLL_MS, MIN_ATLAS_VERSION, watchAtlasFloor, type AtlasFloor } from './atlasFloor';
export { pairingNotice } from './pairing';
export { ATLAS_VIEW_TYPE, openBackgroundLeaf } from './hostLeaf';
export { AtlasHost, HOST_LOAD_MS, HOST_MARK, type FollowResult, type HostMark, type HostState, type HostStatus, type HostStore } from './atlasHost';
export { loadDeferredLeaves, wakeAtlasForHosting, WAKE_LOAD_MS, type HostingWakeDeps } from './wake';
