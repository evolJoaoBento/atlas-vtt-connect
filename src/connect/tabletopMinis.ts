/**
 * The Tabletop extension (`atlas-vtt-tabletop`): the minis it stands on tokens, as a `MiniSource` for hosted sessions,
 * and the painter that draws them in a joined player's view (`tabletopPainter`). The extension publishes
 * `app.plugins.plugins['atlas-vtt-tabletop'].api` and announces it with the workspace events
 * `atlas-vtt-tabletop:api-ready` and `atlas-vtt-tabletop:api-unload`, so either plugin may load first. Without it,
 * or with an API this does not understand, no token has a mini and none is drawn. Everything is checked before use
 * and nothing throws.
 */
import type { App, EventRef } from 'obsidian';
import type { MiniPlacement } from '../app/online/scene/projectForPlayers';
import type { BoardPose, BoardSource, MiniSource } from '../app/online/scene/sceneSources';
import type { MiniPainter } from '../app/online/view/minis/miniLayer';
import type { BoardLook } from '../app/online/scene/sceneContracts';
import type { BoardSession } from '../app/online/tools/BoardSessionHub';
import { asPlayerBoardFactory, type PlayerBoardFactory } from '../app/online/obsidian/playerBoardContract';

const PLUGIN_ID = 'atlas-vtt-tabletop';
const READY = 'atlas-vtt-tabletop:api-ready';
const UNLOAD = 'atlas-vtt-tabletop:api-unload';
const NONE: Readonly<Record<string, MiniPlacement>> = Object.freeze({});

interface TabletopApi {
  version: number;
  placementsFor(mapPath: string): unknown;
  onChange(listener: (mapPath: string | null) => void): () => void;
}

function isTabletopApi(value: unknown): value is TabletopApi {
  if (typeof value !== 'object' || value === null) return false;
  const api = value as Record<string, unknown>;
  return api.version === 1 && typeof api.placementsFor === 'function' && typeof api.onChange === 'function';
}

function tabletopApi(app: App): TabletopApi | null {
  const plugins = (app as unknown as { plugins?: { plugins?: Record<string, { api?: unknown } | undefined> } }).plugins?.plugins;
  const api = plugins?.[PLUGIN_ID]?.api;
  return isTabletopApi(api) ? api : null;
}

export interface TabletopPainter {
  /**
   * The painter that draws minis in a player's view, read fresh on every call: null while Tabletop is not installed,
   * not enabled, or offers no painter this version of Connect understands. A player sees minis only with Tabletop.
   */
  current(): MiniPainter | null;
  /** Calls `listener` when Tabletop arrives or leaves. */
  subscribe(listener: () => void): () => void;
  /** Tabletop's 3D player board, read fresh on every call; null without one this Connect understands. */
  board(): PlayerBoardFactory | null;
}

export function tabletopPainter(app: App): TabletopPainter {
  return {
    current: () => {
      const painter = (tabletopApi(app) as { playerMinis?: unknown } | null)?.playerMinis as Partial<MiniPainter> | undefined;
      return painter && painter.version === 1 && typeof painter.create === 'function' ? painter as MiniPainter : null;
    },
    board: () => asPlayerBoardFactory((tabletopApi(app) as { playerBoard?: unknown } | null)?.playerBoard),
    subscribe: (listener) => {
      const refs: EventRef[] = [
        app.workspace.on(READY as never, (() => listener()) as never),
        // Unload is announced before the API goes: it is read again on the next tick.
        app.workspace.on(UNLOAD as never, (() => { window.setTimeout(listener, 0); }) as never),
      ];
      return () => { for (const ref of refs) app.workspace.offref(ref); };
    },
  };
}

/** Keeps only well-formed placements: a vault path and finite numbers. */
function cleanPlacements(raw: unknown): Readonly<Record<string, MiniPlacement>> {
  if (typeof raw !== 'object' || raw === null) return NONE;
  const out: Record<string, MiniPlacement> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    const value = entry as Partial<MiniPlacement> | null;
    if (!value || typeof value.mini !== 'string' || value.mini === '') continue;
    const scale = typeof value.scale === 'number' && Number.isFinite(value.scale) ? value.scale : 1;
    const turn = typeof value.turn === 'number' && Number.isFinite(value.turn) ? value.turn : 0;
    Object.defineProperty(out, id, { value: { mini: value.mini, scale, turn }, enumerable: true });
  }
  return out;
}

export interface TabletopMinis extends MiniSource {
  /** Stops following the extension. */
  dispose(): void;
}

