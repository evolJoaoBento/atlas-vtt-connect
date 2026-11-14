/**
 * Players' templates and spells in an online session. Atlas's kept measures (`objects.measures`) are the only place
 * they live: a player's `map-template` or `map-spell` is a request, and the GM writes it into Atlas's own store
 * (`StockMeasures`), with the player as its maker (`by`, and their id as its owner). Players then get it as every
 * measure of the scene reaches them: in the scene itself (`projectMeasures`). Nothing is kept here.
 *
 * - A template is temporary and one per player: a new one takes the place of the last, and it goes when its player
 *   leaves, or in a sweep when a session starts (one left in the map by a crash).
 * - A kept spell stays in the map until its caster or the GM removes it: at most `perPlayer` of a player's and
 *   `perScene` in all on a map, and no more than Atlas keeps on a level.
 * - An instantaneous spell (its words say so) is kept nowhere: it is flashed to the scene's players and the GM's board.
 * - Atlas holds one map at a time: a request for a map it does not hold is refused, and the player is told.
 * - The GM's asks of tokens (`requestSpell`) wait here until a player casts or turns them down; they go to the
 *   token's players in `spell-asks`.
 *
 * A `GmSession` handler.
 */
import { measureKind, MEASURE_LIMITS, readExtra, spellToMeasure, templateToMeasure } from '../../../../packages/atlas-host/src/spellMeasure';
import type { KeptRecord, StockMeasures } from '../../../connect/stockMeasures';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage, MeasureRefusal } from '../protocol';
import { RateLimit } from '../rateLimit';
import type { SceneSession } from '../scene/sceneSources';
import type { SlotChange, SlotProjection, SlotView } from '../scene/slotViews';
import { GM_LASER_ID, laserColor } from './laserColors';
import type { PlayerColors } from './playerColors';
import {
  askedSpell, cleanAsk, cleanRules, cleanSpell, cutCastWords, isInstantaneous, isSpellRules, splitAsks, SPELL_ASKS_PER_PLAYER, SPELL_LIMITS,
  type MapSpell, type Spell, type SpellAbout, type SpellAsk, type SpellRequest, type SpellRules,
} from './spells';
import { TEMPLATE_LIMITS } from './templates';

export interface MeasureHostOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'audience' | 'shownSlot' | 'onSlotChange'>;
  /** Atlas's measures, written through its own store; without it (an Atlas that has none) every request is refused. */
  measures: StockMeasures | null;
  /** A player's colour (their pick); their place's without it. Its changes recolour their measures. */
  colors?: Pick<PlayerColors, 'colorOf' | 'onChange'>;
  /** Tabletop's 3D board on the GM's side: shown an instantaneous cast, and told when the asks change. */
  board?: { flash(mapPath: string, cast: MapSpell): void; templatesChanged(): void };
  /** While a cutscene runs, players add no template or spell (removing their own still works). */
  cutscene?: { running(): boolean };
}

/** What the GM's asks for spells need: who controls a token, and a way to tell the GM how an ask was answered. */
export interface SpellAsking {
  controls(playerId: string, tokenId: string): boolean;
  notify?(message: string): void;
}

interface PendingAsk extends SpellRequest {
  sceneId: string;
}

/** A cast's words as they arrive: a name, and the spell's words where it has them. */
type Words = { name: string; about?: SpellAbout } | undefined;

export class MeasureHost implements SessionHandler {
  private readonly limit = new RateLimit(TEMPLATE_LIMITS.perSecond);
  private readonly spellLimit = new RateLimit(SPELL_LIMITS.perSecond);
  /** The spells the GM asks of tokens, waiting for one of each token's players to cast or turn down. */
  private readonly asks = new Map<string, PendingAsk>();
  private nextAsk = 1;
  private nextFlash = 1;
  private asking: SpellAsking | null = null;
  private readonly stops: Array<() => void> = [];

