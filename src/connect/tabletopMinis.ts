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
import type { BoardLook, GmCutscene } from '../app/online/scene/sceneContracts';
import { isBoardCutscene } from '../app/online/scene/boardValidation';
import type { BoardSession } from '../app/online/tools/BoardSessionHub';
import { asPlayerBoardFactory, type PlayerBoardFactory } from '../app/online/obsidian/playerBoardContract';

/** Tabletop's plugin id, and the one it had before ("Tabletop for Atlas VTT" took a new one). */
const PLUGIN_IDS = ['tabletop-for-atlas', 'atlas-vtt-tabletop'];
const READY = 'tabletop-for-atlas:api-ready';
const UNLOAD = 'tabletop-for-atlas:api-unload';
const OLD_READY = 'atlas-vtt-tabletop:api-ready';
const OLD_UNLOAD = 'atlas-vtt-tabletop:api-unload';
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
  for (const id of PLUGIN_IDS) {
    const api = plugins?.[id]?.api;
    if (isTabletopApi(api)) return api;
  }
  return null;
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
        ...[READY, OLD_READY].map((name) => app.workspace.on(name as never, (() => listener()) as never)),
        // Unload is announced before the API goes: it is read again on the next tick.
        ...[UNLOAD, OLD_UNLOAD].map((name) => app.workspace.on(name as never, (() => { window.setTimeout(listener, 0); }) as never)),
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
    ...[READY, OLD_READY].map((name) => app.workspace.on(name as never, (() => bind()) as never)),
    // Unload is announced before the API goes: it is read again on the next tick.
    ...[UNLOAD, OLD_UNLOAD].map((name) => app.workspace.on(name as never, (() => { window.setTimeout(bind, 0); }) as never)),
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

/** Tabletop's running cutscene (`api.cutscene`), when it has the shape Connect reads. */
interface CutsceneApi {
  current(): unknown;
  onChange(listener: () => void): () => void;
  camera(): unknown;
  onCamera(listener: () => void): () => void;
}

function cutsceneApi(api: TabletopBoardApi | null): CutsceneApi | null {
  const source = (api as { cutscene?: Partial<CutsceneApi> } | null)?.cutscene;
  return source && typeof source.current === 'function' && typeof source.onChange === 'function'
    && typeof source.camera === 'function' && typeof source.onCamera === 'function' ? source as CutsceneApi : null;
}

/** A published run, rebuilt field by field so nothing but the checked wire shape (and the GM-side map paths) is kept. */
function cleanCutscene(raw: unknown): GmCutscene | null {
  const given = raw as { cutscene?: unknown; maps?: unknown } | null;
  if (typeof given !== 'object' || given === null || !isBoardCutscene(given.cutscene)) return null;
  const { runId, mode, look, shots, step, key } = given.cutscene;
  const maps: Record<string, string> = {};
  if (typeof given.maps === 'object' && given.maps !== null) {
    for (const [name, path] of Object.entries(given.maps)) if (typeof path === 'string') Object.defineProperty(maps, name, { value: path, enumerable: true });
  }
  return {
    cutscene: {
      runId, mode, key,
      look: { bars: look.bars, fadeMs: look.fadeMs },
      shots: shots.map((shot) => ({
        key: shot.key, eye: { x: shot.eye.x, y: shot.eye.y, z: shot.eye.z }, target: { x: shot.target.x, y: shot.target.y, z: shot.target.z },
        at: shot.at, keyframe: shot.keyframe, transition: shot.transition,
      })),
      step: { shot: step.shot, seq: step.seq },
    },
    maps,
  };
}

const isPoint3 = (value: unknown): value is { x: number; y: number; z: number } => {
  const point = value as Record<string, unknown> | null;
  return typeof point === 'object' && point !== null && [point.x, point.y, point.z].every((n) => typeof n === 'number' && Number.isFinite(n));
};

export function tabletopBoard(app: App): TabletopBoard {
  const listeners = new Set<() => void>();
  const cameraListeners = new Set<() => void>();
  const cutsceneListeners = new Set<() => void>();
  const cutsceneCameraListeners = new Set<() => void>();
  let api: TabletopBoardApi | null = null;
  let cutscenes: CutsceneApi | null = null;
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
    cutscenes = null;
    if (api) {
      try {
        stops = [api.onBoardChange(() => emit()), api.gmCamera.onChange(() => emitTo(cameraListeners))];
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not follow the Tabletop board:', error);
        api = null;
      }
    }
    const source = api ? cutsceneApi(api) : null;
    if (source) {
      try {
        stops.push(source.onChange(() => emitTo(cutsceneListeners)), source.onCamera(() => emitTo(cutsceneCameraListeners)));
        cutscenes = source;
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not follow the Tabletop cutscene:', error);
      }
    }
    handOver();
    emit();
    // A run that was going when Tabletop went away or came back is over or new: the sender reads it again.
    emitTo(cutsceneListeners);
  };
  const refs: EventRef[] = [
    ...[READY, OLD_READY].map((name) => app.workspace.on(name as never, (() => bind()) as never)),
    ...[UNLOAD, OLD_UNLOAD].map((name) => app.workspace.on(name as never, (() => { window.setTimeout(bind, 0); }) as never)),
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
    cutscene: () => {
      if (!cutscenes) return null;
      try {
        return cleanCutscene(cutscenes.current());
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not read the Tabletop cutscene:', error);
        return null;
      }
    },
    subscribeCutscene: (listener) => {
      cutsceneListeners.add(listener);
      return () => { cutsceneListeners.delete(listener); };
    },
    cutsceneCamera: () => {
      if (!cutscenes) return null;
      try {
        const pose = cutscenes.camera() as Partial<BoardPose> | null;
        return pose && isPoint3(pose.eye) && isPoint3(pose.target) ? { eye: { ...pose.eye }, target: { ...pose.target } } : null;
      } catch (error) {
        console.warn('[Atlas VTT Connect] Could not read the Tabletop cutscene camera:', error);
        return null;
      }
    },
    subscribeCutsceneCamera: (listener) => {
      cutsceneCameraListeners.add(listener);
      return () => { cutsceneCameraListeners.delete(listener); };
    },
    dispose: () => {
      for (const ref of refs) app.workspace.offref(ref);
      for (const stop of stops.splice(0)) stop();
      session = null;
      handOver();
      api = null;
      cutscenes = null;
      emitTo(cutsceneListeners);
      listeners.clear();
      cameraListeners.clear();
      cutsceneListeners.clear();
      cutsceneCameraListeners.clear();
    },
  };
}

/**
 * Tabletop's 3D boards open on the GM's side (`api.boardViews`), for Connect's buttons in their toolbars; none without
 * a Tabletop that lists them. Never throws.
 */
export function tabletopBoardViews(app: App): Array<{ key: string; mapPath: string; root: HTMLElement }> {
  const list = (tabletopApi(app) as { boardViews?: unknown } | null)?.boardViews;
  if (typeof list !== 'function') return [];
  try {
    const boards = (list as () => unknown).call(tabletopApi(app));
    return Array.isArray(boards)
      ? boards.filter((entry: unknown): entry is { key: string; mapPath: string; root: HTMLElement } => {
        const board = entry as { key?: unknown; mapPath?: unknown; root?: { querySelector?: unknown } } | null;
        return typeof board?.key === 'string' && typeof board.mapPath === 'string' && typeof board.root?.querySelector === 'function';
      })
      : [];
  } catch (error) {
    console.warn('[Atlas VTT Connect] Could not list the Tabletop boards:', error);
    return [];
  }
}
