import type { Plugin } from 'obsidian';
import type { Disposer, PresentationApi } from '@atlas-vtt/api-types';
import { onlineSessionStore, type OnlineSessionState } from './onlineSessionStore';
import type { OnlineSessionService } from './OnlineSessionService';
import { EVERYONE_BACK_COMMAND } from './split/splitCopy';
import { canBringEveryoneBack } from './splitStore';
import { ONLINE_SESSION_LABEL, START_SESSION_LABEL, STOP_SESSION_LABEL } from './ui/onlineCopy';
import { openOnlineSession, type PanelOpener } from './ui/openOnlineSession';

/** The presentation target Connect holds while hosting: Atlas's eye then presents to online players. */
export const ONLINE_TARGET = { id: 'atlas-vtt-connect', label: 'online players', isActive: (): boolean => true } as const;

export interface RegisterOnlineOptions {
  presentation: Pick<PresentationApi, 'addTarget' | 'current'>;
  /** Atlas has scene tabs (`scene-tabs`): the split party's command, and the target badges the tabs players see. */
  splitParty?: boolean;
  /** Atlas's UI slots, when it has them: "Online session…" then opens the panel in a map view. */
  gmUi?: PanelOpener;
}

function statusText(state: OnlineSessionState): string {
  const connected = state.players.filter((player) => player.status === 'admitted').length;
  const waiting = state.players.filter((player) => player.status === 'pending').length;
  return `Online · ${connected} ${connected === 1 ? 'player' : 'players'}${waiting ? ` · ${waiting} waiting` : ''}`;
}

interface StatusItem {
  item: HTMLElement;
  /** What a click does for the current binding; nothing between bindings. */
  open: () => void;
}

/**
 * One status bar item per plugin, kept across bindings: Obsidian frees an item only when the plugin unloads, so a new
 * one per Atlas reload would pile up (final review M13). Between bindings it is hidden and does nothing.
 */
const statusItems = new WeakMap<Plugin, StatusItem>();

function statusItemOf(plugin: Plugin): StatusItem {
  const known = statusItems.get(plugin);
  if (known) return known;
  const item = plugin.addStatusBarItem();
  item.addClass('mod-clickable');
  const status: StatusItem = { item, open: () => undefined };
  item.addEventListener('click', () => status.open());
  statusItems.set(plugin, status);
  return status;
}

/**
 * The commands, the status bar item and the presentation target, for as long as Atlas is connected. The
 * returned disposer stops the session and removes them all; Connect binds again when Atlas comes back.
 * "Present to players" and "Stop presenting" are Atlas's own commands: they present to this target.
 */
export function registerOnline(plugin: Plugin, service: OnlineSessionService, options: RegisterOnlineOptions): Disposer {
  const commands = ['online-session', 'start-online-session', 'stop-online-session'];
  plugin.addCommand({ id: 'online-session', name: `${ONLINE_SESSION_LABEL}…`, callback: () => openOnlineSession(plugin.app, options.gmUi) });
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

  if (options.splitParty) {
    commands.push('everyone-back');
    plugin.addCommand({
      id: 'everyone-back',
      name: EVERYONE_BACK_COMMAND,
      checkCallback: (checking) => {
        if (!canBringEveryoneBack(options.presentation)) return false;
        if (!checking) service.everyoneBack();
        return true;
      },
    });
  }

  const status = statusItemOf(plugin);
  const { item } = status;
  const open = (): void => openOnlineSession(plugin.app, options.gmUi);
  status.open = open;
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
    // A newer binding may own the item already; only this binding's own state is taken down.
    if (status.open === open) {
      status.open = () => undefined;
      item.toggle(false);
    }
    for (const id of commands) plugin.removeCommand(id);
  };
}