  constructor(private readonly options: MeasureHostOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.options.session.use(this), this.options.projection.onSlotChange((change) => this.slotChanged(change)));
    if (this.options.colors) this.stops.push(this.options.colors.onChange((playerId) => this.recolor(playerId)));
    this.sweepTemporary();
  }

  stop(): void {
    // The session ends: its players' templates go with it. Kept spells stay in the map, as Atlas's measures do.
    this.sweepTemporary(new Set());
    this.stops.splice(0).forEach((stop) => stop());
    this.asks.clear();
  }

  /** Who controls which token, for the GM's asks; without it the GM asks nothing. */
  useAsks(asking: SpellAsking | null): void {
    this.asking = asking;
  }

  // ── The GM's asks ─────────────────────────────────────────────────────────

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
    this.broadcastAsks(sceneId);
    return this.options.projection.audience(sceneId).filter((playerId) => asking.controls(playerId, tokenId)).length;
  }

  /** The ask waiting for `tokenId` on `sceneId`, or null. */
  requestOf(sceneId: string, tokenId: string): SpellAsk | null {
    for (const pending of this.asks.values()) if (pending.sceneId === sceneId && pending.tokenId === tokenId) return pending.ask;
    return null;
  }

  /** The GM takes back the ask waiting for `tokenId`. */
  cancelSpellRequest(sceneId: string, tokenId: string): void {
    if (this.dropAsk(sceneId, tokenId)) this.broadcastAsks(sceneId);
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

  private broadcastAsks(sceneId: string): void {
    for (const playerId of this.options.projection.audience(sceneId)) this.sendAsks(playerId, sceneId);
    this.options.board?.templatesChanged();
  }

  private sendAsks(playerId: string, sceneId: string): void {
    const { asks, words, rules } = splitAsks(this.asksFor(playerId, sceneId));
    this.options.session.send(playerId, { v: 1, type: 'spell-asks', sceneId, asks, ...(words.length > 0 ? { askWords: words } : {}), ...(rules.length > 0 ? { askRules: rules } : {}) });
  }

  // ── The GM's own ──────────────────────────────────────────────────────────

  /** The GM's instantaneous cast (from Tabletop's board): shown to the scene's players, kept nowhere. */
  flashGm(sceneId: string, spell: Spell, rules?: SpellRules, words?: { name?: unknown; about?: unknown }): void {
    const order = this.options.session.getPlayers().map((each) => each.playerId);
    this.flash(sceneId, { id: `f${this.nextFlash++}`, owner: GM_LASER_ID, color: laserColor(GM_LASER_ID, order), spell: cleanSpell(spell), ...(rules && isSpellRules(rules) ? { rules: cleanRules(rules) } : {}), ...cutCastWords(words) }, false);
  }

  /** Every template and spell of the map Atlas shows the players goes (the GM's Clear templates), in one undo step of Atlas's. */
  clear(): void {
    const shown = this.options.projection.shownSlot();
    if (!shown) return;
    this.options.measures?.write(shown.tab.viewId, shown.mapPath, (store) => {
      for (const measure of store.list()) if (measureKind(measure) !== 'area') store.remove(measure.id);
    });
  }

  /** Whether the map Atlas shows the players has a template or a spell: what the GM's clear command offers. */
  hasAny(): boolean {
    const shown = this.options.projection.shownSlot();
    const list = shown ? this.options.measures?.list(shown.tab.viewId, shown.mapPath) : null;
    return list?.some((measure) => measureKind(measure) !== 'area') ?? false;
  }

  // ── Players' requests ─────────────────────────────────────────────────────

  onAdmitted(player: SessionPlayer): void {
    this.sendTo(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'map-spell') { this.spellMessage(player, message); return; }
    if (message.type !== 'map-template') return;
    if (message.add && this.options.cutscene?.running()) return;
    const slot = this.options.projection.slotOf(player.playerId);
    if (!slot?.lastSent || message.sceneId !== slot.sceneId || !this.limit.allow(player.playerId, Date.now())) return;
    const own = (measure: KeptRecord): boolean => measureKind(measure) === 'template' && readExtra(measure)?.owner === player.playerId;
    if (message.remove !== undefined || message.clear === true) {
      this.write(player, slot, 'template', (store) => {
        for (const measure of store.list()) if (own(measure) && (message.clear === true || measure.id === message.remove)) store.remove(measure.id);
        return true;
      });
    } else if (message.add) {
      const { shape, start, end } = message.add;
      const record = templateToMeasure({ shape, start, end }, { owner: player.playerId, by: player.name.slice(0, MEASURE_LIMITS.by), color: this.colorOf(player.playerId) });
      this.write(player, slot, 'template', (store) => {
        // One template per player: the new one takes the place of the last.
        for (const measure of store.list()) if (own(measure)) store.remove(measure.id);
        return store.add(record) !== null ? true : 'full';
      });
    }
  }

  /** A player's spell: cast (kept, or flashed when instantaneous), one of theirs taken off, theirs cleared, or an ask turned down. */
  private spellMessage(player: SessionPlayer, message: Extract<ControlMessage, { type: 'map-spell' }>): void {
    if (message.add && this.options.cutscene?.running()) return;
    const slot = this.options.projection.slotOf(player.playerId);
    // An answer to an ask can land only once, so it is not held to the rate.
    const answer = message.request !== undefined || message.decline !== undefined;
    if (!slot?.lastSent || message.sceneId !== slot.sceneId || (!answer && !this.spellLimit.allow(player.playerId, Date.now()))) return;
    const asked = message.request ?? message.decline;
    const pending = asked !== undefined ? this.asks.get(asked) : undefined;
    // An answer to an ask: only to one waiting on this scene, for a token the player controls.
    if (asked !== undefined && (!pending || pending.sceneId !== slot.sceneId || !this.asking?.controls(player.playerId, pending.tokenId))) return;
    const what = pending?.ask.name ?? 'the spell asked';
    if (pending && message.decline !== undefined) {
      this.asks.delete(pending.id);
      this.asking?.notify?.(`${player.name} turned down ${what}.`);
      this.broadcastAsks(slot.sceneId);
      return;
    }
    const mine = (measure: KeptRecord): boolean => measureKind(measure) === 'spell' && readExtra(measure)?.owner === player.playerId;
    if (message.remove !== undefined || message.clear === true) {
      this.write(player, slot, 'spell', (store) => {
        for (const measure of store.list()) if (mine(measure) && (message.clear === true || measure.id === message.remove)) store.remove(measure.id);
        return true;
      });
      return;
    }
    if (!message.add) return;
    // Cast as the GM asked it, whatever the player's board sent; its rules and words the ask's, else the player's.
    const spell = pending ? askedSpell({ ...message.add, caster: pending.tokenId }, pending.ask) : cleanSpell(message.add);
    const rules = pending?.ask.rules ?? message.rules;
    const words: Words = pending?.ask.name ? { name: pending.ask.name, ...(pending.ask.about ? { about: pending.ask.about } : {}) } : message.name ? { name: message.name, ...(message.about ? { about: message.about } : {}) } : undefined;
    const color = this.colorOf(player.playerId);
    const done = (): void => {
      if (!pending) return;
      this.asks.delete(pending.id);
      this.asking?.notify?.(`${player.name} cast ${what}.`);
      this.broadcastAsks(slot.sceneId);
    };
    // A summoning spell is kept though instantaneous (Find Familiar): its going is what offers to take its summons off.
    if (isInstantaneous(words?.about) && !rules?.summon) {
      this.flash(slot.sceneId, { id: `f${this.nextFlash++}`, owner: player.playerId, color, spell, ...(rules ? { rules: cleanRules(rules) } : {}), ...cutCastWords(words) }, true);
      done();
      return;
    }
    const record = spellToMeasure(spell, { owner: player.playerId, by: player.name.slice(0, MEASURE_LIMITS.by), color, ...(rules ? { rules: cleanRules(rules) } : {}), ...cutCastWords(words) });
    const kept = this.write(player, slot, 'spell', (store) => {
      const spells = store.list().filter((measure) => measureKind(measure) === 'spell');
      // An answer to the GM's ask is the GM's cast: only the scene's limit holds it back.
      if (spells.length >= MEASURE_LIMITS.perScene || (!pending && spells.filter(mine).length >= MEASURE_LIMITS.perPlayer)) return 'limit';
      return store.add(record) !== null ? true : 'full';
    });
    if (kept) done();
  }

  /**
   * Runs a player's write on the map of their slot, as one undo step of Atlas's; true when it was made. Otherwise the
   * player is told why: Atlas does not hold their map, they have as many as they may, or the level holds no more.
   */
  private write(player: SessionPlayer, slot: SlotView, what: 'template' | 'spell', fn: (store: Parameters<Parameters<StockMeasures['write']>[2]>[0]) => true | MeasureRefusal): boolean {
    const result = this.options.measures ? this.options.measures.write(slot.tab.viewId, slot.mapPath, fn) : 'not-held';
    if (result === true) return true;
    this.options.session.send(player.playerId, { v: 1, type: 'map-refused', what, reason: result });
    return false;
  }

  private flash(sceneId: string, cast: MapSpell, toBoard: boolean): void {
    for (const playerId of this.options.projection.audience(sceneId)) this.options.session.send(playerId, { v: 1, type: 'spell-flash', sceneId, cast });
    const shown = this.options.projection.shownSlot();
    if (toBoard && shown?.sceneId === sceneId) this.options.board?.flash(shown.mapPath, cast);
  }

  private colorOf(playerId: string): string {
    const order = this.options.session.getPlayers().map((each) => each.playerId);
    return this.options.colors?.colorOf(playerId, order) ?? laserColor(playerId, order);
  }

  /** A player picked another colour: their templates and spells on the map Atlas shows take it. */
  private recolor(playerId: string): void {
    const shown = this.options.projection.shownSlot();
    if (!shown || !this.options.measures) return;
    const color = this.colorOf(playerId);
    const theirs = this.options.measures.list(shown.tab.viewId, shown.mapPath)?.filter((measure) => readExtra(measure)?.owner === playerId && measure.color !== color) ?? [];
    if (theirs.length === 0) return;
    this.options.measures.write(shown.tab.viewId, shown.mapPath, (store) => { for (const measure of theirs) store.update(measure.id, { color }); });
  }

  playersChanged(players: readonly SessionPlayer[]): void {
    const known = new Set(players.map((player) => player.playerId));
    this.limit.retain(known);
    this.spellLimit.retain(known);
    this.sweepTemporary(known);
  }

  /**
   * Takes the temporary measures (players' templates) of everyone not in `present` off the map Atlas shows: a player
   * who left, or one from a session that ended without its sweep. Kept spells stay.
   */
  private sweepTemporary(present: ReadonlySet<string> = new Set(this.options.session.getPlayers().map((player) => player.playerId))): void {
    const shown = this.options.projection.shownSlot();
    if (!shown || !this.options.measures) return;
    const stale = this.options.measures.list(shown.tab.viewId, shown.mapPath)?.filter((measure) => {
      const extra = readExtra(measure);
      return extra?.temp === true && !(extra.owner !== undefined && present.has(extra.owner));
    }) ?? [];
    if (stale.length === 0) return;
    this.options.measures.write(shown.tab.viewId, shown.mapPath, (store) => { for (const measure of stale) store.remove(measure.id); });
  }

  private slotChanged(change: SlotChange): void {
    if (change.kind === 'moved') this.sendTo(change.playerId);
    // The GM's view may hold another map now: the templates a session left there go.
    else if (change.kind === 'state') this.sweepTemporary();
  }

  private sendTo(playerId: string): void {
    const slot = this.options.projection.slotOf(playerId);
    if (slot) this.sendAsks(playerId, slot.sceneId);
  }
}
