/**
 * `tokens` on a stock Atlas VTT, which has no extension API: where a dropped token lands and moving tokens for
 * players, with the contract of the API (`TokensApi`).
 *
 * It uses what stock Atlas leaves reachable: the grid system of the view's renderer (`gridSystem.snapTokenCenter`,
 * which the GM's own drag snaps by), and the scene store's `dropTokens`, which puts tokens down as a drop does: in place,
 * on top of the others, in one undo step. Whatever cannot be found makes a move fail closed (`not-loaded`), never guess.
 *
 * One addition of its own: on a scene players see lit, a moved token stops before the first wall in its way
 * (`stopAtWalls`, ported from Atlas's own online play), so a player cannot walk through a wall and show the sight behind
 * it. The API's `tokens.move` says nothing of walls; this is only ever called for players' tokens.
 */
import type { Point, TokenMove, TokenMoveOptions, TokenMoveResult, TokensApi } from '@atlas-vtt/api-types';
import { movementWalls } from './ported/movementWalls';
import { stopAtWalls } from './ported/wallCollision';
import { wallList } from './ported/walls';

/** Farthest a position may be from the origin, so no arithmetic on it later can overflow. */
const MAX_COORDINATE = 1e9;

interface TokenPlace {
  id: string;
  x: number;
  y: number;
}

interface TokenScene {
  mapLoaded: boolean;
  isMapLoading: boolean;
  /** The GM has a drag under way. */
  isDragging?: boolean | undefined;
  remoteView?: unknown;
  grid?: { snapToGrid?: boolean | undefined; size?: number | undefined } | null | undefined;
  lighting: { enabled: boolean };
  objects: {
    tokens: Readonly<Record<string, { x: number; y: number; size?: number | undefined; isHidden?: boolean | undefined } | undefined>>;
    walls?: unknown;
  };
  dropTokens?: (positions: readonly TokenPlace[]) => void;
}

export interface TokenView {
  readonly viewId: string;
  readonly atlasStore: { getState(): TokenScene };
  readonly renderer?: unknown;
}

export interface StockTokensDeps {
  view(viewId: string): TokenView | null;
  mapSize(view: TokenView): { width: number; height: number };
  /** Whether Atlas's dynamic lighting experiment is on; null when it cannot be read. */
  dynamicLighting(): boolean | null;
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isCoordinate = (value: unknown): value is number => isFiniteNumber(value) && Math.abs(value) <= MAX_COORDINATE;
const frozenPoint = ({ x, y }: Point): Readonly<Point> => Object.freeze({ x, y });
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** The size the drag snaps by: `size || 1`, as the GM's drag reads it; a malformed size reads as 1. */
const footprint = (token: { size?: number | undefined }): number => (isFiniteNumber(token.size) && token.size > 0 ? token.size : 1);

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

/** `value` pulled at least `margin` away from both edges of `[0, max]` (to the middle when they would cross). */
const inset = (value: number, margin: number, max: number): number => (2 * margin >= max ? max / 2 : Math.min(Math.max(value, margin), max - margin));

/**
 * Where `target` lands when the final position must lie on the map: where it snaps, or, when that is off the map,
 * the nearest snapped position inside it (the target is pulled inward in half-cell steps until it snaps inside). The
 * GM's own drag does not clamp; this is the API's extra. A map too small for any snapped position gets the target
 * clamped, unsnapped.
 */
function landOnMap(snapAt: (point: Point) => Point, target: Point, map: { width: number; height: number }, pitch: number, reach: number): Point {
  const onMap = (p: Point): boolean => p.x >= 0 && p.x <= map.width && p.y >= 0 && p.y <= map.height;
  const direct = snapAt(target);
  if (onMap(direct)) return direct;
  const base = { x: clamp(target.x, map.width), y: clamp(target.y, map.height) };
  for (let margin = 0; margin <= reach; margin += pitch / 2) {
    const landed = snapAt({ x: inset(base.x, margin, map.width), y: inset(base.y, margin, map.height) });
    if (onMap(landed)) return landed;
  }
  return base;
}

/** The options with every flag settled; throws on a malformed one. */
function settled(options: unknown): Required<TokenMoveOptions> {
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    throw new Error('[Atlas VTT Connect] tokens.move: "options" must be an object.');
  }
  const given = (options ?? {}) as Record<string, unknown>;
  const flag = (name: keyof TokenMoveOptions, fallback: boolean): boolean => {
    const value = given[name];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new Error(`[Atlas VTT Connect] tokens.move: "${name}" must be true or false.`);
    return value;
  };
  return { snap: flag('snap', true), clampToMap: flag('clampToMap', true), allowHidden: flag('allowHidden', false) };
}

/** Each token's last move; an entry that is not an object, or names no token, is kept under a name no token has. */
function lastMoves(moves: unknown): Map<string, Partial<TokenMove>> {
  if (!Array.isArray(moves)) throw new Error('[Atlas VTT Connect] tokens.move: "moves" must be a list of { tokenId, x, y }.');
  const byToken = new Map<string, Partial<TokenMove>>();
  for (const move of moves as unknown[]) {
    const entry = (isObject(move) ? move : {}) as Partial<TokenMove>;
    byToken.set(typeof entry.tokenId === 'string' ? entry.tokenId : '', entry);
  }
  return byToken;
}

