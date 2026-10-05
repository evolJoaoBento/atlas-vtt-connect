import type { GridState, Point, SceneSnapshot, TokenEntity, TokenMove, TokenMoveOptions, TokenMoveResult, TokensApi, ViewId } from '@atlas-vtt/api-types';
import { createHexLayout, isHexGridType, nearestHexCenter, snapTokenCenter } from '@atlas-vtt/shared/grid';
import type { FakeViews } from './fakeViews';

type Tokens = SceneSnapshot['objects']['tokens'];

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
/** Farthest a position may be from the origin, as in Atlas. */
const MAX_COORDINATE = 1e9;
const isCoordinate = (value: unknown): value is number => isFiniteNumber(value) && Math.abs(value) <= MAX_COORDINATE;
const frozenPoint = ({ x, y }: Point): Readonly<Point> => Object.freeze({ x, y });
const footprint = (token: TokenEntity): number => (isFiniteNumber(token.size) && token.size > 0 ? token.size : 1);
const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);
const inset = (value: number, margin: number, max: number): number => (2 * margin >= max ? max / 2 : Math.min(Math.max(value, margin), max - margin));

/**
 * Where a token of `tokenSize` dropped at `point` lands as the GM's drag puts it: a cell centre, or where cells
 * meet for an even footprint, on a grid that is hidden or switched off too. Unchanged without a usable grid or
 * with snapping off.
 */
export function snapDropped(grid: GridState | null, point: Point, tokenSize: number): Point {
  if (!grid || !(grid.snapToGrid ?? true) || !isFiniteNumber(grid.size) || grid.size <= 0) return point;
  const { size } = grid;
  const offsetX = isFiniteNumber(grid.offsetX) ? grid.offsetX : 0;
  const offsetY = isFiniteNumber(grid.offsetY) ? grid.offsetY : 0;
  if (isHexGridType(grid.type)) {
    const layout = createHexLayout(grid.type, size, offsetX, offsetY);
    return snapTokenCenter(point, tokenSize, grid.type, size, (p) => nearestHexCenter(layout, p));
  }
  const centre = (p: Point): Point => ({ x: Math.floor((p.x - offsetX) / size) * size + offsetX + size / 2, y: Math.floor((p.y - offsetY) / size) * size + offsetY + size / 2 });
  return snapTokenCenter(point, tokenSize, 'square', size, centre);
}

/** The nearest snapped position inside the map, as Atlas's `clampToMap` finds it. */
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

/** The moved tokens rise to the top of the stack, in their own order (Atlas's `raiseTokens`). */
function raised(tokens: Tokens, ids: readonly string[]): Tokens {
  const picked = new Set(ids);
  const layerOf = (token: TokenEntity): number => token.layer ?? 0;
  let below = -Infinity;
  const lifted = Object.values(tokens).filter((token) => picked.has(token.id));
  for (const token of Object.values(tokens)) if (!picked.has(token.id)) below = Math.max(below, layerOf(token));
  if (lifted.every((token) => layerOf(token) > below)) return tokens;
  const order = [...lifted].sort((a, b) => layerOf(a) - layerOf(b));
  const layers = new Map(order.map((token, index) => [token.id, below + 1 + index]));
  return Object.fromEntries(Object.entries(tokens).map(([id, token]) => [id, layers.has(id) ? { ...token, layer: layers.get(id)! } : token]));
}

/** The options with every flag settled; throws on a malformed one (Atlas's `settled`). */
function settled(options: unknown): Required<TokenMoveOptions> {
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    throw new Error('tokens.move: "options" must be an object.');
  }
  const given = (options ?? {}) as Record<string, unknown>;
  const flag = (name: keyof TokenMoveOptions, fallback: boolean): boolean => {
    const value = given[name];
    if (value === undefined) return fallback;
    if (typeof value !== 'boolean') throw new Error(`tokens.move: "${name}" must be true or false.`);
    return value;
  };
  return { snap: flag('snap', true), clampToMap: flag('clampToMap', true), allowHidden: flag('allowHidden', false) };
}

/** Atlas's `tokens` over the fake views; each successful move is one undo step, which `undo` takes back. */
export class FakeTokens {
  private readonly steps = new Map<ViewId, Tokens[]>();

