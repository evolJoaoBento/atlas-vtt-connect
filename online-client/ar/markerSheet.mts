// online-client/ar/markerSheet.mts
/**
 * The printed sheet augmented reality stands the board on: an A4 page with five ArUco markers (dictionary
 * ARUCO_MIP_36h12, ids 0 to 4), one in each corner and one in the middle. Any one of them seen places the board; more
 * seen place it steadier. Each marker's black square is `MARKER_MM` wide when printed at 100%.
 *
 * Sheet coordinates are millimetres from the page's middle: x to the right, y down the page (the way it reads).
 */
import { AR } from 'js-aruco2';

export const DICTIONARY = 'ARUCO_MIP_36h12';
/** The mark printed on a page's top edge (the calibration's drawing shows it too). */
export const TOP_MARK = '▲ TOP';
export const SHEET_WIDTH_MM = 210;
export const SHEET_HEIGHT_MM = 297;
/** The width of a marker's black square. */
export const MARKER_MM = 50;
const MARGIN_MM = 24;

export interface SheetMarker {
  id: number;
  /** The middle of the marker on the sheet. */
  x: number;
  y: number;
}

const cornerX = SHEET_WIDTH_MM / 2 - MARGIN_MM - MARKER_MM / 2;
const cornerY = SHEET_HEIGHT_MM / 2 - MARGIN_MM - MARKER_MM / 2;

export const SHEET_MARKERS: readonly SheetMarker[] = Object.freeze([
  { id: 0, x: -cornerX, y: -cornerY },
  { id: 1, x: cornerX, y: -cornerY },
  { id: 2, x: cornerX, y: cornerY },
  { id: 3, x: -cornerX, y: cornerY },
  { id: 4, x: 0, y: 0 },
]);

/**
 * A marker's four corners on the sheet, in the order the detector gives them: its top left, top right, bottom right,
 * bottom left (as printed, upright). Null for an id not on the sheet.
 */
export function markerCorners(id: number): Array<{ x: number; y: number }> | null {
  const marker = SHEET_MARKERS.find((entry) => entry.id === id);
  if (!marker) return null;
  const half = MARKER_MM / 2;
  return [
    { x: marker.x - half, y: marker.y - half },
    { x: marker.x + half, y: marker.y - half },
    { x: marker.x + half, y: marker.y + half },
    { x: marker.x - half, y: marker.y + half },
  ];
}

/** A marker's cells, row by row (true for white), its black border included: `size` × `size`. */
export function markerCells(id: number): { size: number; white: boolean[] } {
  const dictionary = new AR.Dictionary(DICTIONARY);
  const code = dictionary.codeList[id];
  if (code === undefined) throw new Error(`No marker ${id} in ${DICTIONARY}`);
  const size = dictionary.markSize;
  const inner = size - 2;
  const white: boolean[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      white.push(!border && code[(y - 1) * inner + (x - 1)] === '1');
    }
  }
  return { size, white };
}

const mm = (value: number): string => String(Math.round(value * 1000) / 1000);

