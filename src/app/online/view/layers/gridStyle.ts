/**
 * Atlas's grid line styles (`gridLineStyle.ts`, `squareGridDrawer.ts`, `hexGridDrawer.ts`, `gridLines.ts`), applied to
 * the lines the view builds: a dashed grid draws every cell edge as two centred dashes (one when the edge is short), a
 * dotted grid a filled cross-shaped marker at every vertex instead of edges, and lines thinner than a device pixel are
 * drawn a pixel wide and as much fainter. Shared with the web page.
 */
import type { GridLines } from '../../preview/previewShapes';
import type { PlayerGrid, ScenePoint } from '../../scene/sceneTypes';

/** What to draw: open strokes (edges or dashes), closed outlines (solid hexes) and filled vertex markers. */
export interface StyledGrid {
  strokes: ScenePoint[][];
  outlines: ScenePoint[][];
  markers: ScenePoint[][];
}

/** Arm length of a dotted grid's vertex markers (`gridMarkerArmLength`). */
export function gridMarkerArmLength(cellSize: number): number {
  return Math.max(3, cellSize * 0.08);
}

/**
 * How lines `width` world units wide are drawn where a device pixel is `pixel` world units (`lineDrawing`): as set, or
 * a pixel wide and fainter by as much as they were thinner. A dotted grid's markers widen too, their arms never shorter
 * than they are thick.
 */
export function lineDrawing(lineType: PlayerGrid['lineType'], width: number, arm: number, pixel: number): { width: number; arm: number; ink: number } {
  if (!(width > 0) || !(pixel > 0) || width >= pixel) return { width, arm, ink: 1 };
  if (lineType !== 'dotted') return { width: pixel, arm, ink: width / pixel };
  const wide = width * 2 ** Math.ceil(Math.log2(pixel / width));
  const longer = Math.max(arm, wide);
  return { width: wide, arm: longer, ink: (width * arm) / (wide * longer) };
}

/** The lines in the grid's style; `thickness` and `arm` size the dotted markers. */
export function styleGrid(lines: GridLines, grid: PlayerGrid, thickness: number, arm: number): StyledGrid {
  if (grid.lineType === 'solid') return { strokes: lines.segments.map(([a, b]) => [a, b]), outlines: lines.hexes, markers: [] };
  if (grid.lineType === 'dotted' && lines.hexes.length === 0) return { strokes: [], outlines: [], markers: crossings(lines, thickness, arm) };
  const edges = lines.hexes.length > 0 ? hexEdges(lines.hexes) : squareEdges(lines, grid.size);
  if (grid.lineType === 'dashed') return { strokes: edges.flatMap(([a, b]) => dashes(a, b)), outlines: [], markers: [] };
  return { strokes: [], outlines: [], markers: vertexMarkers(edges, thickness, arm) };
}

const CROSS_ARMS: readonly ScenePoint[] = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];

/** A square grid's markers: a cross where every vertical line meets every horizontal one (`drawSquareGrid`). */
function crossings(lines: GridLines, thickness: number, arm: number): ScenePoint[][] {
  const xs = lines.segments.filter(([a, b]) => a.x === b.x).map(([a]) => a.x);
  const ys = lines.segments.filter(([a, b]) => a.y === b.y).map(([a]) => a.y);
  const markers: ScenePoint[][] = [];
  for (const x of xs) {
    for (const y of ys) {
      const marker = vertexMarker({ x, y }, CROSS_ARMS, arm, thickness);
      if (marker) markers.push(marker);
    }
  }
  return markers;
}

/** A square grid's lines cut into cell edges, from the map's corner as Atlas cuts them. */
function squareEdges(lines: GridLines, size: number): Array<[ScenePoint, ScenePoint]> {
  const edges: Array<[ScenePoint, ScenePoint]> = [];
  for (const [a, b] of lines.segments) {
    const vertical = a.x === b.x;
    const from = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const to = vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    for (let start = Math.floor(from / size) * size; start < to; start += size) {
      const s = Math.max(from, start);
      const e = Math.min(to, start + size);
      if (e - s <= 1e-6) continue;
      edges.push(vertical ? [{ x: a.x, y: s }, { x: a.x, y: e }] : [{ x: s, y: a.y }, { x: e, y: a.y }]);
    }
  }
  return edges;
}