  constructor(private readonly views: FakeViews) {}

  /** How many GM undo steps the moves on this view left. */
  undoSteps(viewId: ViewId): number {
    return this.steps.get(viewId)?.length ?? 0;
  }

  /** The GM's undo: the tokens as they were before the last move. */
  undo(viewId: ViewId): void {
    const before = this.steps.get(viewId)?.pop();
    const scene = this.views.sceneOf(viewId);
    if (before && scene) this.views.update(viewId, { objects: { ...scene.objects, tokens: before } });
  }

  api(): TokensApi {
    return Object.freeze({
      snapPoint: (viewId: ViewId, point: Point, tokenSize: number): Readonly<Point> => {
        if (typeof point !== 'object' || point === null || !isFiniteNumber(point.x) || !isFiniteNumber(point.y)) throw new Error('tokens.snapPoint: "point" must be { x, y } numbers.');
        if (!isFiniteNumber(tokenSize) || tokenSize <= 0) throw new Error('tokens.snapPoint: "tokenSize" must be a number above 0.');
        const scene = this.views.sceneOf(viewId);
        return frozenPoint(scene ? snapDropped(scene.grid, { x: point.x, y: point.y }, tokenSize) : point);
      },
      move: (viewId: ViewId, moves: readonly TokenMove[], options?: TokenMoveOptions): TokenMoveResult => this.move(viewId, moves, options),
    });
  }

  private move(viewId: ViewId, moves: readonly TokenMove[], options: unknown): TokenMoveResult {
    const { snap, clampToMap, allowHidden } = settled(options);
    if (!Array.isArray(moves)) throw new Error('tokens.move: "moves" must be a list of { tokenId, x, y }.');
    const wanted = new Map<string, Partial<TokenMove>>();
    for (const move of moves as unknown[]) {
      const entry = (typeof move === 'object' && move !== null ? move : {}) as Partial<TokenMove>;
      wanted.set(typeof entry.tokenId === 'string' ? entry.tokenId : '', entry);
    }
    const scene = this.views.sceneOf(viewId);
    if (!scene || !this.views.isLoaded(viewId)) return { ok: false, reason: 'not-loaded' };
    const known = (id: string): TokenEntity | null => (Object.hasOwn(scene.objects.tokens, id) ? (scene.objects.tokens[id] ?? null) : null);
    const entries = [...wanted].map(([id, move]) => ({ id, move, token: known(id) }));
    if (entries.some(({ token }) => !token)) return { ok: false, reason: 'unknown-token' };
    if (!allowHidden && entries.some(({ token }) => token?.isHidden)) return { ok: false, reason: 'hidden' };
    const map = scene.mapSize;
    const bounded = clampToMap && map.width > 0 && map.height > 0;
    const pitch = scene.grid && scene.grid.size > 0 ? scene.grid.size : 1;
    const landings: Array<{ id: string; x: number; y: number }> = [];
    for (const { id, move, token } of entries) {
      if (!token || !isCoordinate(move.x) || !isCoordinate(move.y)) return { ok: false, reason: 'invalid-position' };
      const snapAt = (point: Point): Point => (snap ? snapDropped(scene.grid, point, footprint(token)) : point);
      const target = { x: move.x, y: move.y };
      const landed = bounded ? landOnMap(snapAt, target, map, pitch, pitch * (footprint(token) + 2)) : snapAt(target);
      if (!isCoordinate(landed.x) || !isCoordinate(landed.y)) return { ok: false, reason: 'invalid-position' };
      landings.push({ id, x: landed.x, y: landed.y });
    }
    if (landings.length > 0) {
      const moved = Object.fromEntries(landings.map(({ id, x, y }) => [id, { ...scene.objects.tokens[id]!, x, y }]));
      const tokens = raised({ ...scene.objects.tokens, ...moved }, landings.map(({ id }) => id));
      const history = this.steps.get(viewId) ?? [];
      history.push(scene.objects.tokens);
      this.steps.set(viewId, history);
      this.views.update(viewId, { objects: { ...scene.objects, tokens } });
    }
    return { ok: true, positions: Object.freeze(Object.fromEntries(landings.map(({ id, x, y }) => [id, frozenPoint({ x, y })]))) };
  }
}
