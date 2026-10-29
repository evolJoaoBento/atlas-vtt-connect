/**
 * The join page's dice tray, Atlas's tray (`DiceTray.tsx`) without React: seven dice to click, a
 * "−" under each die that holds any, a modifier of ±20 with steppers, the formula, Roll and Clear.
 * The pool, its formula and its limits are Atlas's own (`diceTrayPool.ts`); the page holds at most
 * the 20 dice the GM accepts. Shared with the web page; the DOM is `online-client/diceTrayView.mts`.
 */
import {
  addDie, clampModifier, MAX_PER_DIE, removeDie, trayDiceCount, trayFormula, trayPoolByDie, type TrayDie, type TrayPool,
} from '@atlas-vtt/shared/rules';
import type { DiceSelection } from '@atlas-vtt/shared/rules';
import { traySelection } from '../obsidian/onlineDice';
import type { AdvantageSide } from '../tools/sheets';
import { DICE_LIMITS } from '../tools/toolMessages';

/** Atlas's tray copy. */
export const ROLL_LABEL = 'Roll';
export const CLEAR_LABEL = 'Clear';
export const MODIFIER_LABEL = 'Modifier';
export const EMPTY_TRAY_TEXT = 'The tray is empty.';
export const SIDE_LABEL = 'Roll with';
export const SIDE_NAMES: Readonly<Record<'normal' | AdvantageSide, string>> = { normal: 'Normal', advantage: 'Advantage', disadvantage: 'Disadvantage' };

export const addDieLabel = (sides: TrayDie, count: number): string => (count === 0 ? `Add a d${sides}` : `Add a d${sides}, ${count} in the tray`);
export const removeDieLabel = (sides: TrayDie): string => `Take one d${sides} back`;

export class DiceTray {
  private pool: TrayPool = {};
  private bonus = 0;
  private chosen: AdvantageSide | null = null;

  get modifier(): number {
    return this.bonus;
  }

  count(sides: TrayDie): number {
    return this.pool[sides] ?? 0;
  }

  total(): number {
    return trayDiceCount(this.pool);
  }

  /** Whether one more die of this kind fits: Atlas's per-die limit, and the GM's 20 in all. */
  canAdd(sides: TrayDie): boolean {
    return this.count(sides) < MAX_PER_DIE && this.total() < DICE_LIMITS.dicePerRoll;
  }

  add(sides: TrayDie): boolean {
    if (!this.canAdd(sides)) return false;
    this.pool = addDie(this.pool, sides);
    return true;
  }

  remove(sides: TrayDie): boolean {
    const before = this.pool;
    this.pool = removeDie(this.pool, sides);
    return this.pool !== before;
  }

  /**
   * Whether advantage or disadvantage applies: the tray holds one d20 and nothing else, the roll a d20 system rolls twice
   * and keeps one of. Any other roll rolls as it is.
   */
  canChooseSide(): boolean {
    return this.total() === 1 && this.count(20) === 1;
  }

  /** The side the roll goes with; null (normal) where none was chosen or none applies. */
  get side(): AdvantageSide | null {
    return this.canChooseSide() ? this.chosen : null;
  }

  /** Chooses the side (null: normal). A roll it does not apply to keeps none. */
  chooseSide(side: AdvantageSide | null): void {
    this.chosen = side;
  }

  /** Moves the modifier by `delta`, within Atlas's ±20. */
  step(delta: number): number {
    this.bonus = clampModifier(this.bonus + delta);
    return this.bonus;
  }

  /** Atlas's formula, `2d6 + 1d20 + 3`; empty without dice. */
  formula(): string {
    return trayFormula(this.pool, this.bonus);
  }

  /** Nothing to clear: no dice and no modifier. */
  isEmpty(): boolean {
    return this.total() === 0 && this.bonus === 0;
  }

  /** The roll to send; null without dice. */
  roll(): { dice: DiceSelection; modifier: number; advantage?: AdvantageSide } | null {
    const dice = traySelection(trayPoolByDie(this.pool));
    const { side } = this;
    return dice ? { dice, modifier: this.bonus, ...(side ? { advantage: side } : {}) } : null;
  }

  clear(): void {
    this.pool = {};
    this.bonus = 0;
    this.chosen = null;
  }
}
