/**
 * Lasting templates in an online session, per scene (`tools/templates.ts`). A player's `map-template` adds one (at
 * most `perPlayer` of theirs and `perScene` in all) or removes one of their own, for the scene they have; the GM gives
 * it its id and its owner's colour, and sends the scene's whole list to its players whenever it changes, to a player
 * when they are admitted or move to another scene, and shows it in its own view of the scene it shows, where the GM
 * erases any one of them (`erase`). A player clears all of theirs at once (`clear`). The GM clears them all with `clear`. Templates of players who leave the session (removed, not just disconnected) go. A
 * `GmSession` handler.
 */
import type { PlayerColors } from './playerColors';
import type { ViewId } from '@atlas-vtt/api-types';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { SlotChange, SlotProjection } from '../scene/slotViews';
import { GM_LASER_ID, laserColor } from './laserColors';
import type { BoardSessionSink } from './BoardSessionHub';
import { TEMPLATE_LIMITS, type MapTemplate } from './templates';
import { askedSpell, cleanAsk, cleanSpell, splitAsks, SPELL_ASKS_PER_PLAYER, SPELL_LIMITS, type MapSpell, type Spell, type SpellAsk, type SpellRequest } from './spells';

export interface TemplateHostOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'audience' | 'shownSlot' | 'onSlotChange'>;
  /** Shows a scene's templates in the GM's view of it, with `erase` taking one off; without it the GM sees none. */
  show?: (viewId: ViewId, templates: readonly MapTemplate[], mapPath: string, erase: (id: string) => void) => void;
  /** A player's colour (their pick); their place's without it. Its changes recolour their templates and spells. */
  colors?: Pick<PlayerColors, 'colorOf' | 'onChange'>;
  /** Tabletop's 3D board on the GM's side: told whenever a scene's templates change. */
  board?: Pick<BoardSessionSink, 'templatesChanged'>;
}

/** What the GM's asks for spells need: who controls a token, and a way to tell the GM how an ask was answered. */
export interface SpellAsking {
  controls(playerId: string, tokenId: string): boolean;
  notify?(message: string): void;
}

interface PendingAsk extends SpellRequest {
  sceneId: string;
}

export class TemplateHost implements SessionHandler {
  private readonly limit = new RateLimit(TEMPLATE_LIMITS.perSecond);
  private readonly byScene = new Map<string, MapTemplate[]>();
  /** Spells cast through tokens' eyes (`spells.ts`), per scene, kept and sent like the templates. */
  private readonly spellLimit = new RateLimit(SPELL_LIMITS.perSecond);
  private readonly spellsByScene = new Map<string, MapSpell[]>();
  private nextSpell = 1;
  /** The spells the GM asks of tokens, waiting for one of each token's players to cast or turn down. */
  private readonly asks = new Map<string, PendingAsk>();
  private nextAsk = 1;
  private asking: SpellAsking | null = null;
  private readonly stops: Array<() => void> = [];
  private next = 1;
  /** The view the GM's templates were last drawn in, so a scene the GM leaves is cleared there. */
  private drawnIn: { viewId: ViewId; sceneId: string } | null = null;

