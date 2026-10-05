// online-client/dice3d/stageClock.mts
/**
 * The clock of a throw on the join page: upstream's `DiceStage` frame loop without React and
 * without sound (the page plays none). Each frame steps every die by its own seeded randomness
 * and draws; the loop stops once the dice lie and the light has swelled, at the latest when the
 * afterglow ran out. `GLEAM` and `AFTERGLOW` are `DiceStage`'s (a test keeps them equal).
 */
import type { DiceRenderer, StageDie } from '@atlas-vtt/shared/dice3d';
import type { ThrowStyle } from '@atlas-vtt/shared/dice3d';
import { restImmediately, stepDie } from '@atlas-vtt/shared/dice3d';
import type { Rng } from '@atlas-vtt/shared/dice3d';
import type { DiceCrit } from '@atlas-vtt/shared/rules';

/** How long the light takes to swell once the dice lie. */
export const GLEAM = 0.28;
/** The longest the loop runs on after the dice came to rest. */
export const AFTERGLOW = 1.45;

export class StageClock {
  private frame: number | null = null;
  private last = 0;
  private settled = false;

  constructor(
    private readonly win: Window,
    private readonly renderer: DiceRenderer | null,
    private readonly dice: StageDie[],
    private readonly stepRandoms: readonly Rng[],
    private readonly crit: DiceCrit,
    private readonly style: ThrowStyle,
    private readonly onSettled: () => void,
  ) {}

  /** Starts the loop; dice already lying (reduced motion) settle at once. */
  start(): void {
    if (this.dice.every((die) => die.anim.phase === 'rest')) {
      this.paint();
      this.settle();
      return;
    }
    if (this.frame !== null) return;
    this.last = 0;
    const tick = (now: number): void => {
      const previous = this.last;
      this.last = now;
      // The first step is zero: between the request and the first frame lies the whole setup.
      const dt = previous === 0 ? 0 : Math.min(0.04, (now - previous) / 1000);
      const more = this.advance(dt);
      this.paint();
      this.frame = more ? this.win.requestAnimationFrame(tick) : null;
    };
    this.frame = this.win.requestAnimationFrame(tick);
  }

  /** Every die goes straight to its resting pose. Returns whether anything was still flying. */
  skip(): boolean {
    let flying = false;
    for (const die of this.dice) {
      if (die.anim.phase === 'rest') continue;
      restImmediately(die.anim, die.anim.target);
      flying = true;
    }
    if (flying) this.paint();
    return flying;
  }

  /** The view changed size: resting dice take the new walls; a die in flight keeps the stage it was thrown on. */
  resized(): void {
    const stage = this.renderer?.stage();
    if (stage) for (const die of this.dice) if (die.anim.phase === 'rest') die.anim.stage = stage;
    this.paint();
  }

  stop(): void {
    if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  paint(): void {
    if (!this.renderer) return;
    const resting = this.dice.filter((die) => die.anim.phase === 'rest');
    const emphasis = resting.length === this.dice.length && resting.length > 0
      ? Math.min(1, Math.min(...resting.map((die) => die.anim.restFor)) / (GLEAM * this.style.speed))
      : 0;
    this.renderer.render(this.dice, emphasis, this.crit);
  }

  /** One frame on. Returns whether anything is left to do. */
  private advance(dt: number): boolean {
    for (const [i, die] of this.dice.entries()) stepDie(die.anim, dt * this.style.speed, this.stepRandoms[i] ?? Math.random);
    const allResting = this.dice.every((die) => die.anim.phase === 'rest');
    if (allResting) this.settle();
    if (!allResting) return true;
    const rested = Math.min(...this.dice.map((die) => die.anim.restFor));
    if (rested < GLEAM * this.style.speed) return true;
    return rested < AFTERGLOW * this.style.speed && this.renderer?.isStill() !== true;
  }

  private settle(): void {
    if (this.settled) return;
    this.settled = true;
    this.onSettled();
  }
}
