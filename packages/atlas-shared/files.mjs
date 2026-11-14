// The stock Atlas VTT files copied verbatim into packages/atlas-shared/src/app, relative to Atlas's src/app.
// To add one: list it here, run `npm run sync:shared -- --atlas <checkout>`, and export what is needed from src/index.ts.
export const ATLAS_TAG = '0.15.0';
export const FILES = [
  'characters/playerTokens.ts',
  'gameSystems/diceRules.ts',
  'gameSystems/diceSets.ts',
  'gameSystems/initiativeSideRules.ts',
  'grid/cellNumbering.ts',
  'grid/gridDistance.ts',
  'grid/gridOffset.ts',
  'grid/gridPlacement.ts',
  'grid/hexGeometry.ts',
  'grid/hexLattice.ts',
  'grid/measurementFormat.ts',
  'grid/movementCost.ts',
  'grid/squareLattice.ts',
  'initiative/defeated.ts',
  'initiative/initiativeDice.ts',
  'initiative/sideOrder.ts',
  'initiative/sides.ts',
  'levels/levelObjects.ts',
  'levels/sceneLevels.ts',
  'lighting/lightingConstants.ts',
  'measure/areaRules.ts',
  'measure/dragDistance.ts',
  'measure/dragMovement.ts',
  'measure/measureEffects.ts',
  'measure/measureGeometry.ts',
  'measure/measureGrid.ts',
  'measure/measureSnap.ts',
  'measure/measureTypes.ts',
  'measure/movementRules.ts',
  'measure/reachSteps.ts',
  'measure/tokenHeight.ts',
  'measure/turnMoves.ts',
  'pixi/token-renderer/tokenSizing.ts',
  'resources/resourceColors.ts',
  'resources/resourceSlots.ts',
  'resources/resourceTypes.ts',
  'resources/resourceValues.ts',
  'resources/visibleResources.ts',
  'tools/diceCrit.ts',
  'tools/diceExplosion.ts',
  'tools/laserPointerSettings.ts',
  'tools/pinLabels.ts',
  'types/collectionSettingsTypes.ts',
  'types/diceRulesTypes.ts',
  'types/diceSetTypes.ts',
  'types/gridTypes.ts',
  'types/initiativeRulesTypes.ts',
  'types/initiativeTypes.ts',
  'types/pinIconPaths.ts',
  'types/pinIcons.ts',
  'types/sceneLevelTypes.ts',
  'utils/hexColor.ts',
];

/**
 * A stubbed type that cannot be `any`: a copied file passes a function where this type is expected, and its parameter
 * would have no type. The shape given here is the least the copied code needs, never more than Atlas's own.
 */
export const STUB_TYPES = {
  // Atlas: `(object: object) => boolean`; its file's run-time closure is 31 files of map stretching.
  'grid/mapStretchObjects.ts': { MovesWithMap: '(object: any) => boolean' },
  // Atlas: one die of a roll; its file is the formula parser. The stand-in has the fields the dice files read and write.
  // Atlas: a box on the map; its file is the lighting's polygon bounds.
  'vision/polygonBounds.ts': { Box: "Record<'minX' | 'minY' | 'maxX' | 'maxY', number>" },
  'tools/diceFormula.ts': {
    RolledDie: "Record<'die', string> & Record<'value' | 'max', number> & Partial<Record<'negative' | 'exploded' | 'rerolled' | 'dropped' | 'advantage', true>>",
  },
};

/**
 * Atlas files that are not copied and not stubbed, but stood in for: a copied file imports them at run time, and what
 * they would bring is too much and not rules. Each is written by the sync with the text given here.
 * - `i18n/index.ts`: Atlas's texts in every language (about 110 files). A few rule files name a label with `t`; the
 *   stand-in gives the key back. Nothing the package exports may show such a label.
 */
export const BOUNDARIES = {
  'i18n/index.ts': [
    "// Generated boundary stand-in (scripts/sync-atlas-shared.mjs). Atlas's i18n is not copied: its texts are not rules.",
    '// `t` gives the key back, so a label made here is never shown; show Atlas\'s own, or one of the plugin\'s.',
    'export const t = (key: string, ..._rest: unknown[]): string => key;',
    '',
  ].join('\n'),
};
