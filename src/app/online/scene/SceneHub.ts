/**
 * Sends each online player their scene. Without a split party that is the presented scene for everyone, exactly as
 * before: a snapshot on presenting, on admission and on a resync, patches at most every 50 ms, `scene-clear` when
 * presenting stops. With one (Atlas's `scene-tabs`), players assigned to another tab of the GM's view get that tab's
 * scene. One scene is live, the GM's active tab, attributed only by a loaded snapshot naming it (P2); the others are
 * parked at their last projection (`SceneSlot`). Every message goes to its slot's audience (`slotAudience`).
 */
import type { LiveScene } from '../atlas/presentedSource';
import type { TabScenes } from '../atlas/tabScenes';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { randomId } from '../ids';
import type { ControlMessage } from '../protocol';
import type { AssignResult, SceneAssignments } from '../split/SceneAssignments';
import { tabKeyOf, type TabKey } from '../split/tabKey';
import { PlayerChannels } from './PlayerChannels';
import { pickPlayerViewRules, samePlayerViewRules, type PlayerViewRules } from './playerViewRules';
import { noLightingCapability, type LightingSource } from './sceneLighting';
import { admitted, PlayerPlaces } from './slotAudience';
import type { SceneProjectionOptions } from './sceneSources';
import { SceneSlot, type SlotHost, type SlotSource } from './SceneSlot';
import type { PlayerScene } from './sceneTypes';
import { assignToTab, dropClosedTabs, scenesInUse, slotSource, type SplitActionDeps } from './splitActions';
import { SlotReads } from './slotReads';
import { viewOf, type SceneUse } from './slotViews';

export { FOG_TRUNCATED_NOTICE, SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE } from './sceneSources';
export type { PlayerViewSettingsSource, PresentedSceneSource, SceneProjectionOptions, SceneSession } from './sceneSources';

export interface SceneHubOptions extends SceneProjectionOptions {
  /** The GM's tabs (`scene-tabs`); null on an older Atlas: only the presented scene, attributed as before, and no split. */
  tabs: TabScenes | null;
  assignments: SceneAssignments;
}