const pointKey = (point: ScenePoint): string => `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;

/** Every hex edge once, though neighbouring hexes share it, so no edge is drawn twice. */
function hexEdges(hexes: readonly ScenePoint[][]): Array<[ScenePoint, ScenePoint]> {
  const seen = new Set<string>();
  const edges: Array<[ScenePoint, ScenePoint]> = [];
  for (const hex of hexes) {
    hex.forEach((a, index) => {
      const b = hex[(index + 1) % hex.length]!;
      const ka = pointKey(a);
      const kb = pointKey(b);
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push([a, b]);
    });
  }
  return edges;
}

/** Atlas's `drawDashedSegment`: two centred dashes, or one when the edge is too short, so every edge has one rhythm. */
function dashes(a: ScenePoint, b: ScenePoint): ScenePoint[][] {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length <= 1e-3) return [];
  const dx = (b.x - a.x) / length;
  const dy = (b.y - a.y) / length;
  const preferredGap = 4;
  const minDashLength = 1;
  const shortening = 0.8;
  for (const count of [2, 1]) {
    const dash = ((length - (count + 1) * preferredGap) / count) * shortening;
    if (dash < minDashLength) continue;
    const gap = (length - count * dash) / (count + 1);
    const out: ScenePoint[][] = [];
    let cursor = gap;
    for (let i = 0; i < count; i++) {
      out.push([{ x: a.x + dx * cursor, y: a.y + dy * cursor }, { x: a.x + dx * (cursor + dash), y: a.y + dy * (cursor + dash) }]);
      cursor += dash + gap;
    }
    return out;
  }
  return [];
}

/** A marker at every vertex the edges meet at, with an arm along each edge (`drawVertexMarker`). */
function vertexMarkers(edges: ReadonlyArray<readonly [ScenePoint, ScenePoint]>, thickness: number, arm: number): ScenePoint[][] {
  const vertices = new Map<string, { at: ScenePoint; arms: Map<number, ScenePoint> }>();
  const addArm = (at: ScenePoint, to: ScenePoint): void => {
    const key = pointKey(at);
    const vertex = vertices.get(key) ?? { at, arms: new Map() };
    vertices.set(key, vertex);
    const length = Math.hypot(to.x - at.x, to.y - at.y);
    if (length <= 1e-6) return;
    const direction = { x: (to.x - at.x) / length, y: (to.y - at.y) / length };
    // Collinear edges of a square grid's lines give the same arm twice: keep one per angle.
    vertex.arms.set(Math.round(Math.atan2(direction.y, direction.x) * 1000), direction);
  };
  for (const [a, b] of edges) {
    addArm(a, b);
    addArm(b, a);
  }
  const markers: ScenePoint[][] = [];
  for (const { at, arms } of vertices.values()) {
    const marker = vertexMarker(at, [...arms.values()], arm, thickness);
    if (marker) markers.push(marker);
  }
  return markers;
}

/** One filled polygon: an arm per direction joined at the centre, so its middle stays crisp at any opacity. */
function vertexMarker(centre: ScenePoint, directions: readonly ScenePoint[], armLength: number, thickness: number): ScenePoint[] | null {
  const arms = directions.map((d) => ({ x: d.x, y: d.y, angle: Math.atan2(d.y, d.x) })).sort((a, b) => a.angle - b.angle);
  if (arms.length < 2) return null;
  const half = thickness / 2;
  const points: ScenePoint[] = [];
  arms.forEach((arm, index) => {
    const next = arms[(index + 1) % arms.length]!;
    const normalX = -arm.y;
    const normalY = arm.x;
    const tipX = centre.x + arm.x * armLength;
    const tipY = centre.y + arm.y * armLength;
    points.push({ x: tipX - normalX * half, y: tipY - normalY * half }, { x: tipX + normalX * half, y: tipY + normalY * half });
    let sweep = next.angle - arm.angle;
    if (sweep <= 0) sweep += Math.PI * 2;
    const bisector = arm.angle + sweep / 2;
    const corner = half / Math.sin(sweep / 2);
    points.push({ x: centre.x + Math.cos(bisector) * corner, y: centre.y + Math.sin(bisector) * corner });
  });
  return points;
}

/** Mean luminance (0–255) above which a map counts as bright (`gridContrastColor.ts`). */
const BRIGHT_MAP_THRESHOLD = 128;

/** Atlas's automatic grid colour: black lines on a bright map, white on a dark one; white while it is unknown. */
export function contrastGridColor(meanLuminance: number | null): string {
  return meanLuminance !== null && meanLuminance > BRIGHT_MAP_THRESHOLD ? '#000000' : '#ffffff';
}
