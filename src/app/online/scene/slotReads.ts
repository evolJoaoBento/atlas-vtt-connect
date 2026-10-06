/**
 * The read side of the scene hub (`SlotProjection`): which scene each player has, which one the GM's view shows, who
 * has a scene, and every change. The hub extends it and keeps the slots, the places and the changes up to date; the
 * session's other parts (camera, assets, control, lasers, dice) read only this.
 */
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { SceneSlot } from './SceneSlot';
import type { PlayerPlaces } from './slotAudience';
import { SlotChanges, viewOf, type SlotChange, type SlotProjection, type SlotView } from './slotViews';

/** A change of the GM's store while `sceneId` is live, with what it holds for that scene. */
export interface LiveChange {
  sceneId: string;
  snapshot: SceneSnapshot | null;
}

export abstract class SlotReads implements SlotProjection {
  protected readonly slots = new Map<string, SceneSlot>();
  protected readonly changes = new SlotChanges();
  protected readonly liveChanges = new SlotChanges<LiveChange>();
  protected abstract readonly places: PlayerPlaces;

  slotOf(playerId: string): SlotView | null {
    const slot = this.places.slotOf(playerId);
    return slot ? viewOf(slot) : null;
  }

  liveSlot(): SlotView | null {
    const live = this.findSlot((slot) => slot.state === 'live');
    return live ? viewOf(live) : null;
  }

  shownSlot(): SlotView | null {
    const shown = this.findSlot((slot) => slot.shownSnapshot() !== null);
    return shown ? viewOf(shown) : null;
  }

  shownSnapshot(sceneId: string): SceneSnapshot | null {
    return this.findSlot((slot) => slot.sceneId === sceneId)?.shownSnapshot() ?? null;
  }

  audience(sceneId: string): string[] {
    const slot = this.findSlot((candidate) => candidate.sceneId === sceneId);
    return slot ? this.places.audience(slot) : [];
  }

  abstract splitActive(): boolean;
  abstract scenesInUse(): number;

  onSlotChange(listener: (change: SlotChange) => void): () => void {
    return this.changes.add(listener);
  }

  watchLive(listener: (sceneId: string, snapshot: SceneSnapshot | null) => void): () => void {
    return this.liveChanges.add(({ sceneId, snapshot }) => listener(sceneId, snapshot));
  }

  private findSlot(matches: (slot: SceneSlot) => boolean): SceneSlot | null {
    for (const slot of this.slots.values()) if (!slot.disposed && matches(slot)) return slot;
    return null;
  }
}
