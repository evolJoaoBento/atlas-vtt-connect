/**
 * Atlas's `scenes` on an Atlas without them (a stock Atlas from Community plugins): no scene is in any collection, so
 * no map is shared or offered, and pulling a map someone shares says why it cannot be had. Notes share as everywhere.
 */
import type { ScenesApi } from '@atlas-vtt/api-types';

export const MAPS_NEED_ATLAS_TEXT = 'Sharing maps needs an Atlas VTT with the extension API. Notes share as usual.';

const refuse = (): Promise<never> => Promise.reject(new Error(MAPS_NEED_ATLAS_TEXT));

export const NO_SCENES = {
  list: () => Promise.resolve([]),
  findByMap: () => Promise.resolve(null),
  getData: () => Promise.resolve(undefined),
  setData: refuse,
  readMap: refuse,
  replaceMap: refuse,
  addToCollection: refuse,
} as unknown as ScenesApi;
