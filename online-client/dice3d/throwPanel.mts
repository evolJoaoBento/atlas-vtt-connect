// online-client/dice3d/throwPanel.mts
/**
 * One of the player's own rolls thrown on the join page, as Atlas's roll panel (`DiceRollPanel`)
 * throws it: a panel at the top of the map holding the dice, the formula while they fly, then the
 * dice's sum and, a beat later, the total with its modifier and the line that breaks it down
 * (`rollBreakdown`). A critical roll glows. A tap skips the flight, or closes the panel once the
 * dice lie; it leaves on its own after a while, and after the ripcord if the dice never land (a
 * hidden tab sleeps its frames). One roll at a time: a newer one replaces it. The canvas belongs
 * to Atlas's stage pool and goes back to it.
 */
import { stagePixelRatio } from '@atlas-vtt/shared/dice3d';
import { chainDepth, type DiceScene } from '@atlas-vtt/shared/dice3d';
import type { ThrowStyle } from '@atlas-vtt/shared/dice3d';
import { loadDiceArtwork } from '@atlas-vtt/shared/dice3d';
import { returnStage, type StageLease } from '@atlas-vtt/shared/dice3d';
import { planThrow } from '../../src/app/online/page/throwPlan';
import { hasBreakdown, rollBreakdown } from '@atlas-vtt/shared/dice3d';
import type { DiceRollResult } from '@atlas-vtt/shared/rules';
import { StageClock } from './stageClock.mts';

export interface PageThrow {
  result: DiceRollResult;
  scene: DiceScene;
  style: ThrowStyle;
  /** The player asked for reduced motion: the dice lie on their faces at once. */
  reduced: boolean;
}

/** `DiceRollPanel`'s times: how long the total stays, the ripcord per throw, the modifier's beat, the fade. */
export const LINGER_MS = 3600;
export const LINGER_STUCK_MS = 9000;
export const TICK_DELAY_MS = 420;
export const LEAVE_MS = 430;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const made = document.createElement(tag);
  made.className = className;
  if (text !== undefined) made.textContent = text;
  return made;
}

export class ThrowPanel {
  private readonly root: HTMLElement;
  private readonly holder: HTMLElement;
  private readonly slot: HTMLElement;
  private readonly clock: StageClock;
  private readonly observer: ResizeObserver | null;
  private timers: number[] = [];
  private landed = false;
  private closed = false;

  constructor(container: HTMLElement, private readonly lease: StageLease, private readonly roll: PageThrow, private readonly onGone: () => void) {
    const { result, scene, style, reduced } = roll;
    this.root = element('div', 'dice-throw');
    this.root.setAttribute('role', 'group');
    this.root.setAttribute('aria-label', 'Your roll');
    const header = element('div', 'dice-throw-header');
    header.append(element('span', 'dice-throw-label', result.formula));
    const close = element('button', 'icon-button dice-throw-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Hide roll');
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.close();
    });
    header.append(close);
    this.holder = element('div', 'dice-throw-stage');
    this.holder.setAttribute('role', 'img');
    this.holder.setAttribute('aria-label', `Rolling ${result.formula}`);
    this.holder.append(lease.canvas);
    this.slot = element('p', 'dice-throw-slot');
    this.slot.setAttribute('aria-live', 'polite');
    if (hasBreakdown(result, scene)) this.slot.classList.add('has-breakdown');
    this.slot.append(element('span', 'dice-throw-formula', result.formula));
    this.root.append(header, this.holder, this.slot);
    this.root.addEventListener('click', () => {
      if (!this.clock.skip()) this.close();
    });
    container.append(this.root);

    const win = window;
    const before = lease.renderer?.stage();
    // The bodies first, as `DiceStage` sets them: one mesh per die of the plan.
    lease.renderer?.setPlan(scene.plan.map((die) => die.sides));
    const planned = planThrow(scene, result.id, { before, measure: () => this.measure() }, style, reduced);
    this.clock = new StageClock(win, lease.renderer, planned.dice, planned.stepRandoms, result.crit ?? null, style, () => this.land());
    this.observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resized()) : null;
    this.observer?.observe(this.holder);
    // The numerals and card stock are images; the faces repaint once they arrive.
    void loadDiceArtwork().then(() => { if (!this.closed) this.clock.paint(); });
    this.clock.start();
    // The clock runs from the start: if the dice never land, the ripcord pulls.
    this.later(() => this.close(), LINGER_STUCK_MS * (1 + chainDepth(scene.plan)));
  }

  /** Gone at once, for a newer roll. */
  dismiss(): void {
    this.close(true);
  }

  private measure(): readonly [number, number] | undefined {
    const renderer = this.lease.renderer;
    if (!renderer) return undefined;
    // Layout size, not the bounding box: the panel enters with a transform.
    const width = Math.max(1, Math.round(this.holder.clientWidth || 240));
    const height = Math.max(1, Math.round(this.holder.clientHeight || 190));
    renderer.setView(width, height, stagePixelRatio(window), 0.5);
    return renderer.stage();
  }

  private resized(): void {
    if (this.closed) return;
    this.measure();
    this.clock.resized();
  }

  private land(): void {
    if (this.landed || this.closed) return;
    this.landed = true;
    const { result, scene } = this.roll;
    if (result.crit) this.root.classList.add(result.crit === 'high' ? 'is-crit-success' : 'is-crit-fail');
    const total = element('span', 'dice-throw-total', String(result.total - result.modifiers));
    this.slot.replaceChildren(total);
    const reveal = (): void => {
      total.textContent = String(result.total);
      const breakdown = rollBreakdown(result, scene);
      if (breakdown !== null) this.slot.append(element('span', 'dice-throw-breakdown', breakdown));
      this.holder.setAttribute('aria-label', `Rolled ${result.total}`);
    };
    // Landed: the ripcord is no longer needed, the linger starts.
    this.clearTimers();
    if (result.modifiers === 0 || this.roll.reduced) reveal();
    else this.later(reveal, TICK_DELAY_MS / this.roll.style.speed);
    this.later(() => this.close(), LINGER_MS);
  }

  private close(now = false): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimers();
    this.clock.stop();
    this.observer?.disconnect();
    const remove = (): void => {
      this.root.remove();
      returnStage(this.lease);
    };
    this.onGone();
    if (now || this.roll.reduced) {
      remove();
      return;
    }
    this.root.classList.add('is-leaving');
    window.setTimeout(remove, LEAVE_MS);
  }

  private later(run: () => void, ms: number): void {
    this.timers.push(window.setTimeout(run, ms));
  }

  private clearTimers(): void {
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
  }
}