/** The sheet to print, as an SVG of the page's real size (A4, in millimetres). */
export function markerSheetSvg(): string {
  const parts: string[] = [];
  const left = (x: number): number => x + SHEET_WIDTH_MM / 2;
  const top = (y: number): number => y + SHEET_HEIGHT_MM / 2;
  for (const marker of SHEET_MARKERS) {
    const { size, white } = markerCells(marker.id);
    const cell = MARKER_MM / size;
    const x0 = left(marker.x) - MARKER_MM / 2;
    const y0 = top(marker.y) - MARKER_MM / 2;
    parts.push(`<rect x="${mm(x0)}" y="${mm(y0)}" width="${mm(MARKER_MM)}" height="${mm(MARKER_MM)}" fill="#000"/>`);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // A hair over the cell, so no seam shows between white cells.
        if (white[y * size + x]) parts.push(`<rect x="${mm(x0 + x * cell)}" y="${mm(y0 + y * cell)}" width="${mm(cell + 0.02)}" height="${mm(cell + 0.02)}" fill="#fff"/>`);
      }
    }
  }
  // Words and a ruler in the margins, clear of the markers' white surround.
  const text = (x: number, y: number, size: number, words: string, anchor = 'middle'): string =>
    `<text x="${mm(x)}" y="${mm(y)}" font-family="sans-serif" font-size="${size}" text-anchor="${anchor}" fill="#444">${words}</text>`;
  parts.push(text(SHEET_WIDTH_MM / 2, 9, 4.2, 'TOP · Atlas VTT augmented reality sheet'));
  parts.push(text(SHEET_WIDTH_MM / 2, 14, 3, `Print at 100% (no fit to page). Each black square must measure ${MARKER_MM} mm.`));
  const rulerY = SHEET_HEIGHT_MM - 9;
  const rulerX = SHEET_WIDTH_MM / 2 - 50;
  parts.push(`<rect x="${mm(rulerX)}" y="${mm(rulerY)}" width="100" height="1.2" fill="#444"/>`);
  for (let i = 0; i <= 10; i++) parts.push(`<rect x="${mm(rulerX + i * 10 - 0.2)}" y="${mm(rulerY - 2)}" width="0.4" height="2" fill="#444"/>`);
  parts.push(text(SHEET_WIDTH_MM / 2, rulerY + 5.5, 3, 'This bar is 100 mm. Lay the sheet flat, top away from you.'));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH_MM}mm" height="${SHEET_HEIGHT_MM}mm" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}">`
    + `<rect width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="#fff"/>${parts.join('')}</svg>`;
}

// ── Marker cards ──────────────────────────────────────────────────────────────
// Small markers to cut out and lay anywhere round the map, each its own: seen together with one already placed, a card
// is placed too (`markerLayout.mts`). Leaning in, one card in sight is enough.

/** The width of a card's black square. */
export const CARD_MM = 40;
/** The first card's marker id: the sheet's are below it. */
export const FIRST_CARD = 10;
/** Cards on a printed page: three across, four down. */
export const CARDS_PER_PAGE = 12;
/** Pages of cards offered. */
export const CARD_PAGES = 2;

/** Whether `id` is one of the cards'. */
export function isCard(id: number): boolean {
  return Number.isInteger(id) && id >= FIRST_CARD && id < FIRST_CARD + CARDS_PER_PAGE * CARD_PAGES;
}

/** A card's number as printed on it (1 for the first). */
export const cardNumber = (id: number): number => id - FIRST_CARD + 1;

/**
 * What a marker id belongs to, and its corners in that thing's own frame (millimetres; the detector's corner order):
 * the A4 sheet (its markers fixed on it), or a card of its own (its middle the origin). Null for an id of neither.
 */
export function markerGroup(id: number): { group: string; corners: Array<{ x: number; y: number }> } | null {
  const onSheet = markerCorners(id);
  if (onSheet) return { group: 'sheet', corners: onSheet };
  const onMat = matCorners(id);
  if (onMat) return onMat;
  if (!isCard(id)) return null;
  const half = CARD_MM / 2;
  return { group: `card-${id}`, corners: [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }] };
}

/** A sheet or card's outline on the table, about its middle (millimetres): an A4 page, or a card as cut out. */
export function groupOutline(group: string): { w: number; h: number } {
  if (group.startsWith('card-')) {
    const rows = CARDS_PER_PAGE / 3;
    return { w: Math.round(SHEET_WIDTH_MM / 3), h: Math.round((SHEET_HEIGHT_MM - 24) / rows) };
  }
  return { w: SHEET_WIDTH_MM, h: SHEET_HEIGHT_MM };
}

/** A page of marker cards to print (A4), `page` from 0: cut along the dashed lines. */
export function markerCardsSvg(page: number): string {
  const parts: string[] = [];
  const columns = 3;
  const rows = CARDS_PER_PAGE / columns;
  const cellWidth = SHEET_WIDTH_MM / columns;
  const top = 16;
  const cellHeight = (SHEET_HEIGHT_MM - top - 8) / rows;
  for (let i = 0; i < CARDS_PER_PAGE; i++) {
    const id = FIRST_CARD + page * CARDS_PER_PAGE + i;
    const cx = (i % columns + 0.5) * cellWidth;
    const cy = top + (Math.floor(i / columns) + 0.5) * cellHeight;
    const { size, white } = markerCells(id);
    const cell = CARD_MM / size;
    const x0 = cx - CARD_MM / 2;
    const y0 = cy - CARD_MM / 2 - 4;
    parts.push(`<rect x="${mm(x0)}" y="${mm(y0)}" width="${CARD_MM}" height="${CARD_MM}" fill="#000"/>`);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (white[y * size + x]) parts.push(`<rect x="${mm(x0 + x * cell)}" y="${mm(y0 + y * cell)}" width="${mm(cell + 0.02)}" height="${mm(cell + 0.02)}" fill="#fff"/>`);
      }
    }
    // The card's number under its marker, and a mark for its top.
    parts.push(`<text x="${mm(cx)}" y="${mm(y0 + CARD_MM + 9)}" font-family="sans-serif" font-size="5" text-anchor="middle" fill="#444">${cardNumber(id)}</text>`);
    parts.push(`<text x="${mm(cx)}" y="${mm(y0 - 6)}" font-family="sans-serif" font-size="2.6" text-anchor="middle" fill="#888">▲ top</text>`);
  }
  // Cut lines between the cards.
  const dash = 'stroke="#bbb" stroke-width="0.3" stroke-dasharray="2 2"';
  for (let c = 1; c < columns; c++) parts.push(`<line x1="${mm(c * cellWidth)}" y1="${top}" x2="${mm(c * cellWidth)}" y2="${mm(SHEET_HEIGHT_MM - 8)}" ${dash}/>`);
  for (let r = 0; r <= rows; r++) parts.push(`<line x1="0" y1="${mm(top + r * cellHeight)}" x2="${SHEET_WIDTH_MM}" y2="${mm(top + r * cellHeight)}" ${dash}/>`);
  const first = FIRST_CARD + page * CARDS_PER_PAGE;
  parts.push(`<text x="${SHEET_WIDTH_MM / 2}" y="9" font-family="sans-serif" font-size="3.6" text-anchor="middle" fill="#444">Atlas VTT AR cards ${cardNumber(first)}–${cardNumber(first + CARDS_PER_PAGE - 1)} · print at 100%: each black square ${CARD_MM} mm · cut out, lay flat round the map</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH_MM}mm" height="${SHEET_HEIGHT_MM}mm" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}">`
    + `<rect width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="#fff"/>${parts.join('')}</svg>`;
}

// ── Mat pages ─────────────────────────────────────────────────────────────────
// A4 pages tiled with small markers, laid edge to edge under and round the map: each page is one thing (its markers
// fixed on it), placed from the pages beside it. Close in, a few small markers are always whole in the picture; from
// arm's length they are still big enough to read.

/** The width of a mat marker's black square. */
export const MAT_MM = 30;
/** From one mat marker's middle to the next's. */
export const MAT_PITCH_MM = 45;
const MAT_COLUMNS = 4;
const MAT_ROWS = 6;
export const MATS_PER_PAGE = MAT_COLUMNS * MAT_ROWS;
/** The first mat marker's id. */
export const FIRST_MAT = 40;
/** Mat pages offered. */
export const MAT_PAGES = 6;

/** A mat marker's page (from 0) and its middle on that page (from the page's middle); null for an id of no mat. */
function matSpot(id: number): { page: number; x: number; y: number } | null {
  if (!Number.isInteger(id) || id < FIRST_MAT || id >= FIRST_MAT + MATS_PER_PAGE * MAT_PAGES) return null;
  const index = id - FIRST_MAT;
  const page = Math.floor(index / MATS_PER_PAGE);
  const cell = index % MATS_PER_PAGE;
  const column = cell % MAT_COLUMNS;
  const row = Math.floor(cell / MAT_COLUMNS);
  return { page, x: (column - (MAT_COLUMNS - 1) / 2) * MAT_PITCH_MM, y: (row - (MAT_ROWS - 1) / 2) * MAT_PITCH_MM };
}

/** A mat marker's page and corners on it (the page's middle the origin); null for an id of no mat. */
export function matCorners(id: number): { group: string; corners: Array<{ x: number; y: number }> } | null {
  const spot = matSpot(id);
  if (!spot) return null;
  const half = MAT_MM / 2;
  return {
    group: `mat-${spot.page}`,
    corners: [{ x: spot.x - half, y: spot.y - half }, { x: spot.x + half, y: spot.y - half }, { x: spot.x + half, y: spot.y + half }, { x: spot.x - half, y: spot.y + half }],
  };
}

/** A mat page to print (A4), `page` from 0. */
export function markerMatSvg(page: number): string {
  const parts: string[] = [];
  for (let cell = 0; cell < MATS_PER_PAGE; cell++) {
    const id = FIRST_MAT + page * MATS_PER_PAGE + cell;
    const spot = matSpot(id)!;
    const { size, white } = markerCells(id);
    const unit = MAT_MM / size;
    const x0 = SHEET_WIDTH_MM / 2 + spot.x - MAT_MM / 2;
    const y0 = SHEET_HEIGHT_MM / 2 + spot.y - MAT_MM / 2;
    parts.push(`<rect x="${mm(x0)}" y="${mm(y0)}" width="${MAT_MM}" height="${MAT_MM}" fill="#000"/>`);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (white[y * size + x]) parts.push(`<rect x="${mm(x0 + x * unit)}" y="${mm(y0 + y * unit)}" width="${mm(unit + 0.02)}" height="${mm(unit + 0.02)}" fill="#fff"/>`);
      }
    }
  }
  parts.push(`<text x="${SHEET_WIDTH_MM / 2}" y="7" font-family="sans-serif" font-size="3.4" text-anchor="middle" fill="#666">▲ TOP · Atlas VTT AR mat ${page + 1} · print at 100%: each black square ${MAT_MM} mm · lay pages flat, edge to edge</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH_MM}mm" height="${SHEET_HEIGHT_MM}mm" viewBox="0 0 ${SHEET_WIDTH_MM} ${SHEET_HEIGHT_MM}">`
    + `<rect width="${SHEET_WIDTH_MM}" height="${SHEET_HEIGHT_MM}" fill="#fff"/>${parts.join('')}</svg>`;
}