/** The view's grid snapping as its renderer holds it, or null when it cannot be found. */
function snapperOf(view: TokenView): ((point: Point, size: number) => Point) | null {
  const gridSystem = isObject(view.renderer) ? view.renderer.gridSystem : undefined;
  const snap = isObject(gridSystem) ? gridSystem.snapTokenCenter : undefined;
  if (typeof snap !== 'function') return null;
  return (point, size) => {
    const snapped: unknown = (snap as (x: number, y: number, size: number) => unknown).call(gridSystem, point.x, point.y, size);
    if (!isObject(snapped) || !isFiniteNumber(snapped.x) || !isFiniteNumber(snapped.y)) throw new Error('the grid did not answer a place');
    return { x: snapped.x, y: snapped.y };
  };
}

export function stockTokensApi(deps: StockTokensDeps): TokensApi {
  /** Whether the GM's drop snaps in this scene (the grid's `snapToGrid`, on unless switched off). */
  const snaps = (state: TokenScene): boolean => state.grid != null && (state.grid.snapToGrid ?? true);

  return Object.freeze({
    snapPoint: (viewId: string, point: Point, tokenSize: number): Readonly<Point> => {
      if (typeof point !== 'object' || point === null || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
        throw new Error('[Atlas VTT Connect] tokens.snapPoint: "point" must be { x, y } numbers.');
      }
      if (!isFiniteNumber(tokenSize) || tokenSize <= 0) throw new Error('[Atlas VTT Connect] tokens.snapPoint: "tokenSize" must be a number above 0.');
      const view = deps.view(viewId);
      if (!view || !snaps(view.atlasStore.getState())) return frozenPoint(point);
      try {
        return frozenPoint(snapperOf(view)?.({ x: point.x, y: point.y }, tokenSize) ?? point);
      } catch {
        return frozenPoint(point);
      }
    },

    move: (viewId: string, moves: readonly TokenMove[], options?: TokenMoveOptions): TokenMoveResult => {
      const { snap, clampToMap, allowHidden } = settled(options);
      const wanted = lastMoves(moves);
      const view = deps.view(viewId);
      const state = view?.atlasStore.getState();
      // A remote view is read-only; a drag of the GM's is under way (their drop would join it in one undo step); no
      // drop to put tokens down by, or no grid to snap by where the grid snaps: nothing is written.
      if (!view || !state || state.remoteView != null || !state.mapLoaded || state.isMapLoading || state.isDragging === true || typeof state.dropTokens !== 'function') {
        return { ok: false, reason: 'not-loaded' };
      }
      const snapper = snap && snaps(state) ? snapperOf(view) : null;
      if (snap && snaps(state) && !snapper) return { ok: false, reason: 'not-loaded' };
      // Own keys only: "constructor" or "__proto__" must never read as a token.
      const known = (id: string): ReturnType<typeof tokenOf> => tokenOf(state, id);
      const entries = [...wanted].map(([id, move]) => ({ id, move, token: known(id) }));
      if (entries.some(({ token }) => !token)) return { ok: false, reason: 'unknown-token' };
      if (!allowHidden && entries.some(({ token }) => token?.isHidden === true)) return { ok: false, reason: 'hidden' };
      const map = deps.mapSize(view);
      const bounded = clampToMap && map.width > 0 && map.height > 0;
      // A scene players see lit stops a token at the first wall in its way, as Atlas's own online play does.
      const lit = state.lighting.enabled === true && deps.dynamicLighting() !== false;
      let walls: ReturnType<typeof movementWalls> | null = null;
      try {
        walls = lit && isObject(state.objects.walls) ? movementWalls(wallList(state.objects.walls), map.width > 0 && map.height > 0 ? map : null) : null;
      } catch {
        // Walls that cannot be read stop nothing: a lit scene refuses the move instead.
        if (lit) return { ok: false, reason: 'not-loaded' };
      }
      const landings: TokenPlace[] = [];
      for (const { id, move, token } of entries) {
        if (!token || !isCoordinate(move.x) || !isCoordinate(move.y)) return { ok: false, reason: 'invalid-position' };
        const target = { x: move.x, y: move.y };
        const size = footprint(token);
        const snapAt = (point: Point): Point => {
          try {
            return snapper ? snapper(point, size) : point;
          } catch {
            return point;
          }
        };
        const cell = state.grid?.size;
        const pitch = isFiniteNumber(cell) && cell > 0 ? cell : 1;
        const landed = bounded ? landOnMap(snapAt, target, map, pitch, pitch * (size + 2)) : snapAt(target);
        const rested = walls ? stopAtWalls(walls, { x: token.x, y: token.y }, landed) : landed;
        if (!isCoordinate(rested.x) || !isCoordinate(rested.y)) return { ok: false, reason: 'invalid-position' };
        landings.push({ id, x: rested.x, y: rested.y });
      }
      // One write, so one undo step.
      if (landings.length > 0) state.dropTokens(landings);
      const positions = Object.fromEntries(landings.map(({ id, x, y }) => [id, frozenPoint({ x, y })]));
      return { ok: true, positions: Object.freeze(positions) };
    },
  });
}

/** A token of the map by id; null for none, and for one kept beside the map (Atlas 0.9's `offMap`), which is no part of it. */
function tokenOf(state: TokenScene, id: string): { x: number; y: number; size?: number | undefined; isHidden?: boolean | undefined } | null {
  const token = Object.hasOwn(state.objects.tokens, id) ? (state.objects.tokens[id] ?? null) : null;
  return token && (token as { offMap?: unknown }).offMap !== true ? token : null;
}
