/**
 * Who a scene's messages go to (ruling P1): the admitted players whose scene, as `SceneAssignments.sceneOf` resolves
 * it, is the slot's tab, and who were moved to it. Worked out at send time, after any reassignment. The one place
 * scene sends pick players (`admitted`, `audienceOf`), and where a player changing scene is moved (P3).
 */
import type { SessionPlayer } from '../GmSession';
import type { SceneAssignments } from '../split/SceneAssignments';
import { sameTab, type TabKey } from '../split/tabKey';
import type { PlayerChannels } from './PlayerChannels';
import type { SceneSlot } from './SceneSlot';
import { viewOf, type SlotChanges } from './slotViews';

/** The players the session lets see a scene now, in its order. */
export function admitted(players: readonly SessionPlayer[]): string[] {
  return players.filter((player) => player.status === 'admitted').map((player) => player.playerId);
}

/** The admitted players who see `slot`'s tab: those assigned to it, and its followers when it is the presented tab. */
export function audienceOf(slot: { readonly tab: TabKey }, players: readonly SessionPlayer[], assignments: SceneAssignments, presented: TabKey | null): string[] {
  return admitted(players).filter((playerId) => sameTab(assignments.sceneOf(playerId, presented), slot.tab));
}

const CLEAR = { v: 1, type: 'scene-clear' } as const;

/** The scene each admitted player was last sent, so that a change of their scene is a move, and nobody gets a scene twice. */
export class PlayerPlaces {
  private readonly placed = new Map<string, SceneSlot | null>();

  constructor(
    private readonly channels: PlayerChannels,
    private readonly changes: SlotChanges,
    private readonly players: () => SessionPlayer[],
    private readonly assignments: SceneAssignments,
    private readonly presented: () => TabKey | null,
  ) {}

  /**
   * Those whose scene it is, and who were moved to it: nobody gets a scene's messages before their clear. An admitted
   * player never placed (a session that admits without telling the hub) is placed on their scene.
   */
  audience(slot: SceneSlot): string[] {
    if (slot.disposed) return [];
    return audienceOf(slot, this.players(), this.assignments, this.presented()).filter((playerId) => {
      if (!this.placed.has(playerId)) this.placed.set(playerId, slot);
      return this.placed.get(playerId) === slot;
    });
  }

  slotOf(playerId: string): SceneSlot | null {
    return this.placed.get(playerId) ?? null;
  }

  /** Moves every placed admitted player whose scene is no longer the one they have (`targetOf`). */
  route(targetOf: (playerId: string) => SceneSlot | null): void {
    for (const playerId of admitted(this.players())) {
      // A player not placed yet is being admitted: `sendCurrent` gives them their scene.
      if (!this.placed.has(playerId)) continue;
      const from = this.placed.get(playerId) ?? null;
      const to = targetOf(playerId);
      if (to !== from) this.move(playerId, from, to);
    }
  }

  /** What `slot` has, to `playerId` (admitted, a resync), or a clear when it has nothing: never a new projection. */
  sendCurrent(playerId: string, slot: SceneSlot | null): void {
    this.placed.set(playerId, slot);
    if (slot) slot.sendCurrentTo(playerId);
    else this.channels.sendSequenced(playerId, CLEAR);
  }

  /** A new presentation: its followers keep the scene they have until its snapshot replaces it, as before split party. */
  follow(from: SceneSlot | null, to: SceneSlot): void {
    for (const [playerId, placed] of this.placed) if (placed === from && this.assignments.tabOf(playerId) === null) this.placed.set(playerId, to);
  }

  /** Presenting stopped: its followers lose their scene, with a clear, as before split party. */
  clearFollowers(): void {
    for (const playerId of admitted(this.players())) {
      if (this.assignments.tabOf(playerId) !== null) continue;
      this.channels.sendSequenced(playerId, CLEAR);
      this.placed.set(playerId, null);
    }
  }

  forget(playerId: string): void {
    this.placed.delete(playerId);
  }

  clear(): void {
    this.placed.clear();
  }

  /** P3: a clear first when they had a scene, then the new one's snapshot (and paused, when it is parked). */
  private move(playerId: string, from: SceneSlot | null, to: SceneSlot | null): void {
    if (from?.lastSent) this.channels.sendSequenced(playerId, CLEAR);
    this.placed.set(playerId, to);
    if (to?.lastSent) to.sendCurrentTo(playerId);
    this.changes.emit({ kind: 'moved', playerId, from: from ? viewOf(from) : null, to: to ? viewOf(to) : null });
  }
}
