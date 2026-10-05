/**
 * The Connect half of the fork's lighting fixtures (the Atlas half, which works sight out from walls and
 * lights, moved to Atlas with `playerVisibility`): Atlas's answers as a test writes them, a lit scene, and
 * the projection as the broadcaster makes it from an answer.
 */
import { need } from '../../../src/connect/capabilities';
import type { AtlasCapability, Character, LightingApi, Perception, PlayerVisibility, SceneLighting, SceneSnapshot } from '@atlas-vtt/api-types';
import { sessionDeps } from '../../../src/app/online/atlas/sessionDeps';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { FogCoverage } from '../../../src/app/online/scene/FogCoverage';
import type { LightingFrame } from '../../../src/app/online/scene/lightingFrame';
import { projectForPlayers } from '../../../src/app/online/scene/projectForPlayers';
import { SceneBroadcaster } from '../../../src/app/online/scene/SceneBroadcaster';
import { createProjectionMemo, projectFog } from '../../../src/app/online/scene/projectRecords';
import type { PlayerViewRules } from '../../../src/app/online/scene/playerViewRules';
import { liveLighting } from '../../../src/app/online/scene/sceneLighting';
import type { MapSize, PlayerScene } from '../../../src/app/online/scene/sceneTypes';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { emptySceneState, presenter, sceneView, type SceneView, type ViewState } from './presentedFixtures';
import { fakeAssetIds, snapshotOf } from './sceneFixtures';

export const MAP: MapSize = { width: 1000, height: 800 };
/**
 * The cell size Atlas answers for `map` (`darknessCellSize`): from 8 px, doubled until the long side holds at most
 * `maxCellsPerSide` cells (default 384), so always 8 times a power of two.
 */
export function atlasCellSize(map: MapSize, maxCellsPerSide = 384): number {
  let cellSize = 8;
  while (Math.ceil(Math.max(map.width, map.height) / cellSize) > maxCellsPerSide) cellSize *= 2;
  return cellSize;
}

export const UNLIT: PlayerVisibility = { status: 'unlit' };
export const PENDING: PlayerVisibility = { status: 'pending' };

/**
 * A ready answer: how the window perceives each token, and the cells it shows where `shown(x, y)` holds at their
 * centre, on Atlas's own grid: `cellSize` world pixels from the top-left, `ceil(map / cellSize)` cells each way.
 */
export function ready(tokens: Record<string, Perception>, shown: (x: number, y: number) => boolean, map: MapSize = MAP, cellSize = atlasCellSize(map)): PlayerVisibility {
  const cols = Math.ceil(map.width / cellSize);
  const rows = Math.ceil(map.height / cellSize);
  const cells = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) cells[row * cols + col] = shown((col + 0.5) * cellSize, (row + 0.5) * cellSize) ? 1 : 0;
  }
  return { status: 'ready', tokens, darkness: { cellSize, cols, rows, shown: cells }, showsExplored: false };
}

/** Atlas's `lighting` for one view, answering `current`; `changed()` runs the watchers, as Atlas does. */
export interface TestLighting {
  current: PlayerVisibility;
  readonly api: Pick<LightingApi, 'playerVisibility' | 'watch'>;
  changed(): void;
  watchers(): number;
}

export function testLighting(initial: PlayerVisibility): TestLighting {
  const listeners = new Set<() => void>();
  const lighting: TestLighting = {
    current: initial,
    api: {
      playerVisibility: () => lighting.current,
      watch: (_viewId, listener) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
    },
    changed: () => { for (const listener of [...listeners]) listener(); },
    watchers: () => listeners.size,
  };
  return lighting;
}

/** As `fakeLighting` in the brief: a `lighting` that always answers `visibility` and whose watch does nothing. */
export function fakeLighting(visibility: PlayerVisibility): Pick<LightingApi, 'playerVisibility' | 'watch'> {
  return { playerVisibility: () => visibility, watch: () => () => undefined };
}

export function character(id: string, x: number, y: number, overrides: Partial<Character> = {}): Character {
  return { id, kind: 'character', x, y, imagePath: `art/${id}.png`, name: id, size: 1, ...overrides };
}

