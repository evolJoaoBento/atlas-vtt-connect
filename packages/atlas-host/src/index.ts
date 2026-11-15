/**
 * Obsidian-side code shared by Connect and Tabletop: the Atlas version floor, the pairing notice, the one Atlas host
 * that follows a board, the wake of Atlas's deferred tab, the players' visibility, and the one sheet model with the
 * reader of a token's linked stat block. Tabletop holds a copy made by its `npm run sync:connect`.
 */
export { atlasFloor, compareVersions, floorNotice, FLOOR_POLL_MS, MIN_ATLAS_VERSION, watchAtlasFloor, type AtlasFloor } from './atlasFloor';
export { pairingNotice } from './pairing';
export { ATLAS_VIEW_TYPE, openBackgroundLeaf } from './hostLeaf';
export { AtlasHost, HOST_LOAD_MS, HOST_MARK, type FollowResult, type HostMark, type HostState, type HostStatus, type HostStore } from './atlasHost';
export { loadDeferredLeaves, wakeAtlasForHosting, WAKE_LOAD_MS, type HostingWakeDeps } from './wake';
export {
  atlasEffectOf, damageOfEffect, measureKind, measureToSpell, MEASURE_LIMITS, readExtra, SPELL_CHAIN, SPELL_SHAPE_NAMES, spellToMeasure, templateToMeasure,
  type MeasureRecord, type SpellLike, type SpellMeta, type SpellShape, type TabletopExtra,
} from './spellMeasure';
export { atlasMapSize } from './lighting/mapSize';
export { playerVisibilityApi, type LightingScene, type LightingView, type PlayerVisibilityDeps } from './lighting/playerVisibility';
export type { Disposer, LightingApi, Perception, PlayerVisibility, PlayerVisibilityOptions } from './lighting/types';
// The one sheet model (pure: a page imports `./sheets/sheets` and `./sheets/sheetCards` by path) and its reader.
export {
  ABILITY_NAMES, ADVANTAGE_SIDES, advantageSide, buildSheet, isSheetRollRef, isTokenSheets, mayHaveAdvantage, modifierOf, rollableName, sheetColor,
  sheetRollFormula, sheetRollLabel, SHEET_LIMITS, signed, text as sheetText, textParts, toRollFormula,
  type AdvantageSide, type PlayerSheet, type SheetBonus, type SheetItem, type SheetLine, type SheetResource, type SheetRollRef, type SheetSection,
  type TextPart, type TokenSheet,
} from './sheets/sheets';
export { CARD_LIMITS, cardRollFormula, isSheetCard, safeCss, type CardRoll, type SheetCard } from './sheets/sheetCards';
export {
  buildPlayerSheet, buildTemplateSheet, buildUntemplatedSheet, isTemplatedStatblock, templateHidesFields, templateId, type TemplatedStatblock,
} from './sheets/templateSheets';
export {
  linkedCreatures, notePath, TemplateFiles, TEMPLATE_EXTENSION, type LinkedCreatureOptions, type LinkedCreatures, type StatblockLink,
} from './sheets/linkedCreature';
