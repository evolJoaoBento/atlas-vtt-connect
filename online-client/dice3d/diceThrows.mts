// online-client/dice3d/diceThrows.mts
/**
 * The join page's 3D dice: Atlas's own (`src/app/dice3d/`, three.js) throwing the player's own
 * rolls. Its own chunk, loaded with the first roll the page throws (`OwnRollThrows`), so the page
 * opens as fast as without it. The Obsidian globals the dice use are installed first.
 *
 * The page holds at most two stages (`PAGE_STAGES`): the one on screen and one spare, so a roll
 * that replaces the one showing finds a stage made. Both draw through the page's one WebGL context
 * (`DiceGpu`). Atlas's `warmStages` builds four (a stack of rolls, panels fading out); one panel at
 * a time needs no more, and a phone's GPU memory is better spent elsewhere.
 */
import './obsidianShim.mts';
import { stagePixelRatio, type DiceRenderer } from '@atlas-vtt/shared/dice3d';
import { DIE_BODIES } from '@atlas-vtt/shared/dice3d';
import { loadDiceArtwork } from '@atlas-vtt/shared/dice3d';
import { makeDie } from '@atlas-vtt/shared/dice3d';
import { borrowStage, canShowDice, returnStage } from '@atlas-vtt/shared/dice3d';
import type { DiceThrowModule } from '../../src/app/online/page/ownRollThrows';
import { ThrowPanel, type PageThrow } from './throwPanel.mts';

/** The stage on screen and a spare. */
export const PAGE_STAGES = 2;
/** `stagePool`'s warm-up size in rem and spin: the panel's size and more, fast enough for the smear's shader. */
const WARM_REM = [21, 24] as const;
const WARM_SPIN = [40, 0, 0] as const;

let current: ThrowPanel | null = null;
let spare = false;

/**
 * One unseen frame of every body on a renderer, as `stagePool`'s warm-up draws it: the shaders get
 * compiled and the artwork reaches the graphics card before a roll needs them.
 */
function warmUp(renderer: DiceRenderer): void {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  renderer.setSize(Math.ceil(WARM_REM[0] * rem), Math.ceil(WARM_REM[1] * rem), stagePixelRatio(window));
  renderer.setPlan(DIE_BODIES);
  renderer.render(DIE_BODIES.map((sides) => ({ sides, anim: { ...makeDie(Math.random), w: [...WARM_SPIN] } })), 0);
}

/** Builds the spare stage once, in an idle moment after the first throw, and puts it in the pool. */
function prepareSpare(): void {
  if (spare) return;
  spare = true;
  const idle = (run: () => void): void => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 3000 });
    else window.setTimeout(run, 500);
  };
  void loadDiceArtwork().then(() => idle(() => {
    const lease = borrowStage(document);
    if (lease.renderer) warmUp(lease.renderer);
    returnStage(lease);
  }));
}

/**
 * Throws `roll` into `container`; false without WebGL, or while the page's context is lost (a stage
 * would stay blank, white on some systems), so the page shows the result card instead.
 */
function throwRoll(container: HTMLElement, roll: PageThrow): boolean {
  if (!canShowDice(document)) return false;
  const lease = borrowStage(document);
  if (!lease.renderer) {
    returnStage(lease);
    return false;
  }
  current?.dismiss();
  const panel = new ThrowPanel(container, lease, roll, () => {
    if (current === panel) current = null;
  });
  current = panel;
  prepareSpare();
  return true;
}

export const diceThrows: DiceThrowModule = { throwRoll };
