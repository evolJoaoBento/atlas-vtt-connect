/**
 * The online session as Tabletop's 3D board on the GM's side shows it (`BoardSession`, handed to Tabletop's
 * `api.attachSession`): whether the GM is hosting, the presented map, each map's lasting templates (with the cone
 * angle they open by) and the handout shown, and the pings and lasers players send, as marks of their map. The GM
 * places templates from the board and erases any of them; every player of that scene hears of it as from Connect's own
 * view. The relays hand it what they accept (`PingRelay`, `LaserRelay`, `TemplateHost`), so the board shows exactly what
 * players see.
 */
import type { HandoutSource } from '../handouts';
import type { SlotChange, SlotProjection } from '../scene/slotViews';
import type { TemplateHost } from './TemplateHost';
import type { MapTemplate, TemplateShape } from './templates';

type Point = { x: number; y: number };

export type BoardMark =
  | { kind: 'ping'; mapPath: string; x: number; y: number; color: string }
  | { kind: 'laser'; mapPath: string; from: string; points: Point[]; lifted: boolean; color: string };

export interface BoardOverlay {
  templates: readonly MapTemplate[];
  /** Radians a cone opens by on this map. */
  coneAngle: number;
  handout: { path: string; title: string } | null;
}

/** What Tabletop reads of the session (its `connectContract.ts` keeps the same shape). */
export interface BoardSession {
  hosting(): boolean;
  presentedMap(): string | null;
  overlay(mapPath: string): BoardOverlay;
  onChange(listener: () => void): () => void;
  onMark(listener: (mark: BoardMark) => void): () => void;
  addTemplate(mapPath: string, add: { shape: TemplateShape; start: Point; end: Point }): boolean;
  eraseTemplate(mapPath: string, id: string): void;
  clearTemplates(mapPath: string): void;
}

/** What relays tell the board. */
export interface BoardSessionSink {
  templatesChanged(): void;
  ping(mapPath: string, x: number, y: number, color: string): void;
  laser(mapPath: string, from: string, points: readonly Point[], lifted: boolean, color: string): void;
}

export interface BoardSessionHubOptions {
  projection: Pick<SlotProjection, 'shownSlot' | 'onSlotChange'>;
  handouts: HandoutSource;
  /** The cone angle of the map's collection, in degrees. */
  coneAngle(mapPath: string): number;
}

export class BoardSessionHub implements BoardSession, BoardSessionSink {
  private readonly changes = new Set<() => void>();
  private readonly marks = new Set<(mark: BoardMark) => void>();
  private readonly stops: Array<() => void> = [];
  /** The scene in use of each map, as the hub last told of it. */
  private readonly scenes = new Map<string, string>();
  private templates: TemplateHost | null = null;
  private started = false;

  constructor(private readonly options: BoardSessionHubOptions) {}

  useTemplates(templates: TemplateHost | null): void {
    this.templates = templates;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stops.push(
      this.options.projection.onSlotChange((change) => this.slotChanged(change)),
      this.options.handouts.subscribe(() => this.emit()),
    );
    this.emit();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.stops.splice(0).forEach((stop) => stop());
    this.scenes.clear();
    this.emit();
  }

  hosting(): boolean {
    return this.started;
  }

  presentedMap(): string | null {
    return this.started ? this.options.projection.shownSlot()?.mapPath ?? null : null;
  }

  overlay(mapPath: string): BoardOverlay {
    const sceneId = this.sceneOf(mapPath);
    return {
      templates: sceneId && this.templates ? this.templates.listFor(sceneId) : [],
      coneAngle: (this.options.coneAngle(mapPath) * Math.PI) / 180,
      handout: this.started ? this.options.handouts.current() : null,
    };
  }

  onChange(listener: () => void): () => void {
    this.changes.add(listener);
    return () => { this.changes.delete(listener); };
  }

  onMark(listener: (mark: BoardMark) => void): () => void {
    this.marks.add(listener);
    return () => { this.marks.delete(listener); };
  }

  addTemplate(mapPath: string, add: { shape: TemplateShape; start: Point; end: Point }): boolean {
    const sceneId = this.sceneOf(mapPath);
    return sceneId !== null && this.templates !== null && this.templates.addGm(sceneId, add);
  }

  eraseTemplate(mapPath: string, id: string): void {
    const sceneId = this.sceneOf(mapPath);
    if (sceneId) this.templates?.erase(sceneId, id);
  }

  clearTemplates(mapPath: string): void {
    const sceneId = this.sceneOf(mapPath);
    if (sceneId) this.templates?.clearScene(sceneId);
  }

  templatesChanged(): void {
    this.emit();
  }

  ping(mapPath: string, x: number, y: number, color: string): void {
    this.mark({ kind: 'ping', mapPath, x, y, color });
  }

  laser(mapPath: string, from: string, points: readonly Point[], lifted: boolean, color: string): void {
    this.mark({ kind: 'laser', mapPath, from, points: points.map(({ x, y }) => ({ x, y })), lifted, color });
  }

  private sceneOf(mapPath: string): string | null {
    if (!this.started) return null;
    const shown = this.options.projection.shownSlot();
    if (shown?.mapPath === mapPath) return shown.sceneId;
    return this.scenes.get(mapPath) ?? null;
  }

  private slotChanged(change: SlotChange): void {
    // Most projections (a token moved) change nothing the board shows: it hears only of a new scene or presented map.
    const before = `${this.presentedMap()}|${JSON.stringify([...this.scenes])}`;
    if (change.kind === 'freed') {
      if (this.scenes.get(change.slot.mapPath) === change.slot.sceneId) this.scenes.delete(change.slot.mapPath);
    } else if (change.kind === 'projected' || change.kind === 'state') {
      this.scenes.set(change.slot.mapPath, change.slot.sceneId);
    } else if (change.kind === 'moved' && change.to) {
      this.scenes.set(change.to.mapPath, change.to.sceneId);
    }
    if (`${this.presentedMap()}|${JSON.stringify([...this.scenes])}` !== before) this.emit();
  }

  private mark(mark: BoardMark): void {
    if (!this.started) return;
    for (const listener of [...this.marks]) {
      try {
        listener(mark);
      } catch (error) {
        console.error('[Atlas VTT Connect] The board could not show a mark:', error);
      }
    }
  }

  private emit(): void {
    for (const listener of [...this.changes]) {
      try {
        listener();
      } catch (error) {
        console.error('[Atlas VTT Connect] A board session listener failed:', error);
      }
    }
  }
}
