/**
 * The split party's actions on the scene hub: assigning a player to a tab (switching to a never-live one first, D4),
 * dropping the players of closed tabs, the scenes in use for the GM's UI, and where each scene's data comes from. The
 * hub keeps the scenes; the actions only change `SceneAssignments`, which the hub follows.
 */
import type { LiveScene } from '../atlas/presentedSource';
import type { TabScenes } from '../atlas/tabScenes';
import type { SessionPlayer } from '../GmSession';
import type { AssignResult, SceneAssignments } from '../split/SceneAssignments';
import { closedNotice, couldntOpen } from '../split/splitCopy';
import { sameTab, type TabKey } from '../split/tabKey';
import type { SceneSlot, SlotSource } from './SceneSlot';
import type { SceneUse } from './slotViews';

export interface SplitActionDeps {
  tabs: TabScenes;
  assignments: SceneAssignments;
  presented(): TabKey | null;
  slotAt(tab: TabKey): SceneSlot | null;
  notify(message: string): void;
}

/** How long a tab switched to only to be read is kept on, at most, before Atlas goes back to the GM's tab. */
export const READ_TAB_MS = 5_000;

/**
 * Pins a player to a tab. A tab never projected in this session is switched to first (D4), its players waiting until
 * it loads; if Atlas cannot show it, the assignment is undone and the GM told (`'couldnt-open'`). A switch overtaken
 * while the tab was projected anyway undoes nothing. When the GM works elsewhere than Atlas's view (Tabletop's board),
 * the switch is only to read the tab: once its first picture is sent, Atlas goes back to the tab it was on, so that
 * scene (the presented one, most often) keeps reaching its players and the GM's board keeps its map.
 */
export async function assignToTab(deps: SplitActionDeps, playerId: string, tab: TabKey): Promise<AssignResult | 'couldnt-open'> {
  const { tabs, assignments } = deps;
  const before = assignments.tabOf(playerId);
  const result = assignments.assign(playerId, tab, deps.presented());
  const slot = deps.slotAt(tab);
  if (result !== 'ok' || !slot || slot.lastSent || tabs.isActive(tab)) return result;
  const back = tabs.returnTab?.(tab) ?? null;
  const shown = await tabs.show(tab);
  if (shown && back) await returnAfterRead(tabs, slot, tab, back);
  if (shown || slot.lastSent || !sameTab(assignments.tabOf(playerId), tab)) return 'ok';
  if (before) assignments.assign(playerId, before, deps.presented());
  else assignments.unassign(playerId);
  deps.notify(couldntOpen(tabs.tab(tab)?.name ?? slot.name));
  return 'couldnt-open';
}

/** Waits for `slot`'s first picture (at most `READ_TAB_MS`), then shows `back` again, unless the GM moved on meanwhile. */
async function returnAfterRead(tabs: TabScenes, slot: SceneSlot, tab: TabKey, back: TabKey): Promise<void> {
  const deadline = Date.now() + READ_TAB_MS;
  while (!slot.lastSent && !slot.disposed && tabs.isActive(tab) && Date.now() < deadline) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  // The GM chose another tab meanwhile, or the tab went: theirs to keep.
  if (!tabs.isActive(tab) || !tabs.tab(back)) return;
  await tabs.show(back);
}

/** Closed tabs: their players follow the presented scene again, and the GM hears who went back from where. */
export function dropClosedTabs(deps: Omit<SplitActionDeps, 'tabs' | 'presented'>, closed: readonly TabKey[], players: readonly SessionPlayer[]): void {
  for (const tab of closed) {
    const name = deps.slotAt(tab)?.name ?? '';
    const back = deps.assignments.dropTab(tab);
    const names = back.map((playerId) => players.find((player) => player.playerId === playerId)?.name ?? '').filter(Boolean);
    if (names.length > 0) deps.notify(closedNotice(names, name));
  }
}

/** The scenes in use and every player who sees each, connected or not. */
export function scenesInUse(slots: Iterable<SceneSlot>, presentedSlot: SceneSlot | null, players: readonly SessionPlayer[], assignments: SceneAssignments, presented: TabKey | null): SceneUse[] {
  return [...slots].map((slot) => ({
    tab: { ...slot.tab }, name: slot.name, presented: slot === presentedSlot, state: slot.state,
    playerIds: players.map((player) => player.playerId).filter((playerId) => sameTab(assignments.sceneOf(playerId, presented), slot.tab)),
  }));
}

/**
 * Where a slot's scene comes from: with scene tabs, only a loaded snapshot naming its tab (P2); on an older Atlas only
 * the presented scene, attributed as before by the presentation (while `current`) and `loaded`.
 */
export function slotSource(tabs: TabScenes | null, tab: TabKey, scene: LiveScene | null, current: () => boolean): SlotSource {
  if (tabs) return { snapshot: () => tabs.liveSnapshot(tab), subscribe: (listener) => tabs.watch(tab.viewId, listener) };
  if (!scene) return { snapshot: () => null, subscribe: () => () => undefined };
  return {
    snapshot: () => {
      const snapshot = scene.snapshot();
      return current() && snapshot?.loaded === true ? snapshot : null;
    },
    subscribe: (listener) => scene.subscribe(listener),
  };
}
