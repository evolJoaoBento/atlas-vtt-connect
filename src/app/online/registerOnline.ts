import type { App, Plugin } from 'obsidian';
import type { Disposer, PresentationApi } from '@atlas-vtt/api-types';
import { onlineSessionStore, type OnlineSessionState } from './onlineSessionStore';
import type { OnlineSessionService } from './OnlineSessionService';
import { JOIN_SESSION_LABEL, ONLINE_SESSION_LABEL, START_SESSION_LABEL, STOP_SESSION_LABEL } from './ui/onlineCopy';
import { openOnlineSession } from './ui/openOnlineSession';

/** The presentation target Connect holds while hosting: Atlas's eye then presents to online players. */
export const ONLINE_TARGET = { id: 'atlas-vtt-connect', label: 'online players', isActive: (): boolean => true } as const;

export interface RegisterOnlineOptions {
  presentation: Pick<PresentationApi, 'addTarget'>;
  /** Opens "Join online session…" (joining comes with plan B12); without it there is no join command. */
  joinSession?: (app: App) => void;
}

function statusText(state: OnlineSessionState): string {
  const connected = state.players.filter((player) => player.status === 'admitted').length;
  const waiting = state.players.filter((player) => player.status === 'pending').length;
  return `Online · ${connected} ${connected === 1 ? 'player' : 'players'}${waiting ? ` · ${waiting} waiting` : ''}`;
}

/**
 * The commands, the status bar item and the presentation target, for as long as Atlas is connected. The
 * returned disposer stops the session and removes them all; Connect binds again when Atlas comes back.
 * "Present to players" and "Stop presenting" are Atlas's own commands: they present to this target.
 */
export function registerOnline(plugin: Plugin, service: OnlineSessionService, options: RegisterOnlineOptions): Disposer {
  const commands = ['online-session', 'start-online-session', 'stop-online-session'];
  plugin.addCommand({ id: 'online-session', name: `${ONLINE_SESSION_LABEL}…`, callback: () => openOnlineSession(plugin.app) });
  plugin.addCommand({
    id: 'start-online-session',
    name: START_SESSION_LABEL,
    checkCallback: (checking) => {
      const { status } = onlineSessionStore.getState();
      if (status === 'hosting' || status === 'starting') return false;
      if (!checking) void service.start();
      return true;
    },
  });
  plugin.addCommand({
    id: 'stop-online-session',
    name: STOP_SESSION_LABEL,
    checkCallback: (checking) => {
      if (onlineSessionStore.getState().status !== 'hosting') return false;
      if (!checking) service.stop();
      return true;
    },
  });
  const { joinSession } = options;
  if (joinSession) {
    commands.push('join-online-session');
    plugin.addCommand({ id: 'join-online-session', name: JOIN_SESSION_LABEL, callback: () => joinSession(plugin.app) });
  }

  const item = plugin.addStatusBarItem();
  item.addClass('mod-clickable');
  item.addEventListener('click', () => openOnlineSession(plugin.app));
  let stopTarget: Disposer | null = null;
  const render = (): void => {
    const state = onlineSessionStore.getState();
    item.toggle(state.status === 'hosting');
    item.setText(statusText(state));
    // Held while hosting, so Atlas's eye presents to online players; otherwise it opens the player window.
    if (state.status === 'hosting') stopTarget ??= options.presentation.addTarget(ONLINE_TARGET);
    else {
      stopTarget?.();
      stopTarget = null;
    }
  };
  render();
  const unsubscribe = onlineSessionStore.subscribe(render);
  return () => {
    unsubscribe();
    service.stop();
    service.release();
    stopTarget?.();
    stopTarget = null;
    item.remove();
    for (const id of commands) plugin.removeCommand(id);
  };
}
