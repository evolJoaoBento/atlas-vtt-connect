/**
 * The player view's layers, one per Atlas layer in `SCENE_LAYER_ORDER`: a layer added
 * to Atlas's list fails the build here until the player view has one.
 */
import type { SceneLayer } from '@atlas-vtt/shared/draw';
import { createDrawingsLayer } from './drawingsLayer';
import { FogLayer } from './fogLayer';
import { createGridLayer } from './gridLayer';
import type { PlayerLayer } from './layerTypes';
import type { MiniLayer } from '../minis/miniLayer';
import { createMapLayer } from './mapLayer';
import { createTextsLayer } from './textsLayer';
import { createTokensLayer } from './tokensLayer';

/** `minis`: the 3D minis on tokens (`minis/miniLayer.ts`); without it none is drawn. */
export function createSceneLayers(options: { minis?: MiniLayer } = {}): Record<SceneLayer, PlayerLayer> {
  return {
    map: createMapLayer(),
    grid: createGridLayer(),
    tokens: createTokensLayer(options.minis ? { minis: options.minis } : {}),
    texts: createTextsLayer(),
    drawings: createDrawingsLayer(),
    fog: new FogLayer(),
  };
}
