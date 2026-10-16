/**
 * How a token's UI answers the player looking at it, as Atlas's `TokenUIRenderer` does: a selected token's bars,
 * nameplate and wheels ease over 300 ms to a constant size on screen (`selectedTokenUIScale`), and back to rest while it
 * is held or dragged or once it is no longer selected; its bar numbers fade in while it is hovered or selected, taking
 * 15% of the way left each frame (at 60 frames a second), and fade out again. Under reduced motion both jump. Shared
 * with the web page.
 */
import { easeOut, tweenAt, tweenDone, type Tween } from '../motion';

export const EMPHASIS_MOTION = { scaleMs: 300, numbersStep: 0.15, numbersFrameMs: 1000 / 60, numbersSnap: 0.05 } as const;

/** A token's emphasis this frame: how far its UI is towards the selected size (0 to 1), and its numbers' opacity. */
export interface EmphasisFrame {
  selected: number;
  numbers: number;
}

interface State {
  selectedTarget: number;
  selected: number;
  tween: Tween | null;
  numbers: number;
  numbersTarget: number;
  at: number;
}

export class TokenEmphasis {
  private readonly states = new Map<string, State>();
  private readonly seen = new Set<string>();
  private sceneId: string | null = null;

  constructor(private readonly now: () => number, private readonly reducedMotion: () => boolean = () => false) {}

  begin(sceneId: string): void {
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.states.clear();
    }
    this.seen.clear();
  }

  /** `tokenId` this frame: whether it is selected (and not held) and whether its numbers show (hovered or selected). */
  frame(tokenId: string, selected: boolean, showNumbers: boolean): EmphasisFrame {
    this.seen.add(tokenId);
    const time = this.now();
    const selectedTarget = selected ? 1 : 0;
    const numbersTarget = showNumbers ? 1 : 0;
    let state = this.states.get(tokenId);
    if (!state) {
      state = { selectedTarget, selected: selectedTarget, tween: null, numbers: numbersTarget, numbersTarget, at: time };
      this.states.set(tokenId, state);
      return { selected: state.selected, numbers: state.numbers };
    }
    const reduced = this.reducedMotion();
    if (selectedTarget !== state.selectedTarget) {
      state.selectedTarget = selectedTarget;
      const from = state.tween ? tweenAt(state.tween, time) : state.selected;
      state.tween = reduced ? null : { from, to: selectedTarget, start: time, delay: 0, duration: EMPHASIS_MOTION.scaleMs, ease: easeOut };
      if (reduced) state.selected = selectedTarget;
    }
    if (state.tween) {
      state.selected = tweenAt(state.tween, time);
      if (tweenDone(state.tween, time)) state.tween = null;
    }
    state.numbersTarget = numbersTarget;
    if (reduced) state.numbers = numbersTarget;
    else {
      // Atlas's 15% a frame, by the time that passed, so the fade takes as long at any frame rate.
      const frames = Math.max(0, time - state.at) / EMPHASIS_MOTION.numbersFrameMs;
      const left = (numbersTarget - state.numbers) * (1 - EMPHASIS_MOTION.numbersStep) ** frames;
      state.numbers = Math.abs(left) < EMPHASIS_MOTION.numbersSnap ? numbersTarget : numbersTarget - left;
    }
    state.at = time;
    return { selected: state.selected, numbers: state.numbers };
  }

  end(): void {
    for (const id of [...this.states.keys()]) if (!this.seen.has(id)) this.states.delete(id);
  }

  animating(): boolean {
    for (const state of this.states.values()) if (state.tween || state.numbers !== state.numbersTarget) return true;
    return false;
  }
}