/** A scene saved lit (unless `lighting` says otherwise): the hero at (140, 400), on `MAP` with a 70 px grid. */
export function scene(lighting: Partial<SceneLighting> = {}, objects: Partial<SceneSnapshot['objects']> = {}): SceneSnapshot {
  return snapshotOf({
    background: 'maps/cave.png',
    mapSize: MAP,
    grid: { enabled: true, visible: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 } as SceneSnapshot['grid'],
    objects: { tokens: { hero: character('hero', 140, 400) }, texts: {}, drawings: {}, fog: {}, ...objects },
    lighting: { enabled: true, ambient: 0, ...lighting },
  });
}

/** The frame the broadcaster gets for `state` when Atlas answers `visibility` (`liveLighting`). */
export function frameOf(state: SceneSnapshot, visibility: PlayerVisibility): LightingFrame | null {
  const presentation = liveLighting(fakeLighting(visibility)).open({ viewId: state.viewId, sceneId: 'scene-1' }, () => undefined);
  const frame = presentation.frame(state);
  presentation.dispose();
  return frame;
}

const RULES: PlayerViewRules = { showGrid: true, showTokenNameplates: true, showWidgets: true, showInitiative: true };

/** The projection as the broadcaster makes it: texts and drawings are checked against the GM's fog and the raster of `lighting`. */
export function project(state: SceneSnapshot, lighting: LightingFrame | null): PlayerScene {
  const memo = createProjectionMemo();
  const coverage = FogCoverage.fromPlayerFog(projectFog(state.objects.fog, memo));
  return projectForPlayers(state, {
    sceneId: 'scene-1', rules: RULES, coverage, lighting, assets: fakeAssetIds(), mapSize: state.mapSize,
  }, memo);
}

/** As players get `state` when Atlas answers `visibility`. */
export const projectLit = (state: SceneSnapshot, visibility: PlayerVisibility): PlayerScene => project(state, frameOf(state, visibility));

/** The capabilities `hostLit` gives its fake Atlas, with or without `lighting`. */
const HOSTING: readonly AtlasCapability[] = ['views', 'presentation', 'rules', 'settings', 'storage'];

export interface LitHost {
  atlas: FakeAtlas;
  /** The presented view's id. */
  view: string;
  store: SceneView['store'];
  broadcaster: SceneBroadcaster;
  sent: ControlMessage[];
  notices: string[];
  /** What players have now. */
  players(): PlayerScene;
}

/**
 * The broadcaster as Connect hosts it (`sessionDeps`), over a fake Atlas with or without the `lighting`
 * capability, presenting the Tavern with `state` on `MAP` to one admitted player.
 */
export function hostLit(state: ViewState, options: { lighting: boolean; visibility?: PlayerVisibility }): LitHost {
  const atlas = new FakeAtlas({ capabilities: options.lighting ? [...HOSTING, 'lighting'] : HOSTING });
  const presenting = presenter(atlas);
  const { view, store, tavern } = sceneView(presenting, state, { mapSize: MAP });
  if (options.visibility) atlas.lighting.setVisibility(view, options.visibility);
  const { extension } = presenting;
  const deps = sessionDeps(extension, { dice: null, lasers: null, lighting: need(atlas, extension, 'lighting'), tokens: null });
  const sent: ControlMessage[] = [];
  const notices: string[] = [];
  const broadcaster = new SceneBroadcaster({
    session: { use: () => () => undefined, send: (_playerId, message) => { sent.push(message); }, getPlayers: () => [{ playerId: 'p1', name: 'Anna', status: 'admitted' }] },
    presented: deps.presented,
    settings: deps.playerViewSettings,
    assets: { ...fakeAssetIds(), onChange: () => () => undefined },
    notify: (message) => notices.push(message),
    ...(deps.lighting ? { lighting: deps.lighting } : {}),
  });
  broadcaster.start();
  presenting.present(view, tavern);
  return { atlas, view, store, broadcaster, sent, notices, players: () => broadcaster.currentProjection()! };
}

/** The Tavern in the fork's store fields, saved lit, with `tokens`, `texts` and `drawings`. */
export function litTavern(objects: Partial<ViewState['objects']>, lighting: Partial<SceneLighting> = {}): ViewState {
  const empty = emptySceneState();
  return { ...empty, objects: { ...empty.objects, ...objects }, lighting: { enabled: true, ambient: 0, ...lighting } };
}
