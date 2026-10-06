/**
 * What the scene hub tells the rest of the session about its scenes (B6–B9 read it): which scene each player has, the
 * live one, and every change. Also the shape the GM's panel reads (`SceneUse`).
 */
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { TabKey } from '../split/tabKey';
import type { SceneSlot, SlotState } from './SceneSlot';
import type { PlayerScene } from './sceneTypes';

/** One scene in use, as the session's other parts see it. */
export interface SlotView {
  tab: TabKey;
  sceneId: string;
  state: SlotState;
  lastSent: PlayerScene | null;
  mapPath: string;
  name: string;
}

export type SlotChange =
  /** What the slot's players have changed. */
  | { kind: 'projected'; slot: SlotView }
  /** Live ↔ parked. */
  | { kind: 'state'; slot: SlotView }
  /** A player now has another scene (or none). */
  | { kind: 'moved'; playerId: string; from: SlotView | null; to: SlotView | null }
  /** The scene is no longer in use. */
  | { kind: 'freed'; slot: SlotView };

/** Replaces `CameraProjection`: what a player has, and every change of it. */
export interface SlotProjection {
  /** The scene `playerId` was sent (or is waiting for); null when they have none. */
  slotOf(playerId: string): SlotView | null;
  /** The slot of the GM's active tab, its map loaded or loading. */
  liveSlot(): SlotView | null;
  /**
   * The live slot while the GM's view holds its scene and it is caught up (P2: a loaded snapshot naming its tab; P8:
   * not waiting for sight); null otherwise. The GM's camera, laser and moves act only on this one.
   */
  shownSlot(): SlotView | null;
  /** The snapshot of the shown slot with this `sceneId`, read now; null for any other. */
  shownSnapshot(sceneId: string): SceneSnapshot | null;
  /** The admitted players who have the scene `sceneId` now (P1); none for a scene no longer in use. */
  audience(sceneId: string): string[];
  /** Whether a split exists: at least one player is assigned to a tab. */
  splitActive(): boolean;
  /** How many scenes are in use, the presented one included. */
  scenesInUse(): number;
  onSlotChange(listener: (change: SlotChange) => void): () => void;
  /** Each change of the GM's store while a scene is live, with the snapshot it holds for that scene (null while loading). */
  watchLive(listener: (sceneId: string, snapshot: SceneSnapshot | null) => void): () => void;
}

/** A scene in use for the GM's UI: who sees it and whether it is live. */
export interface SceneUse {
  tab: TabKey;
  name: string;
  presented: boolean;
  /** Every player who sees it, connected or not. */
  playerIds: string[];
  state: SlotState;
}

export function viewOf(slot: SceneSlot): SlotView {
  return { tab: { ...slot.tab }, sceneId: slot.sceneId, state: slot.state, lastSent: slot.lastSent, mapPath: slot.mapPath, name: slot.name };
}

/** Listeners of slot changes (or of `T`), each guarded: one that throws does not stop the others. */
export class SlotChanges<T = SlotChange> {
  private readonly listeners = new Set<(change: T) => void>();

  add(listener: (change: T) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  emit(change: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        console.error('[Atlas VTT Connect] A scene change listener failed:', error);
      }
    }
  }
}

/** Tells listeners each change (by reference) of what `current` gives: the presented scene's followers' projection. */
export class ProjectionWatch {
  private readonly listeners = new Set<(scene: PlayerScene | null) => void>();
  private last: PlayerScene | null = null;

  constructor(private readonly current: () => PlayerScene | null) {}

  add(listener: (scene: PlayerScene | null) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  check(): void {
    const scene = this.current();
    if (scene === this.last) return;
    this.last = scene;
    for (const listener of [...this.listeners]) listener(scene);
  }
}
