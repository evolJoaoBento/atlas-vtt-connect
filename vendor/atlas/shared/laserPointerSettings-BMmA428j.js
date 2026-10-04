const HEX_COLOR = /^#[0-9a-f]{6}$/i;
function isHexColor(value) {
  return typeof value === "string" && HEX_COLOR.test(value);
}
const LASER_COLOR_SWATCHES = [
  { value: "#ff0059", label: "Red" },
  { value: "#ff9f2e", label: "Orange" },
  { value: "#fff133", label: "Yellow" },
  { value: "#66ffa9", label: "Mint" },
  { value: "#00a9ff", label: "Sky blue" },
  { value: "#3d6bff", label: "Blue" },
  { value: "#e85aa8", label: "Pink" },
  { value: "#ffffff", label: "White" }
];
const LASER_COLOR_HINT = "Sky blue, blue and white stay clear for colour-blind players.";
const LASER_SIZE_MIN = 8;
const LASER_SIZE_MAX = 100;
const DEFAULT_LASER_POINTER_SETTINGS = {
  color: LASER_COLOR_SWATCHES[0].value,
  size: 16
};
const LASER_FADE_TIME = 800;
function resolveLaserPointerSettings(raw) {
  const color = isHexColor(raw == null ? void 0 : raw.color) ? raw.color : DEFAULT_LASER_POINTER_SETTINGS.color;
  const size = typeof (raw == null ? void 0 : raw.size) === "number" && Number.isFinite(raw.size) ? Math.min(LASER_SIZE_MAX, Math.max(LASER_SIZE_MIN, raw.size)) : DEFAULT_LASER_POINTER_SETTINGS.size;
  return { color, size };
}
export {
  DEFAULT_LASER_POINTER_SETTINGS as D,
  LASER_FADE_TIME as L,
  LASER_COLOR_HINT as a,
  LASER_COLOR_SWATCHES as b,
  LASER_SIZE_MAX as c,
  LASER_SIZE_MIN as d,
  isHexColor as i,
  resolveLaserPointerSettings as r
};
