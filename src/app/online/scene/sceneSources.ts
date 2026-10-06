/** What the scene hub needs of its neighbours, and the change detection its slots share with them. */
import type { CollectionGridDefaults, FogOperation, InitiativeRules, ResourceDefinition, SceneSnapshot } from '@atlas-vtt/api-types';
import type { PresentedSceneSource } from '../atlas/presentedSource';
import type { AssetRegistry } from './AssetRegistry';
import { NO_DARKNESS, type Darkness } from './darknessFog';
import { FogCoverage } from './FogCoverage';
import type { PlayerViewRules } from './playerViewRules';
import type { ProjectionContext } from './projectForPlayers';
import { fogTruncated, projectFog, type ProjectionMemo } from './projectRecords';
import type { SceneSession } from './sceneContracts';
import type { LightingSource } from './sceneLighting';
import { SCENE_LIMITS } from './sceneLimits';
import { addFogStats, fogOverRemoteLimits, fogStats, type FogStats } from './remoteFogLimits';
import type { MapSize } from './sceneTypes';

export type { PresentedSceneSource } from '../atlas/presentedSource';
export type { SceneSession } from './sceneContracts';

export interface PlayerViewSettingsSource {
  getLocalPlayerViewSettings(): PlayerViewRules;
  onChange(listener: () => void): () => void;
}

/** What every scene's projection reads: the session, the presented scene, the GM's rules and the collections' settings. */
export interface SceneProjectionOptions {
  session: SceneSession;
  presented: PresentedSceneSource;
  settings: PlayerViewSettingsSource;
  /** The session's content registry: fingerprints for the projection, and when to project again. */
  assets: Pick<AssetRegistry, 'idFor' | 'onChange'>;
  /** Tells the GM something; `OnlineSessionService` shows an Obsidian notice. */
  notify(message: string): void;
  /** What a lit scene hides from players; without it a scene saved lit shows players nothing but the dark map (`noLightingCapability`). */
  lighting?: LightingSource;
  /** The grid defaults of the collection holding the map at `mapPath`; tests leave it out. */
  collectionGrid?: (mapPath: string | null) => CollectionGridDefaults | null;
  /** The cone angle the GM measures with on the map at `mapPath`; tests leave it out. */
  coneAngle?: (mapPath: string | null) => number;
  /** The resources of the collection holding the map at `mapPath`, which decide the bars players see; without it none show. */
  resources?: (mapPath: string | null) => readonly ResourceDefinition[];
  /** The initiative rules of the collection holding the map at `mapPath`, which say whether the list is by sides before a fight; without it the list is in turn order. */
  initiativeRules?: (mapPath: string | null) => InitiativeRules;
  /** Calls `listener` when a collection's rules change or the asset index loads (its resources or initiative rules may differ); returns the stop. */
  watchResources?: (listener: () => void) => () => void;
}

export type Slice = readonly unknown[];

/**
 * The snapshot fields the projection reads (`SCENE_FIELD_COVERAGE`), each record by reference: the
 * snapshot's `objects` and `widgets` wrappers are new on every snapshot, their records are the store's.
 * Changes elsewhere (camera, selection, tools) send nothing.
 */
export function sliceOf(snapshot: SceneSnapshot): Slice {
  return [
    snapshot.background, snapshot.grid, snapshot.objects.tokens, snapshot.objects.texts, snapshot.objects.drawings,
    snapshot.objects.fog, snapshot.widgets.settings, snapshot.widgets.values, snapshot.initiative,
    snapshot.initiativeTrackerOpen, snapshot.lighting,
  ];
}

export function sameSlice(a: Slice, b: Slice): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Changes are batched and sent at most this often. */
export const SCENE_TICK_MS = 50;

export const SCENE_TOO_LARGE_NOTICE = 'This scene is too large to send to online players.';
export const FOG_TRUNCATED_NOTICE = 'This scene has too much fog to show to online players.';

/** What players cannot see under the fog; a lit scene's texts and drawings are checked by the raster itself (`LightingFrame.shows`). */
export interface FogCoverages {
  coverage: FogCoverage;
  /**
   * The GM's fog and the darkness have more operations than the wire holds, so some would not be sent, or more than Atlas's
   * remote view works out (`REMOTE_FOG_LIMITS`: operations, points in all, points in one operation, a brush wider than the map).
   */
  truncated: boolean;
}

/** Coverage rasterised from the fog players receive, rebuilt only when the fog changes; a new darkness never replays it. */
export class FogCoverageCache {
  private fog: { fog: Readonly<Record<string, FogOperation>>; coverage: FogCoverage; dropped: boolean; stats: FogStats } | null = null;

  /** `map`: the size players get, which the brush limit reads. */
  get(fog: Readonly<Record<string, FogOperation>>, memo: ProjectionMemo, darkness: Darkness = NO_DARKNESS, map: MapSize = { width: 0, height: 0 }): FogCoverages {
    if (!this.fog || this.fog.fog !== fog) {
      const projected = projectFog(fog, memo);
      this.fog = { fog, coverage: FogCoverage.fromPlayerFog(projected), dropped: fogTruncated(fog, memo), stats: fogStats(projected) };
    }
    // The darkness is one operation; the GM's fog is counted once per change of its operations.
    const sent = addFogStats(this.fog.stats, fogStats(darkness.fog));
    const truncated = this.fog.dropped || Object.keys(fog).length + Object.keys(darkness.fog).length > SCENE_LIMITS.records || fogOverRemoteLimits(sent, map);
    return { coverage: this.fog.coverage, truncated };
  }
}

/** What the projection needs of the presented scene besides the snapshot's slice. */
export function sceneContext(
  snapshot: SceneSnapshot,
  options: Pick<SceneProjectionOptions, 'collectionGrid' | 'coneAngle' | 'resources' | 'initiativeRules'>,
): Pick<ProjectionContext, 'mapSize' | 'collectionGrid' | 'coneAngle' | 'resources' | 'initiativeRules'> {
  const { mapPath } = snapshot;
  const coneAngle = options.coneAngle?.(mapPath);
  const initiativeRules = options.initiativeRules?.(mapPath);
  return {
    mapSize: snapshot.mapSize,
    collectionGrid: options.collectionGrid?.(mapPath) ?? null,
    ...(coneAngle !== undefined && { coneAngle }),
    resources: options.resources?.(mapPath) ?? [],
    ...(initiativeRules && { initiativeRules }),
  };
}
