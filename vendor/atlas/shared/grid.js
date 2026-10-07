import { h as hexOriginCenter, e as axialToPixel, g as hexCircumradius, i as isHexGridType, j as hexCellExtent, k as pixelToAxial, t as tokenDiameterInCells, l as hexOrientationForGridType, m as createHexLayout } from "./measurementFormat-CHcbPSIg.js";
import { D, n, o, q, u, f, v, w, x, y, z, p, A, B, C, E, F } from "./measurementFormat-CHcbPSIg.js";
function isCellNumberFormat(value) {
  return value === "column-row" || value === "sequential" || value === "letter-number";
}
const DEFAULT_CELL_NUMBER_OPACITY = 0.8;
function cellNumberStyleOfGrid(grid) {
  if (!grid || !isCellNumberFormat(grid.cellNumbers)) return void 0;
  return { format: grid.cellNumbers, opacity: grid.cellNumberOpacity ?? DEFAULT_CELL_NUMBER_OPACITY };
}
const EDGE_MARGIN = 0.4;
const EPSILON = 1e-6;
function padded(value, digits) {
  return String(value).padStart(digits, "0");
}
function columnLetters(column) {
  let n2 = column;
  let letters = "";
  while (n2 > 0) {
    const remainder = (n2 - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n2 = Math.floor((n2 - 1) / 26);
  }
  return letters;
}
function numberCells(lattice, map, format) {
  if (!(lattice.size > 0) || !(map.width > 0) || !(map.height > 0)) return [];
  const cells = lattice.cellsOnMap(map);
  if (format === "sequential") {
    const readingOrder = [...cells].sort((a, b) => a.row - b.row || a.column - b.column);
    return readingOrder.map((cell, index) => ({
      key: cell.key,
      center: cell.center,
      label: String(index + 1)
    }));
  }
  if (format === "letter-number") {
    return cells.map((cell) => ({
      key: cell.key,
      center: cell.center,
      label: columnLetters(cell.column + 1) + String(cell.row + 1)
    }));
  }
  const columns = cells.reduce((most, cell) => Math.max(most, cell.column + 1), 0);
  const rows = cells.reduce((most, cell) => Math.max(most, cell.row + 1), 0);
  const columnDigits = Math.max(2, String(columns).length);
  const rowDigits = Math.max(2, String(rows).length);
  return cells.map((cell) => ({
    key: cell.key,
    center: cell.center,
    label: padded(cell.column + 1, columnDigits) + padded(cell.row + 1, rowDigits)
  }));
}
function cellLabelsByKey(cells) {
  return new Map(cells.map((cell) => [cell.key, cell.label]));
}
function cellNumberAnchor(size, center) {
  return { x: center.x, y: center.y - 0.37 * size };
}
function cellNumberFontSize(size) {
  return 0.16 * size;
}
const SQRT3 = Math.sqrt(3);
function withinPeriod(value, period) {
  if (!(period > 0) || !Number.isFinite(value)) return value;
  const rest = value % period;
  return rest < 0 ? rest + period : rest;
}
function squareOffset(offset, size) {
  return withinPeriod(offset, size);
}
function hexLayoutNearZero(layout) {
  const along = layout.size;
  const across = SQRT3 * layout.size;
  const [periodX, periodY] = layout.orientation === "pointy" ? [along, across] : [across, along];
  return { ...layout, originX: withinPeriod(layout.originX, periodX), originY: withinPeriod(layout.originY, periodY) };
}
const MAX_GRID_OFFSET = 1e5;
function axialKey(coord) {
  return `${coord.q},${coord.r}`;
}
function hexLattice(layout) {
  return {
    size: layout.size,
    cellsOnMap(map) {
      return hexesOnMap(layout, map);
    }
  };
}
function hexesOnMap(given, map) {
  const layout = Math.abs(given.originX) > MAX_GRID_OFFSET || Math.abs(given.originY) > MAX_GRID_OFFSET ? hexLayoutNearZero(given) : given;
  const isPointy = layout.orientation === "pointy";
  const size = layout.size;
  const lineSpacing = 1.5 * hexCircumradius(size);
  const origin = hexOriginCenter(layout);
  const margin = EDGE_MARGIN * size;
  const acrossOrigin = isPointy ? origin.y : origin.x;
  const alongOrigin = isPointy ? origin.x : origin.y;
  const acrossMin = (isPointy ? map.y : map.x) + margin;
  const acrossMax = (isPointy ? map.y + map.height : map.x + map.width) - margin;
  const alongMin = (isPointy ? map.x : map.y) + margin;
  const alongMax = (isPointy ? map.x + map.width : map.y + map.height) - margin;
  const firstLine = Math.ceil((acrossMin - acrossOrigin) / lineSpacing - EPSILON);
  const lastLine = Math.floor((acrossMax - acrossOrigin) / lineSpacing + EPSILON);
  const hexes = [];
  for (let line = firstLine; line <= lastLine; line++) {
    const phase = line / 2;
    const firstHex = Math.ceil((alongMin - alongOrigin) / size - phase - EPSILON);
    const lastHex = Math.floor((alongMax - alongOrigin) / size - phase + EPSILON);
    for (let index = firstHex; index <= lastHex; index++) {
      const coord = isPointy ? { q: index, r: line } : { q: line, r: index };
      const lineNumber = line - firstLine;
      const indexInLine = index - firstHex;
      const cell = {
        key: axialKey(coord),
        center: axialToPixel(layout, coord),
        row: isPointy ? lineNumber : indexInLine,
        column: isPointy ? indexInLine : lineNumber
      };
      hexes.push(cell);
    }
  }
  return hexes;
}
function cellKey(col, row) {
  return `${col},${row}`;
}
function squareLattice(size, offsetX, offsetY) {
  return {
    size,
    cellsOnMap(map) {
      return squaresOnMap(size, squareOffset(offsetX, size), squareOffset(offsetY, size), map);
    }
  };
}
function squaresOnMap(size, offsetX, offsetY, map) {
  const margin = EDGE_MARGIN * size;
  const firstCol = Math.ceil((map.x + margin - offsetX) / size - 0.5 - EPSILON);
  const lastCol = Math.floor((map.x + map.width - margin - offsetX) / size - 0.5 + EPSILON);
  const firstRow = Math.ceil((map.y + margin - offsetY) / size - 0.5 - EPSILON);
  const lastRow = Math.floor((map.y + map.height - margin - offsetY) / size - 0.5 + EPSILON);
  const cells = [];
  for (let r = firstRow; r <= lastRow; r++) {
    for (let col = firstCol; col <= lastCol; col++) {
      cells.push({
        key: cellKey(col, r),
        center: { x: offsetX + (col + 0.5) * size, y: offsetY + (r + 0.5) * size },
        row: r - firstRow,
        column: col - firstCol
      });
    }
  }
  return cells;
}
function mod(value, period) {
  return (value % period + period) % period;
}
function normaliseGridOffset(gridType, cellSize, offsetX, offsetY) {
  if (!isHexGridType(gridType)) return { offsetX: mod(offsetX, cellSize), offsetY: mod(offsetY, cellSize) };
  const layout = createHexLayout(gridType, cellSize, offsetX, offsetY);
  const anchor = axialToPixel(layout, pixelToAxial(layout, { x: 0, y: 0 }));
  const extent = hexCellExtent(layout);
  return { offsetX: anchor.x - extent.width / 2, offsetY: anchor.y - extent.height / 2 };
}
function gridOffsetCenteredAt(gridType, cellSize, point) {
  const extent = isHexGridType(gridType) ? hexCellExtent(createHexLayout(gridType, cellSize, 0, 0)) : { width: cellSize, height: cellSize };
  return { offsetX: point.x - extent.width / 2, offsetY: point.y - extent.height / 2 };
}
function tokenCenterShift(gridType, cellSize, tokenSize) {
  if (tokenDiameterInCells(tokenSize) % 2 !== 0) return { x: 0, y: 0 };
  if (!isHexGridType(gridType)) return { x: cellSize / 2, y: cellSize / 2 };
  const radius = hexCircumradius(cellSize);
  return hexOrientationForGridType(gridType) === "pointy" ? { x: cellSize / 2, y: radius / 2 } : { x: radius / 2, y: cellSize / 2 };
}
function snapTokenCenter(point, tokenSize, gridType, cellSize, snapToCell) {
  const shift = tokenCenterShift(gridType, cellSize, tokenSize);
  const cell = snapToCell({ x: point.x - shift.x, y: point.y - shift.y });
  return { x: cell.x + shift.x, y: cell.y + shift.y };
}
function resizedTokenCenter(center, fromSize, toSize, grid) {
  if (!grid || !(grid.snapToGrid ?? true)) return center;
  if (isHexGridType(grid.type)) {
    const from = tokenCenterShift(grid.type, grid.size, fromSize);
    const to = tokenCenterShift(grid.type, grid.size, toSize);
    return { x: center.x + to.x - from.x, y: center.y + to.y - from.y };
  }
  const shift = (tokenDiameterInCells(toSize) - tokenDiameterInCells(fromSize)) * grid.size / 2;
  return { x: center.x + shift, y: center.y + shift };
}
export {
  DEFAULT_CELL_NUMBER_OPACITY,
  D as DEFAULT_CONE_ANGLE,
  EDGE_MARGIN,
  EPSILON,
  n as areRangeBandsValid,
  o as axialDistance,
  axialKey,
  q as axialRound,
  axialToPixel,
  u as cellCenterAt,
  cellLabelsByKey,
  cellNumberAnchor,
  cellNumberFontSize,
  cellNumberStyleOfGrid,
  createHexLayout,
  f as formatDistance,
  v as formatReach,
  gridOffsetCenteredAt,
  hexCellExtent,
  hexCircumradius,
  hexLattice,
  hexOrientationForGridType,
  hexOriginCenter,
  w as hexVertices,
  isCellNumberFormat,
  isHexGridType,
  x as isValidConeAngle,
  y as isValidRangeBandThreshold,
  z as nearestHexCenter,
  normaliseGridOffset,
  numberCells,
  p as pathLengthInCells,
  pixelToAxial,
  A as pixelToFractionalAxial,
  B as rangeBandName,
  resizedTokenCenter,
  C as resolveMeasurementSettings,
  E as sceneUnitDistance,
  snapTokenCenter,
  squareLattice,
  tokenCenterShift,
  F as unitLabelFor
};