export function tabletopMinis(app: App): TabletopMinis {
  const listeners = new Set<() => void>();
  let api: TabletopApi | null = null;
  let stopApi: (() => void) | null = null;
  const emit = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[Atlas VTT Connect] A minis listener failed:', error);
      }
    }
  };
  const bind = (): void => {
    const next = tabletopApi(app);
    if (next === api) return;
    stopApi?.();
    stopApi = null;
    api = next;
    if (api) {
      try {
        stopApi = api.onChange(() => emit());
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not follow the Tabletop minis:', error);
        api = null;
      }
    }
    emit();
  };
  const refs: EventRef[] = [
    app.workspace.on(READY as never, (() => bind()) as never),
    // Unload is announced before the API goes: it is read again on the next tick.
    app.workspace.on(UNLOAD as never, (() => { window.setTimeout(bind, 0); }) as never),
  ];
  bind();
  return {
    forMap: (mapPath) => {
      if (!api || typeof mapPath !== 'string') return NONE;
      try {
        return cleanPlacements(api.placementsFor(mapPath));
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not read the Tabletop minis:', error);
        return NONE;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => {
      for (const ref of refs) app.workspace.offref(ref);
      stopApi?.();
      stopApi = null;
      api = null;
      listeners.clear();
    },
  };
}

export type { BoardPose } from '../app/online/scene/sceneSources';

/**
 * What the GM gave a map on Tabletop's 3D board, and the GM's 3D view of it, for players on the 3D board. Available only
 * with a Tabletop that offers `boardLook`, `onBoardChange` and `gmCamera`; an older one has no board to share.
 */
export interface TabletopBoard extends BoardSource {
  /** Hands the GM's hosted session to Tabletop's board (again whenever Tabletop reloads); returns the release. */
  attachSession(session: BoardSession): () => void;
  dispose(): void;
}

interface TabletopBoardApi {
  boardLook(mapPath: string): unknown;
  onBoardChange(listener: (mapPath: string | null) => void): () => void;
  gmCamera: { camera(mapPath: string): unknown; onChange(listener: () => void): () => void };
}

function boardApi(app: App): TabletopBoardApi | null {
  const api = tabletopApi(app) as Partial<TabletopBoardApi> | null;
  const camera = api?.gmCamera as Partial<TabletopBoardApi['gmCamera']> | undefined;
  return api && typeof api.boardLook === 'function' && typeof api.onBoardChange === 'function'
    && camera && typeof camera.camera === 'function' && typeof camera.onChange === 'function' ? api as TabletopBoardApi : null;
}

const isPoint3 = (value: unknown): value is { x: number; y: number; z: number } => {
  const point = value as Record<string, unknown> | null;
  return typeof point === 'object' && point !== null && [point.x, point.y, point.z].every((n) => typeof n === 'number' && Number.isFinite(n));
};

export function tabletopBoard(app: App): TabletopBoard {
  const listeners = new Set<() => void>();
  const cameraListeners = new Set<() => void>();
  let api: TabletopBoardApi | null = null;
  /** The session handed over, and Tabletop's release of it. */
  let session: BoardSession | null = null;
  let releaseSession: (() => void) | null = null;
  const handOver = (): void => {
    releaseSession?.();
    releaseSession = null;
    const attach = (api as { attachSession?: unknown } | null)?.attachSession;
    if (!session || typeof attach !== 'function') return;
    try {
      const release = (attach as (given: BoardSession) => unknown).call(api, session);
      releaseSession = typeof release === 'function' ? release as () => void : null;
    } catch (error) {
      console.warn('[Atlas VTT Connect] Tabletop could not take the session:', error);
    }
  };
  let stops: Array<() => void> = [];
  const emitTo = (set: Set<() => void>): void => {
    for (const listener of [...set]) {
      try {
        listener();
      } catch (error) {
        console.error('[Atlas VTT Connect] A board listener failed:', error);
      }
    }
  };
  const emit = (): void => emitTo(listeners);
  const bind = (): void => {
    const next = boardApi(app);
    if (next === api) return;
    for (const stop of stops.splice(0)) stop();
    api = next;
    if (api) {
      try {
        stops = [api.onBoardChange(() => emit()), api.gmCamera.onChange(() => emitTo(cameraListeners))];
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not follow the Tabletop board:', error);
        api = null;
      }
    }
    handOver();
    emit();
  };
  const refs: EventRef[] = [
    app.workspace.on(READY as never, (() => bind()) as never),
    app.workspace.on(UNLOAD as never, (() => { window.setTimeout(bind, 0); }) as never),
  ];
  bind();
  return {
    available: () => api !== null,
    lookFor: (mapPath) => {
      if (!api) return null;
      try {
        const look = api.boardLook(mapPath) as BoardLook | null;
        return look && typeof look.wallHeight === 'function' ? look : null;
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not read the Tabletop board:', error);
        return null;
      }
    },
    camera: (mapPath) => {
      if (!api) return null;
      try {
        const pose = api.gmCamera.camera(mapPath) as Partial<BoardPose> | null;
        if (pose && isPoint3(pose.eye) && isPoint3(pose.target)) return { eye: { ...pose.eye }, target: { ...pose.target } };
        if (pose) console.warn('[Atlas VTT Connect] Tabletop gave a camera that is no camera:', pose);
        return null;
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not read the Tabletop camera:', error);
        return null;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    attachSession: (given) => {
      session = given;
      handOver();
      return () => {
        if (session !== given) return;
        session = null;
        handOver();
      };
    },
    subscribeCamera: (listener) => {
      cameraListeners.add(listener);
      return () => { cameraListeners.delete(listener); };
    },
    dispose: () => {
      for (const ref of refs) app.workspace.offref(ref);
      for (const stop of stops.splice(0)) stop();
      session = null;
      handOver();
      api = null;
      listeners.clear();
      cameraListeners.clear();
    },
  };
}
