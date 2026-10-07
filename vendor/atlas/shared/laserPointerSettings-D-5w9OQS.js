import { t } from "./englishTexts-4g_ZrbBk.js";
import { i as isHexColor } from "./hexColor-BorPG-zU.js";
const LASER_COLOR_SWATCHES = [
  { value: "#ff0059", label: t("laser.color.red") },
  { value: "#ff9f2e", label: t("laser.color.orange") },
  { value: "#fff133", label: t("laser.color.yellow") },
  { value: "#66ffa9", label: t("laser.color.mint") },
  { value: "#00a9ff", label: t("laser.color.sky") },
  { value: "#3d6bff", label: t("laser.color.blue") },
  { value: "#e85aa8", label: t("laser.color.pink") },
  { value: "#ffffff", label: t("laser.color.white") }
];
const LASER_COLOR_HINT = t("laser.colorHint");
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
  resolveLaserPointerSettings as r
};
