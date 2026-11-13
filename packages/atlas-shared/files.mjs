// The stock Atlas VTT files copied verbatim into packages/atlas-shared/src/app, relative to Atlas's src/app.
// To add one: list it here, run `npm run sync:shared -- --atlas <checkout>`, and export what is needed from src/index.ts.
export const ATLAS_TAG = '0.15.0';
export const FILES = [
  'grid/gridDistance.ts',
  'grid/hexGeometry.ts',
  'grid/measurementFormat.ts',
  'measure/areaRules.ts',
  'types/collectionSettingsTypes.ts',
  'types/gridTypes.ts',
];
