/**
 * Who is pinned to which tab in a split party: session memory only, no Atlas and no session. A player without an
 * assignment follows the presented scene; the model never holds the presented tab. `sceneOf` is the one place that
 * resolves a player's scene: every other part asks it rather than working it out again.
 */
import { SPLIT_LIMITS } from './splitLimits';
import { sameTab, tabKeyOf, type TabKey } from './tabKey';

/** `ok`: stored; `follows`: the presented tab, so nothing is stored and the player follows; `cap`: refused, a fifth scene. */
export type AssignResult = 'ok' | 'follows' | 'cap';

type ChangeListener = (playerIds: string[]) => void;

export class SceneAssignments {
  private readonly tabs = new Map<string, TabKey>();
  private readonly listeners = new Set<ChangeListener>();

  /** Pins `playerId` to `tab`, moving them from any other; the presented tab unpins them instead (they follow it). */
  assign(playerId: string, tab: TabKey, presented: TabKey | null): AssignResult {
    if (sameTab(tab, presented)) {
      this.unassign(playerId);
      return 'follows';
    }
    if (sameTab(this.tabOf(playerId), tab)) return 'ok';
    if (this.wouldExceedCap(playerId, tab, presented)) return 'cap';
    this.tabs.set(playerId, { viewId: tab.viewId, tabId: tab.tabId });
    this.emit([playerId]);
    return 'ok';
  }

  /** The player follows the presented scene again. */
  unassign(playerId: string): void {
    if (this.tabs.delete(playerId)) this.emit([playerId]);
  }

  /** Everyone back to the presented scene: the players who were assigned, each once, with one change. */
  clear(): string[] {
    return this.dropWhere(() => true);
  }

  /** The tab `playerId` is pinned to; null when they follow. */
  tabOf(playerId: string): TabKey | null {
    const tab = this.tabs.get(playerId);
    return tab ? { viewId: tab.viewId, tabId: tab.tabId } : null;
  }

  /** The scene `playerId` sees: their tab, else the presented one, else none. */
  sceneOf(playerId: string, presented: TabKey | null): TabKey | null {
    return this.tabOf(playerId) ?? presented;
  }

  /** A closed tab: its players follow again; returns who went back. */
  dropTab(tab: TabKey): string[] {
    return this.dropWhere((pinned) => sameTab(pinned, tab));
  }

  /** A closed view: every tab of it is dropped; returns who went back. */
  dropView(viewId: string): string[] {
    return this.dropWhere((pinned) => pinned.viewId === viewId);
  }

  /** A new presentation (D15): players assigned to the newly presented tab become its followers; returns them. */
  presentedChanged(presented: TabKey | null): string[] {
    return presented === null ? [] : this.dropTab(presented);
  }

  /** Drops the players the session no longer knows (kicked); a disconnected player is still known, and kept. */
  retainPlayers(known: ReadonlySet<string>): void {
    this.dropWhere((_tab, playerId) => !known.has(playerId));
  }

  /** The scenes in use: the presented one first, then each assigned tab once. */
  scenesInUse(presented: TabKey | null): TabKey[] {
    return [...this.inUse(this.tabs, presented).values()];
  }

  /** Whether pinning `playerId` to `tab` would put more than `SPLIT_LIMITS.scenesInUse` scenes in use. */
  wouldExceedCap(playerId: string, tab: TabKey, presented: TabKey | null): boolean {
    if (sameTab(tab, presented)) return false;
    const after = new Map(this.tabs);
    after.set(playerId, tab);
    return this.inUse(after, presented).size > SPLIT_LIMITS.scenesInUse;
  }

  /** How many players are pinned to a tab, connected or not. */
  assignedCount(): number {
    return this.tabs.size;
  }

  /** Called with the players whose scene changed; returns the disposer. */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private inUse(tabs: ReadonlyMap<string, TabKey>, presented: TabKey | null): Map<string, TabKey> {
    const scenes = new Map<string, TabKey>();
    if (presented) scenes.set(tabKeyOf(presented), presented);
    for (const tab of tabs.values()) if (!scenes.has(tabKeyOf(tab))) scenes.set(tabKeyOf(tab), { viewId: tab.viewId, tabId: tab.tabId });
    return scenes;
  }

  private dropWhere(matches: (tab: TabKey, playerId: string) => boolean): string[] {
    const dropped = [...this.tabs].filter(([playerId, tab]) => matches(tab, playerId)).map(([playerId]) => playerId);
    for (const playerId of dropped) this.tabs.delete(playerId);
    if (dropped.length > 0) this.emit(dropped);
    return dropped;
  }

  private emit(playerIds: string[]): void {
    for (const listener of [...this.listeners]) listener([...playerIds]);
  }
}
