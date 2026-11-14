import type { ControlMessage } from '../protocol';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { SceneSession } from './sceneSources';
import type { SlotProjection } from './slotViews';
import { RateLimit } from '../rateLimit';

export interface DynamicLightSlot { sceneId: string; setDynamicLights(enabled: boolean): void }
export interface DynamicLightProjection extends Pick<SlotProjection, 'slotOf' | 'onSlotChange'> {
  lightSlots(): readonly DynamicLightSlot[];
}

/** Session-global toggle. Any admitted participant may request it; only one validated state is broadcast. */
export class DynamicLightHost implements SessionHandler {
  private enabled = true;
  private readonly limit = new RateLimit(2);
  private stopSession: (() => void) | null = null;
  private stopProjection: (() => void) | null = null;
  constructor(private readonly options: { session: SceneSession; projection: DynamicLightProjection }) {}
  start(): void {
    this.stopSession ??= this.options.session.use(this);
    this.stopProjection ??= this.options.projection.onSlotChange(() => this.apply());
    this.apply();
  }
  stop(): void { this.stopSession?.(); this.stopSession = null; this.stopProjection?.(); this.stopProjection = null; this.limit.retain(new Set()); }
  onAdmitted(player: SessionPlayer): void { this.options.session.send(player.playerId, { v: 1, type: 'dynamic-light-state', enabled: this.enabled }); }
  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'dynamic-light-toggle' || !this.limit.allow(player.playerId, Date.now()) || this.enabled === message.enabled) return;
    this.enabled = message.enabled;
    this.apply();
    for (const participant of this.options.session.getPlayers()) if (participant.status === 'admitted') {
      this.options.session.send(participant.playerId, { v: 1, type: 'dynamic-light-state', enabled: this.enabled });
    }
  }
  onGone(player: SessionPlayer): void { this.limit.retain(new Set(this.options.session.getPlayers().filter((entry) => entry.playerId !== player.playerId).map((entry) => entry.playerId))); }
  private apply(): void { for (const slot of this.options.projection.lightSlots()) slot.setDynamicLights(this.enabled); }
}
