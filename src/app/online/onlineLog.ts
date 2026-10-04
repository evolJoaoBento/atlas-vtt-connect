/**
 * Diagnostics for online play, behind Connect's setting "Log online play events" (the join page
 * has a switch of its own). Writes with `console.debug`, which the developer console shows under
 * "Verbose". The switch is read on every event, so it works mid-session. Shared with the web page:
 * no Obsidian imports.
 */
import type { ViewsApi } from '@atlas-vtt/api-types';
import type { LiveScene, PresentedSceneSource } from './atlas/presentedSource';
import type { ControlMessage } from './protocol';
import type { SceneSession } from './scene/sceneContracts';

export type LogDetails = Record<string, string | number | boolean | null>;
export type LogWriter = (...parts: unknown[]) => void;

export interface OnlineLog {
  isEnabled(): boolean;
  event(name: string, details?: LogDetails): void;
}

export function createOnlineLog(isEnabled: () => boolean, write: LogWriter = (...parts) => console.debug(...parts)): OnlineLog {
  return {
    isEnabled,
    event: (name, details = {}) => {
      if (isEnabled()) write('[Atlas online]', name, details);
    },
  };
}

/** Where the current call came from: a few frames of the stack, for events whose cause is the question. */
export function callerStack(): string {
  return (new Error().stack ?? '').split('\n').slice(2, 10).map((line) => line.trim()).join(' | ');
}

/** What a sent message is about, without its scene data. */
function sendDetails(playerId: string, message: ControlMessage): LogDetails {
  const details: LogDetails = { playerId };
  if ('seq' in message) details.seq = message.seq;
  switch (message.type) {
    case 'scene-snapshot':
      return {
        ...details, sceneId: message.scene.sceneId, tokens: Object.keys(message.scene.tokens).length,
        fogParts: message.fogParts, drawingParts: message.drawingParts,
      };
    case 'scene-camera':
      return {
        ...details, sceneId: message.sceneId, centerX: message.centerX, centerY: message.centerY, width: message.width, height: message.height,
      };
    case 'scene-clear':
      return { ...details, stack: callerStack() };
    default:
      return details;
  }
}

/** The session the broadcaster and the camera sender send through, logging every message. */
export function loggedSession(session: SceneSession, log: OnlineLog): SceneSession {
  return {
    use: (handler) => session.use(handler),
    getPlayers: () => session.getPlayers(),
    send: (playerId, message) => {
      if (log.isEnabled()) log.event(`send ${message.type}`, sendDetails(playerId, message));
      session.send(playerId, message);
    },
  };
}

/**
 * Logs every presented-scene event with the caller's stack and a number per presentation
 * (a new number for the same tab means `present` ran again), and, while a scene is
 * presented, its view's map loading. The API has no tab events: a tab change shows as the
 * presentation being held or resumed.
 */
export function logPresentedScene(presented: PresentedSceneSource, views: Pick<ViewsApi, 'list'>, log: OnlineLog): () => void {
  const ids = new WeakMap<LiveScene, number>();
  let nextId = 0;
  const idOf = (scene: LiveScene): number => {
    let id = ids.get(scene);
    if (id === undefined) {
      id = ++nextId;
      ids.set(scene, id);
    }
    return id;
  };
  const activeTab = (scene: LiveScene): string | null => views.list().find((view) => view.viewId === scene.info.viewId)?.activeTabId ?? null;
  const describe = (scene: LiveScene): LogDetails => ({
    presentation: idOf(scene), tab: scene.info.tabId, activeTab: activeTab(scene),
    loading: scene.snapshot()?.loaded !== true, held: presented.isHeld(),
  });
  const when = (write: () => void): void => {
    if (log.isEnabled()) write();
  };

  let watched: LiveScene | null = null;
  let stopWatching: (() => void) | null = null;
  const watch = (scene: LiveScene | null): void => {
    if (scene === watched) return;
    stopWatching?.();
    stopWatching = null;
    watched = scene;
    if (!scene) return;
    let loading = scene.snapshot()?.loaded !== true;
    stopWatching = scene.subscribe((snapshot) => {
      if (!snapshot.loaded === loading) return;
      loading = !snapshot.loaded;
      when(() => log.event('map loading', { presentation: idOf(scene), loading }));
    });
  };

  const stop = presented.subscribe({
    presented: (scene, resumed) => {
      when(() => log.event('presented', { ...describe(scene), resumed, stack: callerStack() }));
      watch(scene);
    },
    held: (scene) => {
      when(() => log.event('held', { ...describe(scene), stack: callerStack() }));
      watch(scene);
    },
    cleared: (previous) => {
      when(() => log.event('cleared', { presentation: idOf(previous), tab: previous.info.tabId, stack: callerStack() }));
      watch(null);
    },
  });
  watch(presented.current());
  return () => {
    stop();
    watch(null);
  };
}
