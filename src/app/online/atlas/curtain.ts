/**
 * The curtain: players see black. Atlas 0.12's player window bar has "Hide the map", which blacks out the local player
 * window only (online play does not read it), so a GM who hid the map would still show it to hosted players. This
 * follows it: the curtain is down while Atlas's player window has its curtain class (`atlas-player-window--curtain`,
 * on that popout's body), or while the GM lowered Connect's own (the "Hide the map from players" command).
 * Atlas keeps its state out of reach (a module's store, a singleton), so the window's own document is what is read.
 */
import type { App } from 'obsidian';

/** Atlas's local player window view and the class its body takes while its curtain is down. */
const PLAYER_VIEW_TYPE = 'atlas-vtt-local-player';
const CURTAIN_CLASS = 'atlas-player-window--curtain';

export interface CurtainSource {
  /** Whether players are to see black now. */
  down(): boolean;
  /** Calls `listener` when that changes; returns the stop. */
  subscribe(listener: () => void): () => void;
}

export class Curtain implements CurtainSource {
  private own = false;
  private atlas = false;
  private readonly listeners = new Set<() => void>();
  private readonly watched = new Map<Document, MutationObserver>();
  private readonly stops: Array<() => void> = [];

  constructor(private readonly app: App) {
    const workspace = app.workspace;
    const look = (): void => this.look();
    for (const event of ['layout-change', 'active-leaf-change'] as const) {
      const ref = workspace.on(event as 'layout-change', look);
      this.stops.push(() => workspace.offref(ref));
    }
    this.look();
  }

  down(): boolean {
    return this.own || this.atlas;
  }

  /** Connect's own curtain, lowered or lifted by the GM. */
  setOwn(down: boolean): void {
    if (this.own === down) return;
    this.own = down;
    this.changed();
  }

  get ownDown(): boolean {
    return this.own;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    for (const stop of this.stops) stop();
    this.stops.length = 0;
    for (const observer of this.watched.values()) observer.disconnect();
    this.watched.clear();
    this.listeners.clear();
  }

  /** Follows the bodies of Atlas's player windows now open, and reads their curtains. */
  private look(): void {
    const docs = new Set<Document>();
    for (const leaf of this.app.workspace.getLeavesOfType(PLAYER_VIEW_TYPE)) {
      const doc = (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl?.ownerDocument;
      if (doc?.body) docs.add(doc);
    }
    for (const [doc, observer] of [...this.watched]) {
      if (docs.has(doc)) continue;
      observer.disconnect();
      this.watched.delete(doc);
    }
    for (const doc of docs) {
      if (this.watched.has(doc)) continue;
      const win = doc.defaultView;
      if (!win) continue;
      const observer = new win.MutationObserver(() => this.read());
      observer.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
      this.watched.set(doc, observer);
    }
    this.read();
  }

  private read(): void {
    const now = [...this.watched.keys()].some((doc) => doc.body.classList.contains(CURTAIN_CLASS));
    if (now === this.atlas) return;
    this.atlas = now;
    this.changed();
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[Connect] A curtain listener failed:', error);
      }
    }
  }
}
