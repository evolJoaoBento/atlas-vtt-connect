/**
 * The online session as Tabletop's 3D board on the GM's side shows it (`BoardSession`, handed to Tabletop's
 * `api.attachSession`): whether the GM is hosting, the presented map, each map's lasting templates (with the cone
 * angle they open by) and the handout shown, and the pings and lasers players send, as marks of their map. The GM
 * places templates from the board and erases any of them; every player of that scene hears of it as from Connect's own
 * view. The relays hand it what they accept (`PingRelay`, `LaserRelay`, `TemplateHost`), so the board shows exactly what
 * players see.
 */
import type { TokenControl } from '../control/TokenControl';
import type { SessionPlayer } from '../GmSession';
import type { HandoutSource } from '../handouts';
import type { SlotChange, SlotProjection } from '../scene/slotViews';
import type { TemplateHost } from './TemplateHost';
import type { MapTemplate, TemplateShape } from './templates';
import { isSpell, isSpellAsk, type MapSpell, type Spell, type SpellAsk } from './spells';
import type { ArPose } from './arViews';
import type { ArSurvey } from './arTable';

type Point = { x: number; y: number };

export type BoardMark =
  | { kind: 'ping'; mapPath: string; x: number; y: number; color: string }
  | { kind: 'laser'; mapPath: string; from: string; points: Point[]; lifted: boolean; color: string };

/**
 * A player's phone in augmented reality over a map, for the GM's board (an eye where its camera is): its pose in board
 * units, null when they left AR or lost the tracking. `from` is their session id.
 */
export interface BoardViewer {
  mapPath: string;
  from: string;
  name: string;
  color: string;
  pose: ArPose | null;
}

/** A player's survey of the table's marker sheets, for the GM to place on `mapPath` (Tabletop asks first). */
export interface BoardSurvey {
  mapPath: string;
  from: string;
  name: string;
  survey: ArSurvey;
}

export interface BoardOverlay {
  templates: readonly MapTemplate[];
  /** Spells players cast through their tokens' eyes on the map's scene (`spells.ts`). */
  spells: readonly MapSpell[];
  /** Radians a cone opens by on this map. */
  coneAngle: number;
  handout: { path: string; title: string } | null;
}

/** What Tabletop reads of the session (its `connectContract.ts` keeps the same shape). */
export interface BoardSession {
  hosting(): boolean;
  presentedMap(): string | null;
  overlay(mapPath: string): BoardOverlay;
  onChange(listener: () => void): () => void;
  onMark(listener: (mark: BoardMark) => void): () => void;
  /** Players' phones in augmented reality, as they move (a Tabletop that draws them listens). */
  onViewer(listener: (viewer: BoardViewer) => void): () => void;
  /** Players' surveys of the table's marker sheets (a Tabletop that places them listens). */
  onSurvey(listener: (survey: BoardSurvey) => void): () => void;
  addTemplate(mapPath: string, add: { shape: TemplateShape; start: Point; end: Point }): boolean;
  eraseTemplate(mapPath: string, id: string): void;
  clearTemplates(mapPath: string): void;
  /**
   * Asks the players of `tokenId` to cast `ask` from it (they aim it; the rest is the GM's). The number of its players
   * on the map's scene now; null when no session hands out tokens. Absent from an older Connect.
   */
  requestSpell?(mapPath: string, tokenId: string, ask: SpellAsk): number | null;
  /** The ask waiting for `tokenId` on the map's scene, or null. */
  spellRequest?(mapPath: string, tokenId: string): SpellAsk | null;
  cancelSpellRequest?(mapPath: string, tokenId: string): void;
  /** The GM casts a spell on the map's scene (through a token's eyes), in the GM's colour; false when it cannot. */
  castSpell?(mapPath: string, spell: Spell): boolean;
  /** Takes a player's spell off the map's scene, or all of them. */
  eraseSpell(mapPath: string, id: string): void;
  clearSpells(mapPath: string): void;
  /**
   * Tabletop moves tokens from the map `from` to the stacked map `to` (each to `newId`, the same id unless `to` had
   * one): told before it moves them. Their players keep them, and are shown `to`.
   */
  tokensMoved?(move: TokensMoved): void;
  /**
   * The players who may control `tokenId` (every admitted one) and whether each does, for the "Controlled by" menu;
   * null while no session hands out tokens. Absent from an older Connect.
   */
  controllers?(tokenId: string): Array<{ playerId: string; name: string; controls: boolean }> | null;
  /** Gives `tokenId` to a player or takes it away. */
  setController?(tokenId: string, playerId: string, controls: boolean): void;
}

export interface TokensMoved {
  from: string;
  to: string;
  tokens: ReadonlyArray<{ id: string; newId: string }>;
}

