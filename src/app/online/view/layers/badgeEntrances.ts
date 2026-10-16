/**
 * Condition badges animate in as Atlas's do (`ConditionBadgeRing`): a badge new on a token that was already drawn fades
 * in and grows from half its size over 200 ms, eased out; the badges a token shows when it first appears, any on a new
 * scene, and all of them when the viewer asks for less motion are simply there. A badge is new when its condition, its
 * colour, its glyph or its number is (Atlas keys badges by all four). Shared with the web page.
 */
import { easeOut } from '../motion';

export const BADGE_ENTRANCE = { ms: 200, scale: 0.5 } as const;

/** How far a badge is into its entrance this frame: its scale and its opacity. */
export interface BadgeFrame {
  scale: number;
  alpha: number;
}

const SETTLED: BadgeFrame = { scale: 1, alpha: 1 };

export class BadgeEntrances {
  /** When each badge started entering; settled badges stay with `-Infinity`. */
  private readonly started = new Map<string, number>();
  /** Tokens drawn before this frame, whose new badges animate. */
  private readonly tokens = new Set<string>();
  private readonly seenTokens = new Set<string>();
  private readonly seenBadges = new Set<string>();
  private sceneId: string | null = null;

  constructor(private readonly now: () => number, private readonly reducedMotion: () => boolean = () => false) {}

  begin(sceneId: string): void {
    if (sceneId !== this.sceneId) {
      this.sceneId = sceneId;
      this.started.clear();
      this.tokens.clear();
    }
    this.seenTokens.clear();
    this.seenBadges.clear();
  }

  /** Notes that `tokenId` is drawn this frame, with badges or none: the badges it gains later animate in. */
  seeToken(tokenId: string): void {
    this.seenTokens.add(tokenId);
  }

  /** The badge `badge` (a key of its condition, colour, glyph and number) of `tokenId` this frame. */
  frame(tokenId: string, badge: string): BadgeFrame {
    const key = `${tokenId}\u0000${badge}`;
    this.seenTokens.add(tokenId);
    this.seenBadges.add(key);
    const time = this.now();
    let start = this.started.get(key);
    if (start === undefined) {
      start = this.tokens.has(tokenId) && !this.reducedMotion() ? time : -Infinity;
      this.started.set(key, start);
    }
    const progress = (time - start) / BADGE_ENTRANCE.ms;
    if (progress >= 1) return SETTLED;
    const eased = easeOut(Math.max(0, progress));
    return { scale: BADGE_ENTRANCE.scale + (1 - BADGE_ENTRANCE.scale) * eased, alpha: eased };
  }

  /** Ends a frame: badges and tokens not drawn went; a token drawn now animates the badges it gains from now on. */
  end(): void {
    for (const key of [...this.started.keys()]) if (!this.seenBadges.has(key)) this.started.delete(key);
    this.tokens.clear();
    for (const id of this.seenTokens) this.tokens.add(id);
  }

  animating(): boolean {
    const time = this.now();
    for (const start of this.started.values()) if (time - start < BADGE_ENTRANCE.ms) return true;
    return false;
  }
}
