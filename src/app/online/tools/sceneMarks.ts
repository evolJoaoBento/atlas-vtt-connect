/**
 * What a player's views draw of the scene's measures, worked out from the scene itself: the flat templates and the
 * spells (`sceneMeasures.ts`), told again whenever the scene's measures change; with them, the spells the GM asks of
 * the player's tokens (`spell-asks`) and, for a few seconds, an instantaneous spell going off (`spell-flash`). Nothing
 * here is a list of its own: a kept spell or template lives in Atlas's measures, and reaches this player in the scene.
 */
import type { PlayerMeasure, PlayerScene } from '../scene/sceneTypes';
import { spellsOfMeasures, templatesOfMeasures } from './sceneMeasures';
import type { MapSpell, SpellRequest } from './spells';
import type { MapTemplate } from './templates';

/** How long an instantaneous spell is among the scene's spells: long enough for the board to show it go off. */
export const FLASH_MS = 6000;
/** The colour of a measure that names none: Atlas's accent, as its measurements always were. */
export const MEASURE_ACCENT_COLOR = '#7c5cff';

export interface SceneMarksSink {
  templates(sceneId: string, templates: readonly MapTemplate[]): void;
  spells(sceneId: string, spells: readonly MapSpell[], asks: readonly SpellRequest[]): void;
}

export class SceneMarks {
  private sceneId: string | null = null;
  private measures: Readonly<Record<string, PlayerMeasure>> | null = null;
  private kept: MapSpell[] = [];
  /** The scene's tokens the lists were last worked out with, while a measure follows one (null while none does). */
  private tokens: PlayerScene['tokens'] | null = null;
  /** The asks last sent, by scene: those of a scene the player is not on wait for it. */
  private readonly asked = new Map<string, readonly SpellRequest[]>();
  private readonly flashes: Array<{ cast: MapSpell; timer: number }> = [];

  constructor(private readonly sink: SceneMarksSink) {}

  /** The scene the player has now (null: none). Its measures are read again only when they changed. */
  scene(scene: PlayerScene | null): void {
    const moved = scene?.sceneId !== this.sceneId;
    if (moved) this.dropFlashes();
    this.sceneId = scene?.sceneId ?? null;
    if (!scene) { this.measures = null; this.tokens = null; this.kept = []; return; }
    // Read again when the measures changed, and, while one follows a token (an aura, a spell on its caster), when the tokens did.
    if (!moved && scene.measures === this.measures && (this.tokens === null || scene.tokens === this.tokens)) return;
    this.measures = scene.measures;
    this.tokens = Object.values(scene.measures).some((measure) => measure.aura) ? scene.tokens : null;
    const tokens = scene.tokens;
    const tokenAt = (id: string): { x: number; y: number } | null => (Object.hasOwn(tokens, id) ? { x: tokens[id]!.x, y: tokens[id]!.y } : null);
    this.kept = spellsOfMeasures(scene.measures, { tokenAt });
    const cell = scene.grid?.size ?? scene.map.cellSize;
    this.sink.templates(scene.sceneId, templatesOfMeasures(scene.measures, { cell, accent: MEASURE_ACCENT_COLOR, tokenAt }));
    this.tellSpells();
  }

  /** The spells the GM asks of the player's tokens on `sceneId`. */
  asks(sceneId: string, asks: readonly SpellRequest[]): void {
    this.asked.set(sceneId, asks);
    if (sceneId === this.sceneId) this.tellSpells();
  }

  /** An instantaneous spell cast on `sceneId`: among the scene's spells for `FLASH_MS`, then gone. */
  flash(sceneId: string, cast: MapSpell): void {
    if (sceneId !== this.sceneId) return;
    const entry = { cast, timer: window.setTimeout(() => {
      const index = this.flashes.indexOf(entry);
      if (index < 0) return;
      this.flashes.splice(index, 1);
      this.tellSpells();
    }, FLASH_MS) };
    this.flashes.push(entry);
    this.tellSpells();
  }

  dispose(): void {
    this.dropFlashes();
    this.asked.clear();
  }

  private dropFlashes(): void {
    for (const { timer } of this.flashes.splice(0)) window.clearTimeout(timer);
  }

  private tellSpells(): void {
    if (this.sceneId === null) return;
    this.sink.spells(this.sceneId, [...this.kept, ...this.flashes.map(({ cast }) => cast)], this.asked.get(this.sceneId) ?? []);
  }
}
