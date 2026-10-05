var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
import { L as LASER_FADE_TIME } from "./laserPointerSettings-BMmA428j.js";
import { i } from "./laserPointerSettings-BMmA428j.js";
import { N as NAMEPLATE_HEIGHT, f as formatDistance, p as pathLengthInCells } from "./measurementFormat-DLGvLcYl.js";
import { R, T, c, a, r, s, t, b, d } from "./measurementFormat-DLGvLcYl.js";
const MEASURE_SHADOW = 0;
const MEASURE_PATH_STROKES = [
  { width: 6, alpha: 0.3, shadow: true },
  { width: 4, alpha: 0.8, shadow: false },
  { width: 2, alpha: 1, shadow: false }
];
const MEASURE_POINT = { radius: 8, halo: 3, haloAlpha: 0.3, fillAlpha: 0.9, ringInset: 1, ringWidth: 2 };
const MEASURE_AREA = { fillAlpha: 0.1, strokeWidth: 3, strokeAlpha: 0.8, highlightWidth: 1.5, highlightInset: 1 };
const CONE_ANGLE = Math.PI / 2;
const MEASURE_LABEL_FONT_SIZE = 16;
const LABEL_LIFT = 30;
const MEASURE_LABEL_COLORS = {
  fillAlpha: 0.95,
  dark: { fill: 2763306, stroke: 16777215, strokeAlpha: 0.4 },
  light: { fill: 14935011, stroke: 0, strokeAlpha: 0.3 }
};
function pathMidpoint(points) {
  const segments = points.slice(1).map((end, i2) => {
    const start = points[i2];
    return { start, end, length: Math.hypot(end.x - start.x, end.y - start.y) };
  });
  let remaining = segments.reduce((sum, segment) => sum + segment.length, 0) / 2;
  for (const { start, end, length } of segments) {
    if (length > 0 && remaining <= length) {
      const t2 = remaining / length;
      return { x: start.x + (end.x - start.x) * t2, y: start.y + (end.y - start.y) * t2 };
    }
    remaining -= length;
  }
  return points[0] ?? null;
}
function measureLabelFontSize(viewportScale) {
  return Math.max(12, Math.min(32, MEASURE_LABEL_FONT_SIZE / viewportScale));
}
function measureLabelAnchor(start, end, viewportScale) {
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - LABEL_LIFT / viewportScale };
}
function measureLabelBox(textWidth, textHeight, center, viewportScale) {
  const scaleFactor = 1 / viewportScale;
  const padding = 8 * scaleFactor;
  const width = textWidth + padding * 2;
  const height = Math.max(20 * scaleFactor, textHeight + 4 * scaleFactor);
  return { x: center.x - width / 2, y: center.y - height / 2, width, height, radius: height / 2, strokeWidth: 0.5 * scaleFactor };
}
function coneGeometry(start, end, opening = CONE_ANGLE) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const radius2 = Math.sqrt(dx * dx + dy * dy);
  const baseAngle = Math.atan2(dy, dx);
  const startAngle = baseAngle - opening / 2;
  const endAngle = baseAngle + opening / 2;
  const at = (angle) => ({ x: start.x + radius2 * Math.cos(angle), y: start.y + radius2 * Math.sin(angle) });
  return { radius: radius2, startAngle, endAngle, left: at(startAngle), right: at(endAngle) };
}
function arcPoints(center, radius2, startAngle, endAngle, segments) {
  const steps = Math.max(1, Math.round(segments));
  return Array.from({ length: steps + 1 }, (_, i2) => {
    const angle = startAngle + (endAngle - startAngle) * i2 / steps;
    return { x: center.x + radius2 * Math.cos(angle), y: center.y + radius2 * Math.sin(angle) };
  });
}
const SCENE_LAYER_ORDER = ["map", "grid", "tokens", "texts", "drawings", "fog"];
const SCENE_LAYER_Z = {
  tokens: 0,
  texts: 500,
  /** Above tokens and texts, below fog so hidden areas stay hidden. */
  drawings: 900,
  fog: 1e3
};
const DEFAULT_TEXT_PADDING = 8;
const TEXT_LINE_SPACING = 1.2;
function textBackground(text, bounds) {
  if (!text.backgroundColor) return null;
  const padding = text.padding || DEFAULT_TEXT_PADDING;
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
    color: text.backgroundColor,
    radius: text.borderRadius || 0,
    alpha: text.opacity || 1
  };
}
function textFontWeight(text) {
  return text.bold ? "bold" : "normal";
}
function textFontStyle(text) {
  return text.italic ? "italic" : "normal";
}
function textRotation(rotation) {
  return rotation ? rotation * Math.PI / 180 : 0;
}
function textScale(scale) {
  return scale || 1;
}
const MAP_ICON_SVG = {
  "door-open": '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h3"/><path d="M13 20h9"/><path d="M10 12v.01"/><path d="M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z"/>',
  "door-closed": '<path d="M18 20V6a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v14"/><path d="M2 20h20"/><path d="M14 12v.01"/>',
  "lock": '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "key-round": '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  "triangle-alert": '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  "skull": '<path d="m12.5 17-.5-1-.5 1h1z"/><path d="M15 22a1 1 0 0 0 1-1v-1a2 2 0 0 0 1.56-3.25 8 8 0 1 0-11.12 0A2 2 0 0 0 8 20v1a1 1 0 0 0 1 1z"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="12" r="1"/>',
  "flame": '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  "package": '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z"/><path d="M12 22V12"/><polyline points="3.29 7 12 12 20.71 7"/><path d="m7.5 4.27 9 5.15"/>',
  "gem": '<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>',
  "swords": '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
  "footprints": '<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/>',
  "circle-x": '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'
};
const MAP_ICON_LABELS = {
  "door-open": "Open Door",
  "door-closed": "Closed Door",
  "lock": "Locked",
  "key-round": "Key",
  "triangle-alert": "Trap",
  "skull": "Danger",
  "flame": "Fire",
  "package": "Loot",
  "gem": "Treasure",
  "swords": "Combat",
  "footprints": "Tracks",
  "circle-x": "Blocked"
};
const MAP_ICON_SIZE = 70;
const MAX_TRAIL_SAMPLES = 100;
const MAX_SUBDIVISIONS = 8;
const MAX_BEAM_POINTS = (MAX_TRAIL_SAMPLES + 1) * MAX_SUBDIVISIONS + 1;
const MAX_CAPSULES = MAX_BEAM_POINTS;
const DOT_SCALE = 1.25;
const SMOOTHING_SPACING = 3;
const SMOOTHING_SPACING_PER_WIDTH = 0.25;
const BODY_PER_SIZE = 0.35;
const GLOW_PER_SIZE = 1.15;
const GLOW_MAX = 40;
const MIN_POINT_SPACING = 3;
const MIN_POINT_SPACING_PER_WIDTH = 0.15;
const FILAMENT_SHARE = 0.25;
const FILAMENT_COLOR = 16777215;
function beamSmoothingSpacing(halfWidth, zoom) {
  return Math.max(SMOOTHING_SPACING / zoom, halfWidth * SMOOTHING_SPACING_PER_WIDTH);
}
function beamWidth(size, zoom) {
  const body = size * BODY_PER_SIZE;
  const radius2 = body + Math.min(GLOW_MAX, size * GLOW_PER_SIZE);
  return { halfWidth: radius2 / zoom, bodyShare: body / radius2 };
}
function laserPointSpacing(size, zoom) {
  const { halfWidth } = beamWidth(size, zoom);
  return Math.max(MIN_POINT_SPACING / zoom, halfWidth * MIN_POINT_SPACING_PER_WIDTH);
}
function beamRadius(point, halfWidth) {
  return halfWidth * Math.sqrt(Math.max(0, point.life));
}
function createLaserBeamBuffers() {
  return {
    positions: new Float32Array(MAX_CAPSULES * 4 * 2),
    segments: new Float32Array(MAX_CAPSULES * 4 * 4),
    shapes: new Float32Array(MAX_CAPSULES * 4 * 4),
    indices: new Uint32Array(MAX_CAPSULES * 6)
  };
}
function smoothBeam(points, spacing2) {
  if (points.length < 3) return points.map((point) => ({ ...point }));
  const smoothed = [];
  for (let i2 = 0; i2 < points.length - 1; i2++) {
    const p0 = points[Math.max(0, i2 - 1)];
    const p1 = points[i2];
    const p2 = points[i2 + 1];
    const p3 = points[Math.min(points.length - 1, i2 + 2)];
    const steps = Math.min(MAX_SUBDIVISIONS, Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / spacing2)));
    for (let step = 0; step < steps; step++) {
      const t2 = step / steps;
      smoothed.push({
        x: catmullRom(p0.x, p1.x, p2.x, p3.x, t2),
        y: catmullRom(p0.y, p1.y, p2.y, p3.y, t2),
        life: p1.life + (p2.life - p1.life) * t2
      });
    }
  }
  smoothed.push({ ...points[points.length - 1] });
  return smoothed;
}
function writeLaserBeam(buffers, trail, dot, halfWidth) {
  const writer = new CapsuleWriter(buffers);
  const points = trail.slice(-MAX_BEAM_POINTS);
  const radius2 = (point) => beamRadius(point, halfWidth);
  if (points.length === 1) writer.capsule(points[0], points[0], radius2(points[0]), radius2(points[0]));
  for (let i2 = 1; i2 < points.length; i2++) {
    const a2 = points[i2 - 1];
    const b2 = points[i2];
    writer.capsule(a2, b2, radius2(a2), radius2(b2));
  }
  if (dot) writer.capsule(dot, dot, halfWidth * DOT_SCALE, halfWidth * DOT_SCALE);
  return writer.finish();
}
function catmullRom(p0, p1, p2, p3, t2) {
  const t22 = t2 * t2;
  return 0.5 * (2 * p1 + (p2 - p0) * t2 + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t22 + (3 * p1 - p0 - 3 * p2 + p3) * t22 * t2);
}
class CapsuleWriter {
  constructor(buffers) {
    __publicField(this, "count", 0);
    __publicField(this, "bounds", { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    this.buffers = buffers;
  }
  /** A quad around the segment from `a` to `b`, reaching the larger radius beyond it on every side. */
  capsule(a2, b2, radiusA, radiusB) {
    const reach = Math.max(radiusA, radiusB);
    if (reach <= 0 || this.count >= MAX_CAPSULES) return;
    const length = Math.hypot(b2.x - a2.x, b2.y - a2.y);
    const dx = length > 1e-6 ? (b2.x - a2.x) / length : 1;
    const dy = length > 1e-6 ? (b2.y - a2.y) / length : 0;
    const corners = [
      [a2.x - (dx - dy) * reach, a2.y - (dy + dx) * reach],
      [a2.x - (dx + dy) * reach, a2.y - (dy - dx) * reach],
      [b2.x + (dx - dy) * reach, b2.y + (dy + dx) * reach],
      [b2.x + (dx + dy) * reach, b2.y + (dy - dx) * reach]
    ];
    const first = this.count * 4;
    corners.forEach(([x, y], corner) => {
      const vertex = first + corner;
      this.buffers.positions.set([x, y], vertex * 2);
      this.buffers.segments.set([a2.x, a2.y, b2.x, b2.y], vertex * 4);
      this.buffers.shapes.set([a2.life, b2.life, radiusA, radiusB], vertex * 4);
      this.bounds.minX = Math.min(this.bounds.minX, x);
      this.bounds.minY = Math.min(this.bounds.minY, y);
      this.bounds.maxX = Math.max(this.bounds.maxX, x);
      this.bounds.maxY = Math.max(this.bounds.maxY, y);
    });
    this.buffers.indices.set([first, first + 1, first + 2, first, first + 2, first + 3], this.count * 6);
    this.count++;
  }
  finish() {
    this.buffers.indices.fill(0, this.count * 6);
    return this.count > 0 ? { ...this.bounds } : null;
  }
}
class LaserTrail {
  constructor() {
    __publicField(this, "points", []);
  }
  get length() {
    return this.points.length;
  }
  last() {
    return this.points[this.points.length - 1];
  }
  add(x, y, now) {
    this.points.push({ x, y, timestamp: now });
    if (this.points.length > MAX_TRAIL_SAMPLES) this.points.splice(0, this.points.length - MAX_TRAIL_SAMPLES);
  }
  /** Drops the points that have faded out. */
  prune(now) {
    this.points = this.points.filter((point) => now - point.timestamp < LASER_FADE_TIME);
  }
  /** The trail from oldest to newest, each point with the share of its life left. */
  beamPoints(now) {
    return this.points.map((point) => ({ x: point.x, y: point.y, life: 1 - (now - point.timestamp) / LASER_FADE_TIME }));
  }
  clear() {
    this.points = [];
  }
}
const LASER_STALE_MS = 1e3;
const LASER_PLAYBACK_DELAY_MS = 90;
const REMOTE_LASER_LIMITS = { points: 64, maxGapMs: 2e3, maxAheadMs: 3e3, senders: 32 };
const MAX_PENDING = 256;
const DEFAULT_SPAN_MS = 1e3 / 30;
const MAX_GLIDE_MS = 100;
function limited(points, timing) {
  var _a;
  const skip = Math.max(0, points.length - REMOTE_LASER_LIMITS.points);
  const matching = ((_a = timing.dt) == null ? void 0 : _a.length) === points.length;
  const dt = matching ? timing.dt.slice(skip).map((gap) => gap > 0 ? Math.min(REMOTE_LASER_LIMITS.maxGapMs, gap) : 0) : void 0;
  return { points: skip > 0 ? points.slice(skip) : points, timing: { ...timing, ...dt ? { dt } : {} } };
}
class RemoteLasers {
  constructor() {
    __publicField(this, "entries", /* @__PURE__ */ new Map());
  }
  get isActive() {
    return this.entries.size > 0;
  }
  receive(from, color, sent, lifted, now, sentTiming = {}) {
    const { points, timing } = limited(sent, sentTiming);
    let entry = this.entries.get(from);
    if (!entry) {
      if (points.length === 0 || this.entries.size >= REMOTE_LASER_LIMITS.senders) return;
      entry = { color, trail: new LaserTrail(), lifted, lastAt: now, head: null, pending: [], offset: null, sentAt: 0 };
      this.entries.set(from, entry);
    }
    if (entry.lifted && points.length > 0) {
      entry.offset = null;
      if (entry.pending.length === 0) {
        entry.trail.clear();
        entry.head = null;
      }
    }
    this.enqueue(entry, points, now, timing);
    entry.color = color;
    entry.lifted = lifted;
    entry.lastAt = now;
  }
  /** What to draw now; lasers that faded out are forgotten. */
  frame(now) {
    const frames = [];
    for (const [from, entry] of this.entries) {
      if (!entry.lifted && now - entry.lastAt > LASER_STALE_MS) entry.lifted = true;
      this.play(entry, now);
      entry.trail.prune(now);
      const done = entry.pending.length === 0;
      if (entry.lifted && done && entry.trail.length === 0) {
        this.entries.delete(from);
        continue;
      }
      const head = entry.lifted && done ? null : this.headAt(entry, now);
      const trail = entry.trail.beamPoints(now);
      if (head) trail.push({ x: head.x, y: head.y, life: 1 });
      if (trail.length === 0) continue;
      frames.push({ from, color: entry.color, trail, head });
    }
    return frames;
  }
  clear() {
    this.entries.clear();
  }
  /** Puts the points on the entry's timeline. */
  enqueue(entry, points, now, timing) {
    var _a, _b;
    if (points.length === 0) return;
    if (timing.immediate) {
      for (const point of points) entry.pending.push({ x: point.x, y: point.y, at: now });
      entry.offset = null;
      return;
    }
    const fresh = entry.offset === null;
    const gaps = timing.dt && timing.dt.length === points.length ? timing.dt : points.map(() => DEFAULT_SPAN_MS / points.length);
    let sent = fresh ? 0 : entry.sentAt;
    const times = gaps.map((gap, index) => sent += index === 0 && fresh ? 0 : Math.max(0, gap));
    const first = times[0] ?? 0;
    const last = times[times.length - 1] ?? 0;
    if (entry.offset === null || last + entry.offset < now) entry.offset = now + LASER_PLAYBACK_DELAY_MS - first;
    const offset = entry.offset;
    entry.sentAt = last;
    let previous = ((_a = entry.pending[entry.pending.length - 1]) == null ? void 0 : _a.at) ?? ((_b = entry.head) == null ? void 0 : _b.at) ?? -Infinity;
    points.forEach((point, index) => {
      previous = Math.max(previous, (times[index] ?? 0) + offset);
      entry.pending.push({ x: point.x, y: point.y, at: previous });
    });
    const horizon = now + LASER_PLAYBACK_DELAY_MS + REMOTE_LASER_LIMITS.maxAheadMs;
    while (entry.pending.length > 0 && entry.pending[entry.pending.length - 1].at > horizon) entry.pending.pop();
    if (entry.pending.length > MAX_PENDING) entry.pending.splice(0, entry.pending.length - MAX_PENDING);
  }
  /** Points whose time has come join the trail, which fades each from its own time. */
  play(entry, now) {
    while (entry.pending[0] && entry.pending[0].at <= now) {
      const point = entry.pending.shift();
      entry.trail.add(point.x, point.y, point.at);
      entry.head = point;
    }
  }
  /** The head between the point it left and the one it is heading for. */
  headAt(entry, now) {
    const from = entry.head;
    const to = entry.pending[0];
    if (!from) return null;
    if (!to) return { x: from.x, y: from.y };
    const start = Math.max(from.at, to.at - MAX_GLIDE_MS);
    const span = to.at - start;
    const share = span > 0 ? Math.min(1, Math.max(0, (now - start) / span)) : 1;
    return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
  }
}
const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
  "2xl": 32
};
const radius = {
  xs: 2,
  s: 4,
  m: 6,
  l: 8,
  xl: 12,
  "2xl": 16,
  full: 9999
};
const borderWidth = {
  s: 1,
  m: 1.5,
  l: 2
};
const borderOpacity = {
  subtle: 0.1,
  default: 0.18,
  strong: 0.3
};
const zIndex = {
  base: 1,
  dropdown: 100,
  sticky: 200,
  overlay: 300,
  modal: 400,
  popover: 500,
  tooltip: 600,
  notification: 700,
  // Legacy high values for Obsidian compatibility
  atlasDropdown: 9999,
  atlasModal: 1e4
};
const transition = {
  fast: 100,
  normal: 200,
  slow: 300
};
const iconSize = {
  xs: 12,
  s: 16,
  m: 20,
  l: 24,
  xl: 32
};
const buttonHeight = {
  s: 24,
  m: 32,
  l: 40
};
const inputHeight = {
  s: 28,
  m: 36,
  l: 44
};
const pinSize = {
  badgeRadius: 20,
  iconSize: 22
};
const colors = {
  // Health bar colors
  health: {
    healthy: 2278750,
    // Green - >= 70%
    injured: 15381256,
    // Yellow - 30-69%
    critical: 15680580,
    // Red - < 30%
    background: 1710618
  },
  // Status colors
  status: {
    success: 1096065,
    // Emerald
    warning: 16096779,
    // Amber
    error: 15680580,
    // Red
    info: 3900150
    // Blue
  },
  // UI colors
  ui: {
    accent: 8141549,
    // Purple accent
    border: {
      light: 4210752,
      dark: 4210752
    },
    background: {
      light: 16777215,
      dark: 1973790
    }
  }
};
const barDimensions = {
  // Health/Stress bars on tokens
  token: {
    width: 64,
    height: 10,
    gap: 2,
    radius: 5,
    // Half of height for pill shape
    offsetY: 8,
    // Distance below token
    borderWidth: 1.5,
    innerPadding: 2
    // Padding between border and fill
  },
  // Initiative tracker bars
  initiative: {
    height: 4,
    radius: 2
  }
};
function hexToNumber(hex) {
  return parseInt(hex.replace("#", ""), 16);
}
function getBorderAlpha(opacity) {
  return borderOpacity[opacity];
}
function lightenColor(color, amount) {
  const r2 = Math.min(255, (color >> 16 & 255) + Math.round(255 * amount));
  const g = Math.min(255, (color >> 8 & 255) + Math.round(255 * amount));
  const b2 = Math.min(255, (color & 255) + Math.round(255 * amount));
  return r2 << 16 | g << 8 | b2;
}
function darkenColor(color, amount) {
  const r2 = Math.max(0, (color >> 16 & 255) - Math.round(255 * amount));
  const g = Math.max(0, (color >> 8 & 255) - Math.round(255 * amount));
  const b2 = Math.max(0, (color & 255) - Math.round(255 * amount));
  return r2 << 16 | g << 8 | b2;
}
const FIRST_BAR_GAP = 2;
const BAR_BORDER = 0.75;
const BAR_FILL_INSET = 1;
const BAR_TICKS = 10;
const BAR_STYLE = {
  border: 8947848,
  inside: 1710618,
  tick: 3355443,
  tickAlpha: 0.5,
  tickWidth: 0.5,
  /** Darkens the bar whose spending defeats the token. */
  defeatedAlpha: 0.4
};
const NAMEPLATE = {
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial',
  /** The text is set at this size and scaled by `textScale`, so it stays crisp when zoomed. */
  fontSize: 24,
  fontWeight: "600",
  textScale: 0.333,
  textAlpha: 0.85,
  padding: 6,
  minWidth: 40,
  height: NAMEPLATE_HEIGHT
};
const NAMEPLATE_STYLE = {
  dark: { fill: 2763306, border: 16777215, borderAlpha: 0.4 },
  light: { fill: 14935011, border: 0, borderAlpha: 0.3 },
  borderWidth: 0.5,
  text: 16777215
};
function barStackRects(count) {
  const { width, height, gap } = barDimensions.token;
  return Array.from({ length: count }, (_, index) => ({ x: -width / 2, y: FIRST_BAR_GAP + index * (height + gap), width, height }));
}
function barInnerRect(bar) {
  const inset = BAR_BORDER / 2;
  return { x: bar.x + inset, y: bar.y + inset, width: bar.width - inset * 2, height: bar.height - inset * 2 };
}
function barFillRect(inner) {
  const inset = BAR_FILL_INSET;
  return { x: inner.x + inset, y: inner.y + inset, width: inner.width - inset * 2, height: inner.height - inset * 2 };
}
function barTickXs(inner) {
  const spacing2 = inner.width / BAR_TICKS;
  return Array.from({ length: BAR_TICKS - 1 }, (_, index) => inner.x + spacing2 * (index + 1));
}
function nameplateRect(textWidth) {
  const width = Math.max(textWidth * NAMEPLATE.textScale + NAMEPLATE.padding * 2, NAMEPLATE.minWidth);
  const textY = -NAMEPLATE.height / 2;
  return { x: -width / 2, y: textY - NAMEPLATE.height / 2, width, height: NAMEPLATE.height, textY };
}
const CONDITION_BADGE = {
  /** Badge radius in UI units (a medium token is 62 wide). */
  radius: 6,
  /** Dark rim that separates the badge from any token art or map behind it. */
  bezelWidth: 1,
  bezelColor: 1118484,
  /** Value pip radius as a share of the badge radius, and where its centre sits. */
  pipShare: 0.6,
  pipOffset: 0.72,
  pipColor: 1842210,
  /** The "+3" badge that counts the conditions that do not fit. */
  overflowColor: 3816002
};
const ARC_CENTRE = -0.75 * Math.PI;
const ARC_SPAN = Math.PI / 2;
const BADGE_DIAMETER = (CONDITION_BADGE.radius + CONDITION_BADGE.bezelWidth) * 2;
const BADGE_PITCH = BADGE_DIAMETER + 1.5;
const MAX_SLOTS = 6;
function stepAngle(ringRadius, scale) {
  return ringRadius > 0 ? BADGE_PITCH * scale / ringRadius : ARC_SPAN;
}
function badgeSlots(ringRadius, scale) {
  const step = stepAngle(ringRadius, scale);
  const badgeAngle = step * (BADGE_DIAMETER / BADGE_PITCH);
  return Math.max(1, Math.min(MAX_SLOTS, Math.floor((ARC_SPAN - badgeAngle) / step) + 1));
}
function fitBadges(items, ringRadius, scale) {
  const slots = badgeSlots(ringRadius, scale);
  if (items.length <= slots) return { shown: [...items], overflow: 0 };
  const shown = items.slice(0, slots - 1);
  return { shown, overflow: items.length - shown.length };
}
function badgePositions(count, ringRadius, scale) {
  const step = stepAngle(ringRadius, scale);
  const middle = (count - 1) / 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = ARC_CENTRE + (middle - index) * step;
    return { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius };
  });
}
const DOWNED_LOOK = {
  /** The skull's height as a share of the token's diameter. */
  skullShare: 0.46,
  /** The skull is a quiet marker: the grey token already says most of it. */
  markerOpacity: 0.72
};
const WAYPOINT_KEY = " ";
function samePoint(a2, b2) {
  return Math.abs(a2.x - b2.x) < 0.5 && Math.abs(a2.y - b2.y) < 0.5;
}
class DragRulerPath {
  constructor(snap) {
    /** The snapped start followed by every waypoint. */
    __publicField(this, "waypoints", []);
    __publicField(this, "landing", null);
    this.snap = snap;
  }
  get active() {
    return this.waypoints.length > 0;
  }
  begin(origin) {
    this.waypoints = [this.snap(origin)];
    this.landing = null;
  }
  /** Moves the end to the cell a token at `position` would snap to. */
  update(position) {
    if (this.active) this.landing = this.snap(position);
  }
  /** Adds a waypoint at the landing cell; false when there is none or it repeats the last point. */
  addWaypoint() {
    const last = this.waypoints[this.waypoints.length - 1];
    if (!this.landing || last && samePoint(last, this.landing)) return false;
    this.waypoints.push(this.landing);
    return true;
  }
  /** The start, the waypoints and the landing cell; null until the path leaves its start. */
  points() {
    const landing = this.landing;
    if (!landing) return null;
    const points = [...this.waypoints, landing];
    return points.every((point) => samePoint(point, landing)) ? null : points;
  }
  end() {
    this.waypoints = [];
    this.landing = null;
  }
}
function dragRulerLabel(grid, points, settings) {
  return formatDistance(pathLengthInCells(grid, points, settings.diagonalRule), settings);
}
function getTokenRingOuterDiameter(tokenSize, strokeWidth = 4, ringScale = 1) {
  const safeTokenSize = Number.isFinite(tokenSize) && tokenSize > 0 ? tokenSize : 70;
  const safeStrokeWidth = Number.isFinite(strokeWidth) && strokeWidth > 0 ? strokeWidth : 4;
  const safeScale = Number.isFinite(ringScale) && ringScale > 0 ? ringScale : 1;
  return safeTokenSize + safeStrokeWidth * 2 * safeScale;
}
function getTokenRingCenterRadius(tokenSize, strokeWidth = 4, ringScale = 1) {
  const safeTokenSize = Number.isFinite(tokenSize) && tokenSize > 0 ? tokenSize : 70;
  const outerDiameter = getTokenRingOuterDiameter(safeTokenSize, strokeWidth, ringScale);
  return (outerDiameter + safeTokenSize) / 4;
}
const FOG_COLOR = "rgba(0, 0, 0, 1)";
function renderBrush(ctx, op, bounds, scale, offsetX, offsetY) {
  const { points, brushRadius } = op;
  if (points.length === 0) return;
  const r2 = brushRadius * scale;
  ctx.beginPath();
  if (points.length === 1) {
    const p = points[0];
    const cx = (p.x + offsetX - bounds.x) * scale;
    const cy = (p.y + offsetY - bounds.y) * scale;
    ctx.arc(cx, cy, r2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  for (let i2 = 0; i2 < points.length - 1; i2++) {
    const p0 = points[i2];
    const p1 = points[i2 + 1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(dist / (brushRadius * 0.4)));
    for (let s2 = 0; s2 <= steps; s2++) {
      const t2 = s2 / steps;
      const cx = (p0.x + dx * t2 + offsetX - bounds.x) * scale;
      const cy = (p0.y + dy * t2 + offsetY - bounds.y) * scale;
      ctx.moveTo(cx + r2, cy);
      ctx.arc(cx, cy, r2, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}
function renderLasso(ctx, op, bounds, scale, offsetX, offsetY) {
  const { points } = op;
  if (points.length < 3) return;
  ctx.beginPath();
  const p0 = points[0];
  ctx.moveTo(
    (p0.x + offsetX - bounds.x) * scale,
    (p0.y + offsetY - bounds.y) * scale
  );
  for (let i2 = 1; i2 < points.length; i2++) {
    const p = points[i2];
    ctx.lineTo(
      (p.x + offsetX - bounds.x) * scale,
      (p.y + offsetY - bounds.y) * scale
    );
  }
  ctx.closePath();
  ctx.fill();
}
function renderRectangle(ctx, op, bounds, scale, offsetX, offsetY) {
  const sx = (op.x + offsetX - bounds.x) * scale;
  const sy = (op.y + offsetY - bounds.y) * scale;
  const sw = op.width * scale;
  const sh = op.height * scale;
  ctx.fillRect(sx, sy, sw, sh);
}
function renderOperation(ctx, op, bounds, scale, offsetX, offsetY) {
  ctx.save();
  ctx.globalCompositeOperation = op.isErasing ? "destination-out" : "source-over";
  ctx.fillStyle = FOG_COLOR;
  switch (op.type) {
    case "brush":
      renderBrush(ctx, op, bounds, scale, offsetX, offsetY);
      break;
    case "lasso":
      renderLasso(ctx, op, bounds, scale, offsetX, offsetY);
      break;
    case "rectangle":
      renderRectangle(ctx, op, bounds, scale, offsetX, offsetY);
      break;
  }
  ctx.restore();
}
function calculateOperationBounds(op) {
  const ox = op.offsetX ?? 0;
  const oy = op.offsetY ?? 0;
  switch (op.type) {
    case "brush": {
      if (!op.points || op.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of op.points) {
        minX = Math.min(minX, p.x - op.brushRadius);
        minY = Math.min(minY, p.y - op.brushRadius);
        maxX = Math.max(maxX, p.x + op.brushRadius);
        maxY = Math.max(maxY, p.y + op.brushRadius);
      }
      return {
        x: minX + ox,
        y: minY + oy,
        width: maxX - minX,
        height: maxY - minY
      };
    }
    case "lasso": {
      if (!op.points || op.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of op.points) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
      return {
        x: minX + ox,
        y: minY + oy,
        width: maxX - minX,
        height: maxY - minY
      };
    }
    case "rectangle":
      return {
        x: (op.x ?? 0) + ox,
        y: (op.y ?? 0) + oy,
        width: op.width ?? 0,
        height: op.height ?? 0
      };
    default: {
      const unknownOp = op;
      console.warn("[FogRenderUtils] Unknown fog operation type:", unknownOp.type);
      return { x: 0, y: 0, width: 0, height: 0 };
    }
  }
}
function insideSpans(points, y) {
  const crossings = [];
  for (let index = 0; index < points.length; index++) {
    const a2 = points[index];
    const b2 = points[(index + 1) % points.length];
    if (a2.y <= y === b2.y <= y) continue;
    crossings.push({ x: a2.x + (y - a2.y) / (b2.y - a2.y) * (b2.x - a2.x), winding: b2.y > a2.y ? 1 : -1 });
  }
  crossings.sort((p, q) => p.x - q.x);
  const spans = [];
  let winding = 0;
  for (let index = 0; index < crossings.length - 1; index++) {
    winding += crossings[index].winding;
    if (winding !== 0) spans.push([crossings[index].x, crossings[index + 1].x]);
  }
  return spans;
}
export {
  BAR_BORDER,
  BAR_FILL_INSET,
  BAR_STYLE,
  BAR_TICKS,
  CONDITION_BADGE,
  CONE_ANGLE,
  DEFAULT_TEXT_PADDING,
  DOT_SCALE,
  DOWNED_LOOK,
  DragRulerPath,
  FILAMENT_COLOR,
  FILAMENT_SHARE,
  FIRST_BAR_GAP,
  FOG_COLOR,
  LASER_PLAYBACK_DELAY_MS,
  LASER_STALE_MS,
  LaserTrail,
  MAP_ICON_LABELS,
  MAP_ICON_SIZE,
  MAP_ICON_SVG,
  MAX_TRAIL_SAMPLES,
  MEASURE_AREA,
  MEASURE_LABEL_COLORS,
  MEASURE_LABEL_FONT_SIZE,
  MEASURE_PATH_STROKES,
  MEASURE_POINT,
  MEASURE_SHADOW,
  NAMEPLATE,
  NAMEPLATE_HEIGHT,
  NAMEPLATE_STYLE,
  REMOTE_LASER_LIMITS,
  R as RESIZE_HANDLE_SIZE,
  RemoteLasers,
  SCENE_LAYER_ORDER,
  SCENE_LAYER_Z,
  TEXT_LINE_SPACING,
  T as TOKEN_SIZE_OPTIONS,
  WAYPOINT_KEY,
  arcPoints,
  badgePositions,
  badgeSlots,
  barDimensions,
  barFillRect,
  barInnerRect,
  barStackRects,
  barTickXs,
  beamRadius,
  beamSmoothingSpacing,
  beamWidth,
  borderOpacity,
  borderWidth,
  buttonHeight,
  calculateOperationBounds,
  colors,
  c as computeTokenPixelSize,
  a as computeTokenStrokeWidth,
  coneGeometry,
  createLaserBeamBuffers,
  darkenColor,
  dragRulerLabel,
  fitBadges,
  getBorderAlpha,
  getTokenRingCenterRadius,
  getTokenRingOuterDiameter,
  hexToNumber,
  iconSize,
  inputHeight,
  insideSpans,
  i as isHexColor,
  laserPointSpacing,
  lightenColor,
  measureLabelAnchor,
  measureLabelBox,
  measureLabelFontSize,
  nameplateRect,
  pathMidpoint,
  pinSize,
  radius,
  renderBrush,
  renderLasso,
  renderOperation,
  renderRectangle,
  r as restingTokenUIScale,
  samePoint,
  s as selectedTokenUIScale,
  smoothBeam,
  spacing,
  textBackground,
  textFontStyle,
  textFontWeight,
  textRotation,
  textScale,
  t as tokenDiameterInCells,
  b as tokenSizeFromCreatureSize,
  d as tokenUIScale,
  transition,
  writeLaserBeam,
  zIndex
};
