/**
 * The join page's own rolls: each roll this player made (`mine`, live) is thrown as Atlas's 3D dice
 * unless the player chose result cards, the roll's dice cannot all be shown (more than 20, dice
 * the log did not list, a die with no body) or the browser has no WebGL; then the dice log's toast
 * shows it, the page's result card. The dice and three.js come in their own chunk, loaded on the
 * first throw (`load`); if it fails to arrive (offline, a page left open across an update) the
 * toast shows the roll and the next roll tries again. Shared with the web page; imports no three.js.
 */
import { diceSceneToShow, throwStyle, type DiceDisplay, type DiceScene, type ThrowStyle } from '@atlas-vtt/shared/diceDisplay';
import type { DiceRollResult } from '@atlas-vtt/shared/rules';
import { diceLogResult } from '../obsidian/onlineDice';
import type { DiceLogEntry } from '../tools/toolMessages';

/** What the lazy chunk offers (`online-client/dice3d/diceThrows.mts`). */
export interface DiceThrowModule {
  /** False when there is no WebGL: nothing was thrown. */
  throwRoll(container: HTMLElement, roll: { result: DiceRollResult; scene: DiceScene; style: ThrowStyle; reduced: boolean }): boolean;
}

export interface OwnRollThrowsOptions {
  container: HTMLElement;
  display(): DiceDisplay;
  reducedMotion(): boolean;
  load(): Promise<DiceThrowModule>;
  /** The roll shows as a result card after all. */
  fallback(entry: DiceLogEntry): void;
}

export class OwnRollThrows {
  private loading: Promise<DiceThrowModule> | null = null;
  private noWebGl = false;

  constructor(private readonly options: OwnRollThrowsOptions) {}

  /** True when the roll is thrown (or on its way to be), so no toast shows it. */
  handle(entry: DiceLogEntry): boolean {
    const display = this.options.display();
    if (display === 'card' || this.noWebGl || entry.unlisted) return false;
    const result = diceLogResult(entry);
    const scene = diceSceneToShow(result, display);
    if (!scene) return false;
    const roll = { result, scene, style: throwStyle(display), reduced: this.options.reducedMotion() };
    this.loading ??= this.options.load();
    this.loading.then((dice) => {
      if (dice.throwRoll(this.options.container, roll)) return;
      this.noWebGl = true;
      this.options.fallback(entry);
    }).catch(() => {
      this.loading = null;
      this.options.fallback(entry);
    });
    return true;
  }
}
