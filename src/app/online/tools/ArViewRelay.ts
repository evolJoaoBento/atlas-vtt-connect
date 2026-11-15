/**
 * Players' phones in augmented reality, to the GM's Tabletop board (`arViews.ts`). A player's `ar-view` is accepted only
 * for the scene the sender has, at most `AR_VIEW_LIMITS.perSecond` a second, and goes to the board as an eye of the
 * sender's map, in their laser colour and with their name. Nothing goes to other players and nothing is stored. A player
 * who leaves, or moves to another map, has their eye taken away. A `GmSession` handler.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { SlotProjection } from '../scene/slotViews';
import { AR_VIEW_LIMITS, isArPose } from './arViews';
import { AR_TABLE_LIMITS, isArTable } from './arTable';
import type { BoardSessionSink } from './BoardSessionHub';
import { laserColor } from './laserColors';

export interface ArViewRelayOptions {
  session: SceneSession;
  /** A player's colour (their pick); their place's without it. */
  colorOf?(playerId: string): string;
  projection: Pick<SlotProjection, 'slotOf'>;
  board: Pick<BoardSessionSink, 'viewer' | 'survey'>;
}

export class ArViewRelay implements SessionHandler {
  private readonly limit = new RateLimit(AR_VIEW_LIMITS.perSecond);
  private readonly surveyLimit = new RateLimit(AR_TABLE_LIMITS.surveysPerMinute, 60_000);
  /** The map each player's eye is on, and how it was shown. */
  private readonly shown = new Map<string, { mapPath: string; name: string; color: string }>();
  private unuse: (() => void) | null = null;

  constructor(private readonly options: ArViewRelayOptions) {}

  start(): void {
    this.unuse ??= this.options.session.use(this);
  }

  stop(): void {
    this.unuse?.();
    this.unuse = null;
    for (const playerId of [...this.shown.keys()]) this.hide(playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'ar-survey') { this.surveyed(player, message); return; }
    if (message.type !== 'ar-view' || (message.pose !== null && !isArPose(message.pose))) return;
    const slot = this.options.projection.slotOf(player.playerId);
    if (!slot?.lastSent || message.sceneId !== slot.sceneId) return;
    if (message.pose === null) { this.hide(player.playerId); return; }
    if (!this.limit.allow(player.playerId, Date.now())) return;
    const before = this.shown.get(player.playerId);
    if (before && before.mapPath !== slot.mapPath) this.hide(player.playerId);
    const players = this.options.session.getPlayers();
    const color = this.options.colorOf?.(player.playerId) ?? laserColor(player.playerId, players.map((each) => each.playerId));
    this.shown.set(player.playerId, { mapPath: slot.mapPath, name: player.name, color });
    this.options.board.viewer(slot.mapPath, player.playerId, player.name, color, message.pose);
  }

  /** A player's survey of the table: to the board, for the map of the scene they have. */
  private surveyed(player: SessionPlayer, message: Extract<ControlMessage, { type: 'ar-survey' }>): void {
    if (!isArTable(message.survey)) return;
    const slot = this.options.projection.slotOf(player.playerId);
    if (!slot?.lastSent || message.sceneId !== slot.sceneId || !this.surveyLimit.allow(player.playerId, Date.now())) return;
    this.options.board.survey(slot.mapPath, player.playerId, player.name, message.survey);
  }

  onGone(player: SessionPlayer): void {
    this.hide(player.playerId);
    this.limit.retain(new Set(this.options.session.getPlayers().map((each) => each.playerId)));
  }

  private hide(playerId: string): void {
    const shown = this.shown.get(playerId);
    if (!shown) return;
    this.shown.delete(playerId);
    this.options.board.viewer(shown.mapPath, playerId, shown.name, shown.color, null);
  }
}