export class SceneHub extends SlotReads implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  private readonly channels: PlayerChannels;
  protected readonly places: PlayerPlaces;
  private readonly host: SlotHost<SceneSlot>;
  private presentedSlot: SceneSlot | null = null;
  /** The presentation the presented slot shows: a new one is a new scene (`sceneId`). */
  private presentation: LiveScene | null = null;
  private rules: PlayerViewRules;
  private updating = false;
  private again = false;

  constructor(private readonly options: SceneHubOptions) {
    super();
    this.channels = new PlayerChannels(options.session);
    this.places = new PlayerPlaces(this.channels, this.changes, () => options.session.getPlayers(), options.assignments, () => this.presentedTab());
    this.rules = pickPlayerViewRules(options.settings.getLocalPlayerViewSettings());
    const lighting: LightingSource = options.lighting ?? noLightingCapability((message) => options.notify(message));
    this.host = {
      options, lighting,
      rules: () => this.rules,
      audience: (slot) => this.places.audience(slot),
      sendSequenced: (playerId, message) => this.channels.sendSequenced(playerId, message),
      send: (playerId, message) => options.session.send(playerId, message),
      projected: (slot) => this.changes.emit({ kind: 'projected', slot: viewOf(slot) }),
      observed: (slot, snapshot) => this.liveChanges.emit({ sceneId: slot.sceneId, snapshot }),
      caughtUp: (slot) => this.changes.emit({ kind: 'state', slot: viewOf(slot) }),
    };
  }

  start(): void {
    const { session, presented, settings, assets, tabs, assignments } = this.options;
    const scheduleLive = (): void => { for (const slot of this.slots.values()) slot.schedule(); };
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene) => (this.presentation === scene ? this.update() : this.present(scene, false)),
        held: (scene) => (this.presentation === scene ? this.update() : this.present(scene, true)),
        cleared: () => this.clearPresentation(),
      }),
      settings.onChange(() => this.settingsChanged()),
      // A fingerprint became known or was forgotten: the live tick.
      assets.onChange(scheduleLive),
      // A collection's resources or initiative rules changed: the live tick, and parked scenes too (D8).
      this.options.watchResources?.(() => this.rulesChanged()) ?? (() => undefined),
      // A collection's dice look (or the default's) changed: every scene in use reads its own again.
      this.options.diceLook?.watch(() => { for (const slot of this.slots.values()) slot.readLook(); }) ?? (() => undefined),
      assignments.onChange(() => { this.update(); this.changes.emit({ kind: 'assignments' }); }),
      tabs?.subscribeLive(() => this.update()) ?? (() => undefined),
      tabs?.subscribeTabs((closed) => this.tabsClosed(closed)) ?? (() => undefined),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.present(current, false);
  }

  stop(): void {
    for (const slot of this.slots.values()) slot.dispose();
    this.slots.clear();
    this.places.clear();
    this.presentedSlot = null;
    this.presentation = null;
    this.channels.clear();
    this.stops.splice(0).forEach((stop) => stop());
  }

  /**
   * What the presented scene's followers have now; null when none was sent or it was cleared. A read for the GM's side:
   * nothing sent to players comes from it (each part reads `slotOf`, per player).
   * @internal Tests read it; no part of the session does.
   */
  currentProjection(): PlayerScene | null {
    return this.presentedSlot?.lastSent ?? null;
  }

  splitActive(): boolean {
    return this.options.assignments.assignedCount() > 0;
  }

  scenesInUse(): number {
    return this.options.assignments.scenesInUse(this.presentedTab()).length;
  }

  /** For the GM's UI: whether players can be assigned (D12), who is assigned where, and the cap (D13). */
  splitSupported(): boolean { return this.options.tabs !== null; }
  assignedTabs(): Record<string, TabKey> { return this.options.assignments.entries(); }
  wouldExceedCap(playerId: string, tab: TabKey): boolean { return this.options.assignments.wouldExceedCap(playerId, tab, this.presentedTab()); }
  /** The session's players changed: a kicked player's assignment goes (spec 4); only a drop changes anything (I1). */
  playersChanged(players: readonly SessionPlayer[]): void { this.options.assignments.retainPlayers(new Set(players.map((player) => player.playerId))); }

  /** Pins a player to a tab of the GM's view (`assignToTab`); needs Atlas's scene tabs. */
  assign(playerId: string, tab: TabKey): Promise<AssignResult | 'couldnt-open'> {
    const { tabs } = this.options;
    if (!tabs) return Promise.reject(new Error('[Atlas VTT Connect] Assigning players to scenes needs Atlas VTT with scene tabs.'));
    return assignToTab({ ...this.splitDeps(), tabs, presented: () => this.presentedTab() }, playerId, tab);
  }

  unassign(playerId: string): void {
    this.options.assignments.unassign(playerId);
  }

  /** Everyone follows the presented scene again; nothing while nothing is presented (D9: it would blank every screen). */
  everyoneBack(): void {
    if (this.presentedTab()) this.options.assignments.clear();
  }

  /** The scenes in use, the presented one first. */
  scenes(): SceneUse[] {
    return scenesInUse(this.slots.values(), this.presentedSlot, this.options.session.getPlayers(), this.options.assignments, this.presentedTab());
  }

  /** Also fires when a newer tab of a player replaces an older one: always a full snapshot. */
  onAdmitted(player: SessionPlayer): void {
    this.sendCurrent(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    // Players never send scene data; a resync is the only scene message the GM acts on.
    if (message.type !== 'scene-resync') return;
    const { playerId } = player;
    this.channels.requestResync(playerId, () => {
      if (admitted(this.options.session.getPlayers()).includes(playerId)) this.sendCurrent(playerId);
    });
  }

  onGone(player: SessionPlayer): void {
    this.channels.forget(player.playerId);
    this.places.forget(player.playerId);
  }

  private presentedTab(): TabKey | null {
    const info = this.presentation?.info;
    return info ? { viewId: info.viewId, tabId: info.tabId } : null;
  }

  /** A new presentation: a new scene for its followers. One that starts held clears them until it is live, as before. */
  private present(scene: LiveScene, held: boolean): void {
    const old = this.presentedSlot;
    this.presentation = scene;
    const slot = this.addSlot(this.presentedTab()!);
    this.presentedSlot = slot;
    // Followers keep the scene they have until the new one's snapshot replaces it, as before split party.
    if (!held) this.places.follow(old, slot);
    // D15: players assigned to the newly presented tab now follow it.
    this.options.assignments.presentedChanged(this.presentedTab());
    this.update();
  }

  private clearPresentation(): void {
    this.presentation = null;
    this.presentedSlot = null;
    this.places.clearFollowers();
    this.update();
  }

  private tabsClosed(closed: TabKey[]): void {
    dropClosedTabs(this.splitDeps(), closed, this.options.session.getPlayers());
    this.update();
  }

  private splitDeps(): Omit<SplitActionDeps, 'tabs' | 'presented'> {
    return { assignments: this.options.assignments, slotAt: (tab) => this.slotAt(tab), notify: (message) => this.options.notify(message) };
  }

  private settingsChanged(): void {
    const rules = pickPlayerViewRules(this.options.settings.getLocalPlayerViewSettings());
    if (samePlayerViewRules(rules, this.rules)) return;
    this.rules = rules;
    this.rulesChanged();
  }

  /** D8: parked scenes too, from what they kept: a GM who hides something expects it hidden everywhere. */
  private rulesChanged(): void {
    for (const slot of this.slots.values()) slot.rulesChanged();
  }

  /**
   * Brings everything in line after any change, in this order: the scenes in use exist, every player whose scene
   * changed is moved (a clear, then the new scene's snapshot), scenes out of use go, and the GM's tab is the live one.
   * Moves come before any going live, so a scene's first snapshot never reaches a player before their clear.
   */
  private update(): void {
    if (this.updating) {
      this.again = true;
      return;
    }
    this.updating = true;
    try {
      do {
        this.again = false;
        this.reconcile();
      } while (this.again);
    } finally {
      this.updating = false;
    }
  }

  private reconcile(): void {
    const { session, assignments, tabs } = this.options;
    const players = session.getPlayers();
    this.channels.retain(players);
    assignments.retainPlayers(new Set(players.map((player) => player.playerId)));
    const presented = this.presentedTab();
    for (const tab of assignments.scenesInUse(presented)) if (!this.slots.has(tabKeyOf(tab))) this.addSlot(tab);
    this.places.route((playerId) => this.slotAt(assignments.sceneOf(playerId, presented)));
    const inUse = new Set(assignments.scenesInUse(presented).map(tabKeyOf));
    for (const [key, slot] of [...this.slots]) {
      if (inUse.has(key)) continue;
      this.slots.delete(key);
      this.free(slot);
    }
    for (const slot of this.slots.values()) {
      const info = tabs?.tab(slot.tab);
      if (info) {
        slot.name = info.name;
        slot.mapPath = info.mapPath;
      }
      slot.mapSeen();
      const before = slot.state;
      if (this.isActive(slot)) slot.goLive();
      else slot.park();
      if (slot.state !== before) this.changes.emit({ kind: 'state', slot: viewOf(slot) });
    }
  }

  /** What the player's scene has, or a clear when they have none: never a new projection. */
  private sendCurrent(playerId: string): void {
    this.places.sendCurrent(playerId, this.sceneSlotOf(playerId));
  }

  protected sceneSlotOf(playerId: string): SceneSlot | null {
    return this.slotAt(this.options.assignments.sceneOf(playerId, this.presentedTab()));
  }

  /** A slot for `tab`, in place of any other there (a new presentation of an assigned tab is a new scene). */
  private addSlot(tab: TabKey): SceneSlot {
    const key = tabKeyOf(tab);
    const previous = this.slots.get(key);
    const slot = new SceneSlot(tab, randomId(), this.sourceOf(tab), this.host);
    const info = this.options.tabs?.tab(tab);
    slot.name = info?.name ?? '';
    slot.mapPath = info?.mapPath ?? this.presentation?.info.mapPath ?? '';
    this.slots.set(key, slot);
    if (previous) this.free(previous);
    return slot;
  }

  private free(slot: SceneSlot): void {
    slot.dispose();
    if (slot === this.presentedSlot) this.presentedSlot = null;
    this.changes.emit({ kind: 'freed', slot: viewOf(slot) });
  }

  private sourceOf(tab: TabKey): SlotSource {
    const scene = this.presentation;
    return slotSource(this.options.tabs, tab, scene, () => this.presentation === scene);
  }

  /** Live while the GM is on its tab (its map loaded or loading); an older Atlas: the presented scene while not held. */
  private isActive(slot: SceneSlot): boolean {
    const { tabs, presented } = this.options;
    if (tabs) return tabs.isActive(slot.tab);
    return slot === this.presentedSlot && !presented.isHeld();
  }

  private slotAt(tab: TabKey | null): SceneSlot | null {
    return tab ? this.slots.get(tabKeyOf(tab)) ?? null : null;
  }
}
