/**
 * The split party's rows, the same for the panel's "Present to:" popover and the eye's "Present to" section (spec
 * 3.4), plus what both read of who sees a tab: the button's label and the eye's badge. Pure: the caller passes the
 * store's copy of the assignments, the presented tab and the actions; `resolveScene` is the one rule of where a player is.
 */
import type { PresentationApi } from '@atlas-vtt/api-types';
import type { SessionPlayer } from '../GmSession';
import type { OnlineSessionState } from '../onlineSessionStore';
import { resolveScene } from '../split/SceneAssignments';
import {
  CAP_NOTE, EVERYONE_BACK_LABEL, PRESENT_TO_HEADING, badge, presentSceneToHeading, presentToLabel, rowLabel, type RowPlace,
} from '../split/splitCopy';
import { sameTab, type TabKey } from '../split/tabKey';

/** What the rows can do (`OnlineSessionService`). */
export interface SplitActions {
  assign(playerId: string, tab: TabKey): void;
  unassign(playerId: string): void;
  everyoneBack(): void;
  /** Whether assigning would put a fifth scene in use (the hub's cap, D13). */
  wouldExceedCap(playerId: string, tab: TabKey): boolean;
}

/** The session as the rows read it: the store's players and assignments, the presented tab, and each tab's name. */
export interface SplitView {
  players: readonly SessionPlayer[];
  assignments: Readonly<Record<string, TabKey>>;
  assignedCount: number;
  presented: TabKey | null;
  nameOf(tab: TabKey): string;
}

/** The split party in `state`, with Atlas's presented tab and `nameOf` for the scene names: what every reader builds on. */
export function splitViewOf(state: OnlineSessionState, presentation: Pick<PresentationApi, 'current'>, nameOf: (tab: TabKey) => string): SplitView {
  const current = presentation.current();
  return {
    players: state.players,
    assignments: state.assignments,
    assignedCount: state.assignedCount,
    presented: current ? { viewId: current.viewId, tabId: current.tabId } : null,
    nameOf,
  };
}

/** Whether the split party's menus and badges show: hosting, on an Atlas with scene tabs. */
export function splitShown(state: OnlineSessionState): boolean {
  return state.status === 'hosting' && state.split === 'on';
}

/** A tab the rows are for: the GM's active tab (panel) or the right-clicked one (eye). */
export interface RowTab extends TabKey { name: string }

export interface PresentToRow { playerId: string; label: string; checked: boolean; disabled: boolean; choose(): void }

export interface PresentToMenu {
  heading: string;
  /** Empty when no player is admitted or disconnected: the caller shows "No players connected". */
  rows: PresentToRow[];
  /** "At most 4 scenes at once" while a row is disabled by the cap. */
  capNote: string | null;
  everyoneBack: { label: string; disabled: boolean; choose(): void };
}

/** The players both menus list: admitted and disconnected, in the panel's order; waiting ones are not in the session yet. */
export function listedPlayers(players: readonly SessionPlayer[]): SessionPlayer[] {
  return players.filter((player) => player.status !== 'pending');
}

/** The scene `playerId` sees: their tab, else the presented one, else none. */
export function sceneOfPlayer(view: SplitView, playerId: string): TabKey | null {
  return resolveScene(view.assignments[playerId], view.presented);
}

/** The listed players who see `tab`: followers of a presented tab, and the players assigned to it. */
export function viewersOf(view: SplitView, tab: TabKey): SessionPlayer[] {
  return listedPlayers(view.players).filter((player) => sameTab(sceneOfPlayer(view, player.playerId), tab));
}

/** The "Present to:" button's label for `tab`. */
export function presentToButtonLabel(view: SplitView, tab: TabKey): string {
  return presentToLabel(viewersOf(view, tab).map((player) => player.name), listedPlayers(view.players).length, sameTab(tab, view.presented));
}

/** The mark after `tab`'s eye while anyone is assigned: how many players see it; none otherwise (spec 3.7). */
export function tabBadgeText(view: SplitView, tab: TabKey): string | null {
  if (view.assignedCount === 0) return null;
  const players = viewersOf(view, tab).length;
  return players > 0 ? badge(players) : null;
}

function placeOf(view: SplitView, scene: TabKey | null): RowPlace {
  return scene ? { kind: 'on', scene: view.nameOf(scene) } : { kind: 'no-scene' };
}

/** The row of `player` for `tab`, and whether the cap disabled it. */
function rowFor(view: SplitView, tab: RowTab, player: SessionPlayer, actions: SplitActions): { row: PresentToRow; capped: boolean } {
  const { playerId, name } = player;
  const gone = player.status === 'gone';
  const assigned = view.assignments[playerId] ?? null;
  const here = rowLabel(name, { kind: 'here' }, gone);
  // D16: a follower of the presented tab has nowhere else to go from here; tick them on another tab instead.
  if (!assigned && sameTab(tab, view.presented)) return { row: { playerId, label: here, checked: true, disabled: true, choose: () => undefined }, capped: false };
  if (sameTab(assigned, tab)) return { row: { playerId, label: here, checked: true, disabled: false, choose: () => actions.unassign(playerId) }, capped: false };
  const capped = actions.wouldExceedCap(playerId, tab);
  const row: PresentToRow = {
    playerId, label: rowLabel(name, placeOf(view, sceneOfPlayer(view, playerId)), gone), checked: false, disabled: capped,
    // Assigning to the presented tab stores nothing: the player follows it again.
    choose: () => { if (!capped) actions.assign(playerId, { viewId: tab.viewId, tabId: tab.tabId }); },
  };
  return { row, capped };
}

/** Both menus for `tab`: the heading, one row per listed player, the cap note and "Everyone back". */
export function presentToMenu(tab: RowTab, view: SplitView, actions: SplitActions, headingKind: 'section' | 'panel'): PresentToMenu {
  const built = listedPlayers(view.players).map((player) => rowFor(view, tab, player, actions));
  return {
    heading: headingKind === 'panel' ? presentSceneToHeading(tab.name) : PRESENT_TO_HEADING,
    rows: built.map(({ row }) => row),
    capNote: built.some(({ capped }) => capped) ? CAP_NOTE : null,
    everyoneBack: {
      label: EVERYONE_BACK_LABEL,
      // D9: with nothing presented it would blank every screen.
      disabled: view.assignedCount === 0 || view.presented === null,
      choose: () => actions.everyoneBack(),
    },
  };
}