  constructor(private readonly options: TemplateHostOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.options.session.use(this), this.options.projection.onSlotChange((change) => this.slotChanged(change)));
    if (this.options.colors) this.stops.push(this.options.colors.onChange((playerId) => this.recolor(playerId)));
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    this.clearGmView();
    this.byScene.clear();
    this.spellsByScene.clear();
    this.asks.clear();
  }

  /** Who controls which token, for the GM's asks; without it the GM asks nothing. */
  useAsks(asking: SpellAsking | null): void {
    this.asking = asking;
  }

  /**
   * The GM asks the players of `tokenId` (those on `sceneId`) to cast `ask` from it, in place of any ask of the token
   * waiting. The number of players asked: 0 when none of the token's players is on the scene (it waits for them).
   */
  requestSpell(sceneId: string, tokenId: string, ask: SpellAsk): number {
    const asking = this.asking;
    if (!asking) return 0;
    this.dropAsk(sceneId, tokenId);
    const id = `a${this.nextAsk++}`;
    this.asks.set(id, { id, sceneId, tokenId, ask: cleanAsk(ask) });
    this.broadcastSpells(sceneId);
    return this.options.projection.audience(sceneId).filter((playerId) => asking.controls(playerId, tokenId)).length;
  }

  /** The ask waiting for `tokenId` on `sceneId`, or null. */
  requestOf(sceneId: string, tokenId: string): SpellAsk | null {
    for (const pending of this.asks.values()) if (pending.sceneId === sceneId && pending.tokenId === tokenId) return pending.ask;
    return null;
  }

  /** The GM takes back the ask waiting for `tokenId`. */
  cancelSpellRequest(sceneId: string, tokenId: string): void {
    if (this.dropAsk(sceneId, tokenId)) this.broadcastSpells(sceneId);
  }

  private dropAsk(sceneId: string, tokenId: string): boolean {
    let dropped = false;
    for (const [id, pending] of this.asks) {
      if (pending.sceneId === sceneId && pending.tokenId === tokenId) { this.asks.delete(id); dropped = true; }
    }
    return dropped;
  }

  /** The asks waiting on `sceneId` for the tokens `playerId` controls. */
  private asksFor(playerId: string, sceneId: string): SpellRequest[] {
    const asking = this.asking;
    if (!asking) return [];
    const list: SpellRequest[] = [];
    for (const pending of this.asks.values()) {
      if (pending.sceneId !== sceneId || !asking.controls(playerId, pending.tokenId)) continue;
      list.push({ id: pending.id, tokenId: pending.tokenId, ask: pending.ask });
      if (list.length >= SPELL_ASKS_PER_PLAYER) break;
    }
    return list;
  }

  /** The GM takes every template and spell off every scene. */
  clear(): void {
    const scenes = [...this.byScene.keys()];
    const spelled = [...this.spellsByScene.keys()];
    this.byScene.clear();
    this.spellsByScene.clear();
    for (const sceneId of scenes) this.broadcast(sceneId);
    for (const sceneId of spelled) this.broadcastSpells(sceneId);
  }

  /** A scene's spells as its players have them. */
  spellsFor(sceneId: string): readonly MapSpell[] {
    return this.spellsByScene.get(sceneId) ?? [];
  }

  /** The GM takes one spell off a scene, whoever cast it. */
  eraseSpell(sceneId: string, id: string): void {
    const list = this.spellsByScene.get(sceneId);
    const kept = list?.filter((spell) => spell.id !== id);
    if (!list || !kept || kept.length === list.length) return;
    this.spellsByScene.set(sceneId, kept);
    this.broadcastSpells(sceneId);
  }

  /** The GM takes every spell off one scene. */
  clearSpells(sceneId: string): void {
    if (!this.spellsByScene.has(sceneId)) return;
    this.spellsByScene.delete(sceneId);
    this.broadcastSpells(sceneId);
  }

  /** A scene's templates as its players have them. */
  listFor(sceneId: string): readonly MapTemplate[] {
    return this.byScene.get(sceneId) ?? [];
  }

  /** The GM places a template on a scene (from the 3D board), in the GM's colour; false over the scene's limit. */
  addGm(sceneId: string, add: Pick<MapTemplate, 'shape' | 'start' | 'end'>): boolean {
    const list = this.byScene.get(sceneId) ?? [];
    if (list.length >= TEMPLATE_LIMITS.perScene) return false;
    const order = this.options.session.getPlayers().map((each) => each.playerId);
    list.push({ id: `t${this.next++}`, owner: GM_LASER_ID, shape: add.shape, start: { x: add.start.x, y: add.start.y }, end: { x: add.end.x, y: add.end.y }, color: laserColor(GM_LASER_ID, order) });
    this.byScene.set(sceneId, list);
    this.broadcast(sceneId);
    return true;
  }

  /** The GM casts a spell on a scene (through a token's eyes on Tabletop's board), in the GM's colour; false over the limit. */
  castGm(sceneId: string, spell: Spell): boolean {
    const list = this.spellsByScene.get(sceneId) ?? [];
    if (list.length >= SPELL_LIMITS.perScene) return false;
    const order = this.options.session.getPlayers().map((each) => each.playerId);
    list.push({ id: `s${this.nextSpell++}`, owner: GM_LASER_ID, color: laserColor(GM_LASER_ID, order), spell: cleanSpell(spell) });
    this.spellsByScene.set(sceneId, list);
    this.broadcastSpells(sceneId);
    return true;
  }

  /** The GM takes every template off one scene. */
  clearScene(sceneId: string): void {
    if (!this.byScene.has(sceneId)) return;
    this.byScene.delete(sceneId);
    this.broadcast(sceneId);
  }

  /** The GM takes one template off a scene, whoever placed it. */
  erase(sceneId: string, id: string): void {
    const list = this.byScene.get(sceneId);
    const kept = list?.filter((template) => template.id !== id);
    if (!list || !kept || kept.length === list.length) return;
    this.byScene.set(sceneId, kept);
    this.broadcast(sceneId);
  }

  /** Whether any scene has a template or a spell: what the GM's clear command offers. */
  hasAny(): boolean {
    return [...this.byScene.values(), ...this.spellsByScene.values()].some((list) => list.length > 0);
  }

  onAdmitted(player: SessionPlayer): void {
    this.sendTo(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'map-spell') { this.spellMessage(player, message); return; }
    if (message.type !== 'map-template') return;
    const slot = this.options.projection.slotOf(player.playerId);
    if (!slot?.lastSent || message.sceneId !== slot.sceneId || !this.limit.allow(player.playerId, Date.now())) return;
    const list = this.byScene.get(slot.sceneId) ?? [];
    if (message.remove !== undefined || message.clear === true) {
      const kept = list.filter((template) => !(template.owner === player.playerId && (message.clear === true || template.id === message.remove)));
      if (kept.length === list.length) return;
      this.byScene.set(slot.sceneId, kept);
    } else if (message.add) {
      const own = list.filter((template) => template.owner === player.playerId).length;
      if (own >= TEMPLATE_LIMITS.perPlayer || list.length >= TEMPLATE_LIMITS.perScene) return;
      const order = this.options.session.getPlayers().map((each) => each.playerId);
      const { shape, start, end } = message.add;
      list.push({ id: `t${this.next++}`, owner: player.playerId, shape, start: { x: start.x, y: start.y }, end: { x: end.x, y: end.y }, color: this.colorOf(player.playerId, order) });
      this.byScene.set(slot.sceneId, list);
    } else return;
    this.broadcast(slot.sceneId);
  }

  /** A player's spell: cast (at most `perPlayer` of theirs, `perScene` in all), one of theirs taken off, or theirs cleared. */
  private spellMessage(player: SessionPlayer, message: Extract<ControlMessage, { type: 'map-spell' }>): void {
    const slot = this.options.projection.slotOf(player.playerId);
    // An answer to an ask can land only once, so it is not held to the rate.
    const answer = message.request !== undefined || message.decline !== undefined;
    if (!slot?.lastSent || message.sceneId !== slot.sceneId || (!answer && !this.spellLimit.allow(player.playerId, Date.now()))) return;
    const list = this.spellsByScene.get(slot.sceneId) ?? [];
    const asked = message.request ?? message.decline;
    const pending = asked !== undefined ? this.asks.get(asked) : undefined;
    // An answer to an ask: only to one waiting on this scene, for a token the player controls.
    if (asked !== undefined && (!pending || pending.sceneId !== slot.sceneId || !this.asking?.controls(player.playerId, pending.tokenId))) return;
    const what = pending?.ask.name ?? 'the spell asked';
    if (pending && message.decline !== undefined) {
      this.asks.delete(pending.id);
      this.asking?.notify?.(`${player.name} turned down ${what}.`);
      this.broadcastSpells(slot.sceneId);
      return;
    }
    if (pending && message.add) {
      if (list.length >= SPELL_LIMITS.perScene) return;
      const order = this.options.session.getPlayers().map((each) => each.playerId);
      // Cast as the GM asked it, whatever the player's board sent.
      list.push({ id: `s${this.nextSpell++}`, owner: player.playerId, color: this.colorOf(player.playerId, order), spell: askedSpell({ ...message.add, caster: pending.tokenId }, pending.ask) });
      this.spellsByScene.set(slot.sceneId, list);
      this.asks.delete(pending.id);
      this.asking?.notify?.(`${player.name} cast ${what}.`);
      this.broadcastSpells(slot.sceneId);
      return;
    }
    if (message.remove !== undefined || message.clear === true) {
      const kept = list.filter((spell) => !(spell.owner === player.playerId && (message.clear === true || spell.id === message.remove)));
      if (kept.length === list.length) return;
      this.spellsByScene.set(slot.sceneId, kept);
    } else if (message.add) {
      const own = list.filter((spell) => spell.owner === player.playerId).length;
      if (own >= SPELL_LIMITS.perPlayer || list.length >= SPELL_LIMITS.perScene) return;
      const order = this.options.session.getPlayers().map((each) => each.playerId);
      list.push({ id: `s${this.nextSpell++}`, owner: player.playerId, color: this.colorOf(player.playerId, order), spell: cleanSpell(message.add) });
      this.spellsByScene.set(slot.sceneId, list);
    } else return;
    this.broadcastSpells(slot.sceneId);
  }

  private colorOf(playerId: string, order: readonly string[]): string {
    return this.options.colors?.colorOf(playerId, order) ?? laserColor(playerId, order);
  }

  /** A player picked another colour: their templates and spells take it. */
  private recolor(playerId: string): void {
    const color = this.colorOf(playerId, this.options.session.getPlayers().map((each) => each.playerId));
    for (const [sceneId, list] of this.byScene) {
      if (!list.some((template) => template.owner === playerId && template.color !== color)) continue;
      this.byScene.set(sceneId, list.map((template) => (template.owner === playerId ? { ...template, color } : template)));
      this.broadcast(sceneId);
    }
    for (const [sceneId, list] of this.spellsByScene) {
      if (!list.some((spell) => spell.owner === playerId && spell.color !== color)) continue;
      this.spellsByScene.set(sceneId, list.map((spell) => (spell.owner === playerId ? { ...spell, color } : spell)));
      this.broadcastSpells(sceneId);
    }
  }

  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    this.spellLimit.retain(known);
    for (const [sceneId, list] of this.spellsByScene) {
      const kept = list.filter((spell) => spell.owner === GM_LASER_ID || known.has(spell.owner));
      if (kept.length === list.length) continue;
      this.spellsByScene.set(sceneId, kept);
      this.broadcastSpells(sceneId);
    }
    for (const [sceneId, list] of this.byScene) {
      const kept = list.filter((template) => template.owner === GM_LASER_ID || known.has(template.owner));
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
    this.sendSpells(playerId, slot.sceneId);
  }

  private broadcastSpells(sceneId: string): void {
    for (const playerId of this.options.projection.audience(sceneId)) this.sendSpells(playerId, sceneId);
    this.options.board?.templatesChanged();
  }

  /** A scene's spells to one of its players, with what the GM asks of their tokens there. */
  private sendSpells(playerId: string, sceneId: string): void {
    const { asks, words } = splitAsks(this.asksFor(playerId, sceneId));
    this.options.session.send(playerId, { v: 1, type: 'map-spells', sceneId, spells: this.spellsByScene.get(sceneId) ?? [], ...(asks.length > 0 ? { asks } : {}), ...(words.length > 0 ? { askWords: words } : {}) });
  }

  private broadcast(sceneId: string): void {
    const templates = this.byScene.get(sceneId) ?? [];
    for (const playerId of this.options.projection.audience(sceneId)) {
      this.options.session.send(playerId, { v: 1, type: 'map-templates', sceneId, templates });
    }
    this.showGmView();
    this.options.board?.templatesChanged();
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
      const { sceneId } = target;
      show(target.viewId, this.byScene.get(sceneId) ?? [], shown.mapPath, (id) => this.erase(sceneId, id));
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
      this.options.show?.(drawn.viewId, [], '', () => undefined);
    } catch {
      // The view went with its templates.
    }
  }
}
