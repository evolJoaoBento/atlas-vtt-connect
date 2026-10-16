/**
 * Lasting templates in an online session, per scene (`tools/templates.ts`). A player's `map-template` adds one (at
 * most `perPlayer` of theirs and `perScene` in all) or removes one of their own, for the scene they have; the GM gives
 * it its id and its owner's colour, and sends the scene's whole list to its players whenever it changes, to a player
 * when they are admitted or move to another scene, and shows it in its own view of the scene it shows. The GM clears
 * them all with `clear`. Templates of players who leave the session (removed, not just disconnected) go. A
 * `GmSession` handler.
 */
import type { ViewId } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { SlotChange, SlotProjection } from '../scene/slotViews';
import { laserColor } from './laserColors';
import { TEMPLATE_LIMITS, type MapTemplate } from './templates';

export interface TemplateHostOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'audience' | 'shownSlot' | 'onSlotChange'>;
  /** Shows a scene's templates in the GM's view of it; without it the GM sees none. */
  show?: (viewId: ViewId, templates: readonly MapTemplate[], mapPath: string) => void;
}

export class TemplateHost implements SessionHandler {
  private readonly limit = new RateLimit(TEMPLATE_LIMITS.perSecond);
  private readonly byScene = new Map<string, MapTemplate[]>();
  private readonly stops: Array<() => void> = [];
  private next = 1;
  /** The view the GM's templates were last drawn in, so a scene the GM leaves is cleared there. */
  private drawnIn: { viewId: ViewId; sceneId: string } | null = null;

  constructor(private readonly options: TemplateHostOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.options.session.use(this), this.options.projection.onSlotChange((change) => this.slotChanged(change)));
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    this.clearGmView();
    this.byScene.clear();
  }

  /** The GM takes every template off every scene. */
  clear(): void {
    const scenes = [...this.byScene.keys()];
    this.byScene.clear();
    for (const sceneId of scenes) this.broadcast(sceneId);
  }

  /** Whether any scene has a template: what the GM's clear command offers. */
  hasAny(): boolean {
    return [...this.byScene.values()].some((list) => list.length > 0);
  }

  onAdmitted(player: SessionPlayer): void {
    this.sendTo(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'map-template') return;
    const slot = this.options.projection.slotOf(player.playerId);
    if (!slot?.lastSent || message.sceneId !== slot.sceneId || !this.limit.allow(player.playerId, Date.now())) return;
    const list = this.byScene.get(slot.sceneId) ?? [];
    if (message.remove !== undefined) {
      const kept = list.filter((template) => !(template.id === message.remove && template.owner === player.playerId));
      if (kept.length === list.length) return;
      this.byScene.set(slot.sceneId, kept);
    } else if (message.add) {
      const own = list.filter((template) => template.owner === player.playerId).length;
      if (own >= TEMPLATE_LIMITS.perPlayer || list.length >= TEMPLATE_LIMITS.perScene) return;
      const order = this.options.session.getPlayers().map((each) => each.playerId);
      const { shape, start, end } = message.add;
      list.push({ id: `t${this.next++}`, owner: player.playerId, shape, start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, color: laserColor(player.playerId, order) });
      this.byScene.set(slot.sceneId, list);
    } else return;
    this.broadcast(slot.sceneId);
  }

  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    for (const [sceneId, list] of this.byScene) {
      const kept = list.filter((template) => known.has(template.owner));
      if (kept.length === list.length) continue;
      this.byScene.set(sceneId, kept);
      this.broadcast(sceneId);
    }
  }

  private slotChanged(change: SlotChange): void {
    if (change.kind === 'moved') this.sendTo(change.playerId);
    // The GM's view may show another scene now.
    this.showGmView();
  }

  private sendTo(playerId: string): void {
    const slot = this.options.projection.slotOf(playerId);
    if (!slot) return;
    this.options.session.send(playerId, { v: 1, type: 'map-templates', sceneId: slot.sceneId, templates: this.byScene.get(slot.sceneId) ?? [] });
  }

  private broadcast(sceneId: string): void {
    const templates = this.byScene.get(sceneId) ?? [];
    for (const playerId of this.options.projection.audience(sceneId)) {
      this.options.session.send(playerId, { v: 1, type: 'map-templates', sceneId, templates });
    }
    this.showGmView();
  }

  /** Draws the shown scene's templates in its view, and clears a view the GM left. */
  private showGmView(): void {
    const show = this.options.show;
    if (!show) return;
    const shown = this.options.projection.shownSlot();
    const target = shown ? { viewId: shown.tab.viewId, sceneId: shown.sceneId } : null;
    if (this.drawnIn && (this.drawnIn.viewId !== target?.viewId || this.drawnIn.sceneId !== target.sceneId)) this.clearGmView();
    if (!shown || !target) return;
    try {
      show(target.viewId, this.byScene.get(target.sceneId) ?? [], shown.mapPath);
      this.drawnIn = target;
    } catch (error) {
      console.warn('[Atlas VTT Connect] Could not show the templates:', error);
    }
  }

  private clearGmView(): void {
    const drawn = this.drawnIn;
    this.drawnIn = null;
    if (!drawn) return;
    try {
      this.options.show?.(drawn.viewId, [], '');
    } catch {
      // The view went with its templates.
    }
  }
}
