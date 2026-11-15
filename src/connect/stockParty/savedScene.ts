/**
 * The tokens of a map as its file saved them (`.atlasmap`: `{ state: { objects: { tokens } } }`), for remembering
 * "Controlled by" while Atlas's own map view is not loaded: after Obsidian restarts, Atlas's tab stays deferred until it
 * is shown, and a GM who works on Tabletop's 3D board never shows it. Token ids are the ones online play uses.
 */
import type { PartyScene, PlacedToken } from './partyLinks';

const isObj = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The tokens of a saved map, by id, as far as telling their library token goes; null for what is no map file. */
export function savedTokens(text: string): Record<string, PlacedToken> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const state = isObj(parsed) ? parsed.state : null;
  const objects = isObj(state) ? state.objects : null;
  const tokens = isObj(objects) ? objects.tokens : null;
  if (!isObj(tokens)) return null;
  const found: Record<string, PlacedToken> = {};
  for (const [id, token] of Object.entries(tokens)) {
    if (!isObj(token)) continue;
    found[id] = {
      ...(typeof token.assetId === 'string' ? { assetId: token.assetId } : {}),
      ...(typeof token.imagePath === 'string' ? { imagePath: token.imagePath } : {}),
    };
  }
  return found;
}

/** Saved maps' tokens, read once per path and again when told the file changed; `ready` hears each read that lands. */
export class SavedSceneTokens {
  private readonly cache = new Map<string, Record<string, PlacedToken> | null>();
  private readonly reading = new Set<string>();
  private disposed = false;

  constructor(private readonly read: (path: string) => Promise<string | null>, private readonly ready: () => void) {}

  /** The tokens saved in `path`; null until read (a read starts), or when it is no map. */
  get(path: string): Record<string, PlacedToken> | null {
    if (this.cache.has(path)) return this.cache.get(path) ?? null;
    if (!this.reading.has(path)) {
      this.reading.add(path);
      this.read(path).then((text) => {
        this.reading.delete(path);
        if (this.disposed) return;
        this.cache.set(path, text === null ? null : savedTokens(text));
        this.ready();
      }, () => {
        this.reading.delete(path);
        if (!this.disposed) this.cache.set(path, null);
      });
    }
    return null;
  }

  /** `path` was saved or went: read it again when next asked. */
  changed(path: string): void {
    if (!this.cache.delete(path)) return;
    this.ready();
  }

  dispose(): void {
    this.disposed = true;
    this.cache.clear();
  }
}

/** A map Atlas's view holds now: its path (null while the store does not hold its tab's map yet) and every token. */
export interface LiveMap {
  mapPath: string | null;
  tokens: Readonly<Record<string, PlacedToken | undefined>>;
}

/**
 * The scenes "Controlled by" is remembered on, one per map: each map Atlas's views hold now (live), then each map the GM
 * shows without it (the presented scene, Tabletop's boards) from Atlas's view when it holds that map, else from its file.
 */
export function partyScenes(live: readonly LiveMap[], wanted: readonly string[], saved: (path: string) => Readonly<Record<string, PlacedToken>> | null): PartyScene[] {
  const scenes: PartyScene[] = live.map((map) => ({ mapPath: map.mapPath, tokens: map.tokens, live: map.mapPath !== null }));
  const seen = new Set(live.flatMap((map) => (map.mapPath === null ? [] : [map.mapPath])));
  for (const path of wanted) {
    if (seen.has(path)) continue;
    seen.add(path);
    const tokens = saved(path);
    if (tokens) scenes.push({ mapPath: path, tokens, live: false });
  }
  return scenes;
}
