/**
 * The Atlas VTT version both plugins need. Obsidian cannot make one plugin require a version of another, so each plugin
 * reads Atlas's version itself, at load and whenever Atlas reloads, and stays off below the floor.
 */
import type { App } from 'obsidian';

/** The oldest Atlas VTT the plugins work with: the tag `packages/atlas-shared` is copied from. */
export const MIN_ATLAS_VERSION = '0.15.0';
const ATLAS_ID = 'atlas-vtt';

interface Parsed {
  parts: [number, number, number];
  pre: boolean;
}

function parse(version: string): Parsed | null {
  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-.+)?$/.exec(version.trim());
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)], pre: match[4] !== undefined };
}

/** <0, 0, >0. Missing parts are 0 ('0.15' = '0.15.0'). A pre-release sorts before its release. Unparsable sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return left ? 1 : right ? -1 : 0;
  for (let i = 0; i < 3; i++) {
    const difference = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return left.pre === right.pre ? 0 : left.pre ? -1 : 1;
}

export type AtlasFloor = { state: 'ok'; version: string } | { state: 'old'; version: string } | { state: 'missing' };

interface PluginsLike {
  plugins?: Record<string, unknown>;
  manifests?: Record<string, { version?: unknown } | undefined>;
}
const pluginsOf = (app: App): PluginsLike => (app as unknown as { plugins?: PluginsLike }).plugins ?? {};

/** 'missing' when Atlas is not enabled; else its manifest's version against `MIN_ATLAS_VERSION`. A version that cannot be read is old. */
export function atlasFloor(app: App): AtlasFloor {
  const plugins = pluginsOf(app);
  const plugin = plugins.plugins?.[ATLAS_ID];
  if (!plugin) return { state: 'missing' };
  const listed = plugins.manifests?.[ATLAS_ID]?.version ?? (plugin as { manifest?: { version?: unknown } }).manifest?.version;
  if (typeof listed !== 'string' || !parse(listed)) return { state: 'old', version: typeof listed === 'string' && listed.trim() ? listed : 'unknown' };
  return compareVersions(listed, MIN_ATLAS_VERSION) >= 0 ? { state: 'ok', version: listed } : { state: 'old', version: listed };
}

export const FLOOR_POLL_MS = 2000;

const everyMs = (ms: number, fn: () => void): (() => void) => {
  const id = window.setInterval(fn, ms);
  return () => window.clearInterval(id);
};

/**
 * Calls `listener` whenever the floor changes: Atlas enabled, disabled, reloaded (a new plugin object) or updated.
 * Obsidian has no event for another plugin loading, so this polls every `FLOOR_POLL_MS`. Returns the stop.
 */
export function watchAtlasFloor(app: App, listener: (floor: AtlasFloor) => void, every: (ms: number, fn: () => void) => () => void = everyMs): () => void {
  const key = (floor: AtlasFloor): string => (floor.state === 'missing' ? 'missing' : `${floor.state}:${floor.version}`);
  let plugin = pluginsOf(app).plugins?.[ATLAS_ID];
  let last = key(atlasFloor(app));
  return every(FLOOR_POLL_MS, () => {
    const now = pluginsOf(app).plugins?.[ATLAS_ID];
    const floor = atlasFloor(app);
    if (now === plugin && key(floor) === last) return;
    plugin = now;
    last = key(floor);
    listener(floor);
  });
}

/** The notice a plugin shows when Atlas is older than the floor. */
export function floorNotice(plugin: 'Tabletop' | 'Connect', found: string): string {
  return `${plugin} needs Atlas VTT 0.15 or later (found ${found})`;
}
