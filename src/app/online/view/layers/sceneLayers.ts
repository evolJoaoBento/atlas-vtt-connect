/**
 * The player view's layers, one per Atlas layer in `SCENE_LAYER_ORDER`: a layer added
 * to Atlas's list fails the build here until the player view has one.
 */
import type { SceneLayer } from '@atlas-vtt/shared/draw';
import { createDrawingsLayer } from './drawingsLayer';
import { FogLayer } from './fogLayer';
import { createGridLayer } from './gridLayer';
import type { PlayerLayer } from './layerTypes';
import { createMapLayer } from './mapLayer';
import { createTextsLayer } from './textsLayer';
import { createTokensLayer } from './tokensLayer';

export function createSceneLayers(): Record<SceneLayer, PlayerLayer> {
  return {
    map: createMapLayer(),
    grid: createGridLayer(),
    tokens: createTokensLayer(),
    texts: createTextsLayer(),
    drawings: createDrawingsLayer(),
    fog: new FogLayer(),
  };
}
