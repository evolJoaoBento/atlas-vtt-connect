import { t } from "./englishTexts-4g_ZrbBk.js";
const REFERENCE_CELL_SIZE = 70;
const REFERENCE_STROKE_WIDTH = 4;
function computeTokenStrokeWidth(gridSize) {
  return Math.max(1, Math.round(gridSize * REFERENCE_STROKE_WIDTH / REFERENCE_CELL_SIZE));
}
function tokenDiameterInCells(sizeInCells) {
  return 2 * sizeInCells - 1;
}
const TOKEN_SIZE_OPTIONS = [
  { label: t("token.size.medium"), size: 1 },
  { label: t("token.size.large"), size: 1.5 },
  { label: t("token.size.huge"), size: 2 },
  { label: t("token.size.gargantuan"), size: 2.5 }
];
const CREATURE_SIZE_MULTIPLIERS = { tiny: 1, small: 1, medium: 1, large: 1.5, huge: 2, gargantuan: 2.5 };
function tokenSizeFromCreatureSize(value) {
  if (typeof value !== "string") return void 0;
  const word = value.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return CREATURE_SIZE_MULTIPLIERS[word];
}
function computeTokenPixelSize(gridSize, sizeInCells) {
  const strokeWidth = computeTokenStrokeWidth(gridSize);
  return (gridSize - 2 * strokeWidth) * tokenDiameterInCells(sizeInCells);
}
const TOKEN_UI_REFERENCE_SIZE = computeTokenPixelSize(REFERENCE_CELL_SIZE, 1);
function tokenUIScale(spriteSize) {
  return spriteSize / TOKEN_UI_REFERENCE_SIZE;
}
const RESIZE_HANDLE_SIZE = 20;
const NAMEPLATE_HEIGHT = 14;
function restingTokenUIScale(gridSize) {
  return tokenUIScale(computeTokenPixelSize(gridSize, 1));
}
const SELECTED_TOKEN_UI_SCREEN_SCALE = 2.25;
function selectedTokenUIScale(restingScale, zoom) {
  return Math.max(restingScale, SELECTED_TOKEN_UI_SCREEN_SCALE / zoom);
}
const SQRT3 = Math.sqrt(3);
function isHexGridType(type) {
  return type === "hex-horizontal" || type === "hex-vertical";
}
function hexOrientationForGridType(type) {
  return type === "hex-horizontal" ? "flat" : "pointy";
}
function createHexLayout(type, size, originX, originY) {
  return { orientation: hexOrientationForGridType(type), size, originX, originY };
}
function hexCircumradius(size) {
  return size / SQRT3;
}
function hexCellExtent(layout) {
  const diameter = 2 * hexCircumradius(layout.size);
  return layout.orientation === "pointy" ? { width: layout.size, height: diameter } : { width: diameter, height: layout.size };
}
function hexOriginCenter(layout) {
  const { width, height } = hexCellExtent(layout);
  return { x: layout.originX + width / 2, y: layout.originY + height / 2 };
}
function axialToPixel(layout, hex) {
  const radius = hexCircumradius(layout.size);
  const origin = hexOriginCenter(layout);
  if (layout.orientation === "pointy") {
    return {
      x: origin.x + layout.size * (hex.q + hex.r / 2),
      y: origin.y + 1.5 * radius * hex.r
    };
  }
  return {
    x: origin.x + 1.5 * radius * hex.q,
    y: origin.y + layout.size * (hex.r + hex.q / 2)
  };
}
function pixelToFractionalAxial(layout, point) {
  const radius = hexCircumradius(layout.size);
  const origin = hexOriginCenter(layout);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (layout.orientation === "pointy") {
    return {
      q: (SQRT3 / 3 * dx - dy / 3) / radius,
      r: 2 / 3 * dy / radius
    };
  }
  return {
    q: 2 / 3 * dx / radius,
    r: (-dx / 3 + SQRT3 / 3 * dy) / radius
  };
}
function axialRound(fractional) {
  const fs = -fractional.q - fractional.r;
  let q = Math.round(fractional.q);
  let r = Math.round(fractional.r);
  const s = Math.round(fs);
  const qDiff = Math.abs(q - fractional.q);
  const rDiff = Math.abs(r - fractional.r);
  const sDiff = Math.abs(s - fs);
  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  }
  return { q: q + 0, r: r + 0 };
}
function pixelToAxial(layout, point) {
  return axialRound(pixelToFractionalAxial(layout, point));
}
function axialDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}
function nearestHexCenter(layout, point) {
  return axialToPixel(layout, pixelToAxial(layout, point));
}
function hexVertices(layout, center) {
  const radius = hexCircumradius(layout.size);
  const startAngle = layout.orientation === "pointy" ? -Math.PI / 2 : 0;
  const vertices = [];
  for (let i = 0; i < 6; i++) {
    const angle = startAngle + Math.PI / 3 * i;
    vertices.push({
      x: center.x + radius * Math.cos(angle),
      y: center.y + radius * Math.sin(angle)
    });
  }
  return vertices;
}
function pathLengthInCells(grid, points, diagonalRule) {
  if (isHexGridType(grid.type)) {
    const layout = createHexLayout(grid.type, grid.size, grid.offsetX ?? 0, grid.offsetY ?? 0);
    const cells = points.map((point) => pixelToAxial(layout, point));
    let steps = 0;
    for (let i = 1; i < cells.length; i++) steps += axialDistance(cells[i - 1], cells[i]);
    return steps;
  }
  let straight = 0;
  let diagonal = 0;
  let euclidean = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = Math.abs(points[i].x - points[i - 1].x) / grid.size;
    const dy = Math.abs(points[i].y - points[i - 1].y) / grid.size;
    straight += Math.abs(dx - dy);
    diagonal += Math.min(dx, dy);
    euclidean += Math.hypot(dx, dy);
  }
  switch (diagonalRule) {
    case "euclidean":
      return euclidean;
    case "alternating":
      return straight + diagonal + Math.floor(diagonal / 2);
    case "equidistant":
      return straight + diagonal;
  }
}
function cellCenterAt(grid, point) {
  const offsetX = grid.offsetX ?? 0;
  const offsetY = grid.offsetY ?? 0;
  if (isHexGridType(grid.type)) return nearestHexCenter(createHexLayout(grid.type, grid.size, offsetX, offsetY), point);
  return {
    x: Math.floor((point.x - offsetX) / grid.size) * grid.size + offsetX + grid.size / 2,
    y: Math.floor((point.y - offsetY) / grid.size) * grid.size + offsetY + grid.size / 2
  };
}
const DEFAULT_CONE_ANGLE = 90;
function isValidConeAngle(angle) {
  return typeof angle === "number" && angle > 0 && angle <= 360;
}
function sceneUnitDistance(grid) {
  const distance = grid == null ? void 0 : grid.unitDistanceOverride;
  return typeof distance === "number" && Number.isFinite(distance) && distance > 0 ? distance : void 0;
}
function resolveMeasurementSettings(collection, grid) {
  const rules = collection ? collectionMeasurement(collection) : gridMeasurement(grid);
  const override = rules.mode === "abstract" ? void 0 : sceneUnitDistance(grid);
  return { ...rules, unitDistance: override ?? rules.ruleDistance };
}
function collectionMeasurement(collection) {
  return {
    mode: collection.measurementMode,
    unitType: collection.unitType,
    ruleDistance: collection.unitDistance,
    diagonalRule: collection.diagonalRule ?? "equidistant",
    rangeBands: collection.abstractRangeBands ?? [],
    coneAngle: collection.coneAngle ?? DEFAULT_CONE_ANGLE
  };
}
function gridMeasurement(grid) {
  return {
    // Older maps may store 'daggerheart' or nothing; both measure in range bands.
    mode: (grid == null ? void 0 : grid.measurementType) === "units" ? "metric" : "abstract",
    unitType: (grid == null ? void 0 : grid.unitType) ?? "feet",
    ruleDistance: (grid == null ? void 0 : grid.unitDistance) ?? 5,
    diagonalRule: "equidistant",
    rangeBands: [],
    coneAngle: DEFAULT_CONE_ANGLE
  };
}
const UNIT_SUFFIX = { feet: "ft", yards: "yd", meters: "m", units: "u", custom: "" };
function unitLabelFor(unitType) {
  if (unitType === "units" || unitType === "custom") return "";
  return UNIT_SUFFIX[unitType ?? "feet"];
}
function formatDistance(cells, settings) {
  if (settings.mode === "abstract") return rangeBandName(cells, settings.rangeBands);
  return `${Math.round(cells * settings.unitDistance)}${UNIT_SUFFIX[settings.unitType]}`;
}
function formatReach(cells, settings) {
  const tenths = (value) => Math.round(value * 10) / 10;
  if (settings.mode === "abstract") return settings.rangeBands.length > 0 ? rangeBandName(cells, settings.rangeBands) : `${tenths(cells)} sq`;
  return `${tenths(cells * settings.unitDistance)}${UNIT_SUFFIX[settings.unitType]}`;
}
function isValidRangeBandThreshold(maxSquares) {
  return Number.isInteger(maxSquares) && maxSquares >= 1;
}
function areRangeBandsValid(bands) {
  return (bands ?? []).every((band) => isValidRangeBandThreshold(band.maxSquares));
}
function rangeBandName(cells, bands) {
  const squares = Math.round(cells);
  if (bands.length === 0) return `${squares} sq`;
  return (bands.find((band) => squares <= band.maxSquares) ?? bands[bands.length - 1]).name;
}
export {
  pixelToFractionalAxial as A,
  rangeBandName as B,
  resolveMeasurementSettings as C,
  DEFAULT_CONE_ANGLE as D,
  sceneUnitDistance as E,
  unitLabelFor as F,
  NAMEPLATE_HEIGHT as N,
  RESIZE_HANDLE_SIZE as R,
  TOKEN_SIZE_OPTIONS as T,
  computeTokenStrokeWidth as a,
  tokenSizeFromCreatureSize as b,
  computeTokenPixelSize as c,
  tokenUIScale as d,
  axialToPixel as e,
  formatDistance as f,
  hexCircumradius as g,
  hexOriginCenter as h,
  isHexGridType as i,
  hexCellExtent as j,
  pixelToAxial as k,
  hexOrientationForGridType as l,
  createHexLayout as m,
  areRangeBandsValid as n,
  axialDistance as o,
  pathLengthInCells as p,
  axialRound as q,
  restingTokenUIScale as r,
  selectedTokenUIScale as s,
  tokenDiameterInCells as t,
  cellCenterAt as u,
  formatReach as v,
  hexVertices as w,
  isValidConeAngle as x,
  isValidRangeBandThreshold as y,
  nearestHexCenter as z
};
