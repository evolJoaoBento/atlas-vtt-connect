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