/** A move as Tabletop must send it: two map paths and the tokens, each with a string id and new id. */
function isMove(value: unknown): value is TokensMoved {
  const move = value as Partial<TokensMoved> | null;
  return typeof move === 'object' && move !== null && typeof move.from === 'string' && typeof move.to === 'string' && Array.isArray(move.tokens)
    && move.tokens.length <= 200 && (move.tokens as unknown[]).every((token) => {
      const entry = token as { id?: unknown; newId?: unknown } | null;
      return typeof entry === 'object' && entry !== null && typeof entry.id === 'string' && typeof entry.newId === 'string';
    });
}

/** What relays tell the board. */
export interface BoardSessionSink {
  templatesChanged(): void;
  ping(mapPath: string, x: number, y: number, color: string): void;
  laser(mapPath: string, from: string, points: readonly Point[], lifted: boolean, color: string): void;
  viewer(mapPath: string, from: string, name: string, color: string, pose: ArPose | null): void;
  survey(mapPath: string, from: string, name: string, survey: ArSurvey): void;
}

export interface BoardSessionHubOptions {
  projection: Pick<SlotProjection, 'shownSlot' | 'onSlotChange'>;
  handouts: HandoutSource;
  /** The cone angle of the map's collection, in degrees. */
  coneAngle(mapPath: string): number;
}

export class BoardSessionHub implements BoardSession, BoardSessionSink {
  private readonly changes = new Set<() => void>();
  private readonly marks = new Set<(mark: BoardMark) => void>();
  private readonly viewers = new Set<(viewer: BoardViewer) => void>();
  private readonly surveys = new Set<(survey: BoardSurvey) => void>();
  private readonly stops: Array<() => void> = [];
  /** The scene in use of each map, as the hub last told of it. */
  private readonly scenes = new Map<string, string>();
  private templates: TemplateHost | null = null;
  private moves: ((move: TokensMoved) => void) | null = null;
  private control: { control: TokenControl; players: () => readonly SessionPlayer[] } | null = null;
  private started = false;

  constructor(private readonly options: BoardSessionHubOptions) {}

  useTemplates(templates: TemplateHost | null): void {
    this.templates = templates;
  }

  /** Who controls which token (the session's `TokenControl`) and the session's players, for the "Controlled by" menu. */
  useControl(source: { control: TokenControl; players: () => readonly SessionPlayer[] } | null): void {
    this.control = source;
  }

  controllers(tokenId: string): Array<{ playerId: string; name: string; controls: boolean }> | null {
    const source = this.control;
    if (!this.started || !source || typeof tokenId !== 'string') return null;
    return source.players().filter((player) => player.status === 'admitted')
      .map((player) => ({ playerId: player.playerId, name: player.name, controls: source.control.controls(player.playerId, tokenId) }));
  }

  setController(tokenId: string, playerId: string, controls: boolean): void {
    const source = this.control;
    if (!this.started || !source || typeof tokenId !== 'string' || typeof playerId !== 'string') return;
    if (!source.players().some((player) => player.playerId === playerId && player.status === 'admitted')) return;
    source.control.set(tokenId, playerId, controls === true);
  }

  /** What hears of tokens Tabletop moves to another scene. */
  useMoves(moves: ((move: TokensMoved) => void) | null): void {
    this.moves = moves;
  }

  tokensMoved(move: TokensMoved): void {
    if (!this.started || !this.moves || !isMove(move)) return;
    this.moves(move);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stops.push(
      this.options.projection.onSlotChange((change) => this.slotChanged(change)),
      this.options.handouts.subscribe(() => this.emit()),
    );
    this.emit();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.stops.splice(0).forEach((stop) => stop());
    this.scenes.clear();
    this.emit();
  }

  hosting(): boolean {
    return this.started;
  }

  presentedMap(): string | null {
    return this.started ? this.options.projection.shownSlot()?.mapPath ?? null : null;
  }

  overlay(mapPath: string): BoardOverlay {
    const sceneId = this.sceneOf(mapPath);
    return {
      templates: sceneId && this.templates ? this.templates.listFor(sceneId) : [],
      spells: sceneId && this.templates ? this.templates.spellsFor(sceneId) : [],
      coneAngle: (this.options.coneAngle(mapPath) * Math.PI) / 180,
      handout: this.started ? this.options.handouts.current() : null,
    };
  }

  onChange(listener: () => void): () => void {
    this.changes.add(listener);
    return () => { this.changes.delete(listener); };
  }

  onMark(listener: (mark: BoardMark) => void): () => void {
    this.marks.add(listener);
    return () => { this.marks.delete(listener); };
  }

  onViewer(listener: (viewer: BoardViewer) => void): () => void {
    this.viewers.add(listener);
    return () => { this.viewers.delete(listener); };
  }

  onSurvey(listener: (survey: BoardSurvey) => void): () => void {
    this.surveys.add(listener);
    return () => { this.surveys.delete(listener); };
  }

