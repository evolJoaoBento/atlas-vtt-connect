/** What a scene slot needs: where its scene comes from while live, and what it needs of the hub. */
import type { Disposer, SceneSnapshot } from '@atlas-vtt/api-types';
import type { ControlMessage } from '../protocol';
import type { PlayerViewRules } from './playerViewRules';
import type { LightingSource } from './sceneLighting';
import type { SceneOutgoing } from './sceneMessages';
import type { SceneProjectionOptions } from './sceneSources';

export type SlotState = 'waiting' | 'live' | 'parked';

/** Where a slot's scene comes from while it is live. */
export interface SlotSource {
  /** The snapshot holding this slot's scene now (P2: loaded, and its tab's); null while loading or holding another tab's. */
  snapshot(): SceneSnapshot | null;
  /** Each change of the view's store; subscribed only while the slot is live. */
  subscribe(listener: (snapshot: SceneSnapshot) => void): Disposer;
}

/** What a slot needs of the hub; `S` is the slot, as the hub's callbacks get it back. */
export interface SlotHost<S> {
  readonly options: SceneProjectionOptions;
  readonly lighting: LightingSource;
  rules(): PlayerViewRules;
  /** The players who see this slot now. */
  audience(slot: S): string[];
  sendSequenced(playerId: string, message: SceneOutgoing): void;
  /** Unsequenced: `scene-state` (D19). */
  send(playerId: string, message: ControlMessage): void;
  /** What its players have changed. */
  projected(slot: S): void;
}
