/**
 * A token going down greys and takes its skull as Atlas's do (`DownedTokenOverlay`): over 500 ms, eased out; healed, it
 * comes back over 350 ms. A token first seen downed (a new scene, a token coming into view) is so at once, and so is
 * every change when the viewer asks for less motion. Shared with the web page.
 */
import { easeOut, tweenAt, tweenDone, type Tween } from '../motion';

export const DOWNED_MOTION = { enterMs: 500, exitMs: 350, emblemScale: 1.15, emblemOpacity: 0.72 } as const;

interface Fade {
  downed: boolean;
  progress: number;
  tween: Tween | null;
}

export class DownedFades {
  private readonly fades = new Map<string, Fade>();
  private readonly seen = new Set<string>();
  private sceneId: string | null = null;

  constructor(private readonly now: () => number, private readonly reducedMotion: () => boolean = () => false) {}

  begin(sceneId: string): void {
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.fades.clear();
    }
    this.seen.clear();
  }

  /** How far `tokenId` is into being downed this frame: 0 alive, 1 fully downed. */
  progress(tokenId: string, downed: boolean): number {
    this.seen.add(tokenId);
    const time = this.now();
    let fade = this.fades.get(tokenId);
    if (!fade || this.reducedMotion()) {
      fade = { downed, progress: downed ? 1 : 0, tween: null };
      this.fades.set(tokenId, fade);
      return fade.progress;
    }
    if (fade.downed !== downed) {
      const from = fade.tween ? tweenAt(fade.tween, time) : fade.progress;
      fade.downed = downed;
      fade.tween = { from, to: downed ? 1 : 0, start: time, delay: 0, duration: downed ? DOWNED_MOTION.enterMs : DOWNED_MOTION.exitMs, ease: easeOut };
    }
    if (fade.tween) {
      fade.progress = tweenAt(fade.tween, time);
      if (tweenDone(fade.tween, time)) fade.tween = null;
    }
    return fade.progress;
  }

  end(): void {
    for (const id of [...this.fades.keys()]) if (!this.seen.has(id)) this.fades.delete(id);
  }

  animating(): boolean {
    for (const fade of this.fades.values()) if (fade.tween) return true;
    return false;
  }
}