  addTemplate(mapPath: string, add: { shape: TemplateShape; start: Point; end: Point }): boolean {
    const sceneId = this.sceneOf(mapPath);
    return sceneId !== null && this.templates !== null && this.templates.addGm(sceneId, add);
  }

  eraseTemplate(mapPath: string, id: string): void {
    const sceneId = this.sceneOf(mapPath);
    if (sceneId) this.templates?.erase(sceneId, id);
  }

  clearTemplates(mapPath: string): void {
    const sceneId = this.sceneOf(mapPath);
    if (sceneId) this.templates?.clearScene(sceneId);
  }

  eraseSpell(mapPath: string, id: string): void {
    const sceneId = this.sceneOf(mapPath);
    if (sceneId) this.templates?.eraseSpell(sceneId, id);
  }

  clearSpells(mapPath: string): void {
    const sceneId = this.sceneOf(mapPath);
    if (sceneId) this.templates?.clearSpells(sceneId);
  }

  castSpell(mapPath: string, spell: Spell): boolean {
    const sceneId = this.sceneOf(mapPath);
    if (!sceneId || !this.templates || !isSpell(spell)) return false;
    return this.templates.castGm(sceneId, spell);
  }

  requestSpell(mapPath: string, tokenId: string, ask: SpellAsk): number | null {
    const sceneId = this.sceneOf(mapPath);
    if (!sceneId || !this.templates || !this.control || typeof tokenId !== 'string' || !isSpellAsk(ask)) return null;
    return this.templates.requestSpell(sceneId, tokenId, ask);
  }

  spellRequest(mapPath: string, tokenId: string): SpellAsk | null {
    const sceneId = this.sceneOf(mapPath);
    return sceneId && this.templates ? this.templates.requestOf(sceneId, tokenId) : null;
  }

  cancelSpellRequest(mapPath: string, tokenId: string): void {
    const sceneId = this.sceneOf(mapPath);
    if (sceneId) this.templates?.cancelSpellRequest(sceneId, tokenId);
  }

  templatesChanged(): void {
    this.emit();
  }

  ping(mapPath: string, x: number, y: number, color: string): void {
    this.mark({ kind: 'ping', mapPath, x, y, color });
  }

  laser(mapPath: string, from: string, points: readonly Point[], lifted: boolean, color: string): void {
    this.mark({ kind: 'laser', mapPath, from, points: points.map(({ x, y }) => ({ x, y })), lifted, color });
  }

  viewer(mapPath: string, from: string, name: string, color: string, pose: ArPose | null): void {
    if (!this.started) return;
    const viewer: BoardViewer = {
      mapPath, from, name, color,
      pose: pose ? { position: [...pose.position], quaternion: [...pose.quaternion] } : null,
    };
    for (const listener of [...this.viewers]) {
      try {
        listener(viewer);
      } catch (error) {
        console.error('[Atlas VTT Connect] The board could not show a player in AR:', error);
      }
    }
  }

  survey(mapPath: string, from: string, name: string, survey: ArSurvey): void {
    if (!this.started) return;
    const heard: BoardSurvey = {
      mapPath, from, name,
      survey: { squareMm: survey.squareMm, groups: survey.groups.map(({ group, x, y, heading, w, h }) => ({ group, x, y, heading, w, h })) },
    };
    for (const listener of [...this.surveys]) {
      try {
        listener(heard);
      } catch (error) {
        console.error('[Atlas VTT Connect] The board could not take a table survey:', error);
      }
    }
  }

  private sceneOf(mapPath: string): string | null {
    if (!this.started) return null;
    const shown = this.options.projection.shownSlot();
    if (shown?.mapPath === mapPath) return shown.sceneId;
    return this.scenes.get(mapPath) ?? null;
  }

  private slotChanged(change: SlotChange): void {
    // Most projections (a token moved) change nothing the board shows: it hears only of a new scene or presented map.
    const before = `${this.presentedMap()}|${JSON.stringify([...this.scenes])}`;
    if (change.kind === 'freed') {
      if (this.scenes.get(change.slot.mapPath) === change.slot.sceneId) this.scenes.delete(change.slot.mapPath);
    } else if (change.kind === 'projected' || change.kind === 'state') {
      this.scenes.set(change.slot.mapPath, change.slot.sceneId);
    } else if (change.kind === 'moved' && change.to) {
      this.scenes.set(change.to.mapPath, change.to.sceneId);
    }
    if (`${this.presentedMap()}|${JSON.stringify([...this.scenes])}` !== before) this.emit();
  }

  private mark(mark: BoardMark): void {
    if (!this.started) return;
    for (const listener of [...this.marks]) {
      try {
        listener(mark);
      } catch (error) {
        console.error('[Atlas VTT Connect] The board could not show a mark:', error);
      }
    }
  }

  private emit(): void {
    for (const listener of [...this.changes]) {
      try {
        listener();
      } catch (error) {
        console.error('[Atlas VTT Connect] A board session listener failed:', error);
      }
    }
  }
}
