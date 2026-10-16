/**
 * The image the GM shows players (a handout): a vault image and its title, or none. Every scene in use carries it to
 * its players (`PlayerScene.handout`), so its file reaches them as the map does, through the asset channel, checked
 * against what their scene holds. Cleared when hosting stops.
 */
export interface Handout {
  /** The vault path of the image; never sent. */
  path: string;
  /** What players see it called. */
  title: string;
}

export interface HandoutSource {
  current(): Handout | null;
  /** Calls `listener` when the handout changes; returns the stop. */
  subscribe(listener: () => void): () => void;
}

export class Handouts implements HandoutSource {
  private shown: Handout | null = null;
  private readonly listeners = new Set<() => void>();

  current(): Handout | null {
    return this.shown;
  }

  show(handout: Handout | null): void {
    this.shown = handout ? { path: handout.path, title: handout.title.slice(0, 120) } : null;
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[Atlas VTT Connect] A handout listener failed:', error);
      }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** The one handout of this Obsidian window's hosting. */
export const handouts = new Handouts();
