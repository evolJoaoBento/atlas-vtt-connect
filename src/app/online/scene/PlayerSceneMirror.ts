/**
 * The player's copy of the presented scene, built from scene messages. Shared
 * with the web player page, so it imports nothing from Obsidian. A snapshot is
 * shown once all its fog and drawing parts arrived. A message that does not
 * follow the last one, or a patch before any snapshot, is discarded and
 * answered with a `scene-resync`; the GM replies with a snapshot.
 */
import type { ControlMessage } from '../protocol';
import { fogStats, fogOverRemoteLimits } from './remoteFogLimits';
import { keepFogIdentity } from './fogIdentity';
import { applyPatch } from './sceneDiff';
import { withMeasurementDefaults } from './sceneLimits';
import type { PlayerDrawing, PlayerFogOp, PlayerScene, PlayerSceneBody } from './sceneTypes';

export const RESYNC_MIN_INTERVAL_MS = 1000;

export type SceneMessage = Extract<
  ControlMessage,
  { type: 'scene-snapshot' | 'scene-fog' | 'scene-drawings' | 'scene-patch' | 'scene-clear' }
>;
type PartMessage = Extract<SceneMessage, { type: 'scene-fog' | 'scene-drawings' }>;

export interface PlayerSceneMirrorOptions {
  /** Ask the GM for a snapshot; `seq` is the last message applied, 0 before any. */
  sendResync(seq: number): void;
  onChange(scene: PlayerScene | null): void;
}

interface PendingSnapshot {
  body: PlayerSceneBody;
  fogParts: number;
  drawingParts: number;
  fogReceived: number;
  drawingsReceived: number;
  fog: Map<string, PlayerFogOp>;
  drawings: Map<string, PlayerDrawing>;
}

/** A fresh record from map entries; own properties, so an id like "__proto__" cannot reach the prototype. */
function toRecord<T>(entries: Map<string, T>): Record<string, T> {
  const record: Record<string, T> = {};
  for (const [id, value] of entries) {
    Object.defineProperty(record, id, { value, enumerable: true, writable: true, configurable: true });
  }
  return record;
}

export class PlayerSceneMirror {
  private current: PlayerScene | null = null;
  private pending: PendingSnapshot | null = null;
  private lastSeq = 0;
  private lastResyncAt = Number.NEGATIVE_INFINITY;
  private resyncTimer: number | null = null;
  /** The last scene had more fog than Atlas's remote view works out (`REMOTE_FOG_LIMITS`): nothing shows until a snapshot or a clear. */
  private refused = false;

  constructor(private readonly options: PlayerSceneMirrorOptions) {}

  get scene(): PlayerScene | null {
    return this.current;
  }

  receive(message: SceneMessage): void {
    switch (message.type) {
      case 'scene-snapshot':
        this.cancelResync();
        this.lastSeq = message.seq;
        this.refused = false;
        this.pending = {
          body: message.scene, fogParts: message.fogParts, drawingParts: message.drawingParts,
          fogReceived: 0, drawingsReceived: 0, fog: new Map(), drawings: new Map(),
        };
        this.commitIfComplete();
        break;
      case 'scene-fog':
      case 'scene-drawings':
        this.receivePart(message);
        break;
      case 'scene-patch':
        if (this.refused && !this.pending && message.seq === this.lastSeq + 1) {
          this.lastSeq = message.seq;
          break;
        }
        if (!this.current || this.pending || message.seq !== this.lastSeq + 1) {
          this.lost();
          break;
        }
        this.lastSeq = message.seq;
        this.show(this.withDefaults(applyPatch(this.current, message)));
        break;
      case 'scene-clear': {
        this.cancelResync();
        this.lastSeq = message.seq;
        const hadScene = this.current !== null || this.pending !== null;
        this.refused = false;
        this.current = null;
        this.pending = null;
        if (hadScene) this.options.onChange(null);
        break;
      }
    }
  }

  /** A scene message failed validation: ask for a snapshot, at most once per second. */
  invalid(): void {
    this.requestResync();
  }

  dispose(): void {
    this.cancelResync();
  }

  /** Fog and drawing parts each arrive in order, numbered from 0, and never beyond the snapshot's count. */
  private receivePart(message: PartMessage): void {
    const pending = this.pending;
    const isFog = message.type === 'scene-fog';
    const expected = pending ? (isFog ? pending.fogReceived : pending.drawingsReceived) : -1;
    const total = pending ? (isFog ? pending.fogParts : pending.drawingParts) : 0;
    if (!pending || message.seq !== this.lastSeq + 1 || message.part !== expected || expected >= total) {
      this.lost();
      return;
    }
    this.lastSeq = message.seq;
    if (message.type === 'scene-fog') {
      for (const [id, op] of Object.entries(message.records)) pending.fog.set(id, op);
      pending.fogReceived++;
    } else {
      for (const [id, drawing] of Object.entries(message.records)) pending.drawings.set(id, drawing);
      pending.drawingsReceived++;
    }
    this.commitIfComplete();
  }

  private commitIfComplete(): void {
    const pending = this.pending;
    if (!pending || pending.fogReceived < pending.fogParts || pending.drawingsReceived < pending.drawingParts) return;
    this.pending = null;
    const body = pending.body;
    // Named fields only: the body is network data and may carry keys this version does not know.
    this.show({
      sceneId: body.sceneId, map: body.map, grid: body.grid, tokens: body.tokens, texts: body.texts,
      widgets: body.widgets, initiative: body.initiative,
      measurement: withMeasurementDefaults(body.measurement),
      fog: keepFogIdentity(this.current?.fog, toRecord(pending.fog)), drawings: toRecord(pending.drawings),
    });
  }

  /**
   * Shows `scene`, unless its fog is more than a remote view works out: then the scene is hidden (fail closed, never
   * the map without its fog) until the GM sends another snapshot. A GM sends none such; it clears instead.
   */
  private show(scene: PlayerScene): void {
    if (fogOverRemoteLimits(fogStats(scene.fog), scene.map)) {
      this.refused = true;
      this.current = null;
      this.options.onChange(null);
      return;
    }
    this.current = scene;
    this.options.onChange(scene);
  }

  /** A patch from an older GM may set a measurement without every field. */
  private withDefaults(scene: PlayerScene): PlayerScene {
    return { ...scene, measurement: withMeasurementDefaults(scene.measurement) };
  }

  /** A message did not follow the last one: drop it and any half-received snapshot, keep the scene shown. */
  private lost(): void {
    this.pending = null;
    this.requestResync();
  }

  private requestResync(): void {
    if (this.resyncTimer !== null) return;
    const wait = this.lastResyncAt + RESYNC_MIN_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.sendResync();
      return;
    }
    this.resyncTimer = window.setTimeout(() => {
      this.resyncTimer = null;
      this.sendResync();
    }, wait);
  }

  private sendResync(): void {
    this.lastResyncAt = Date.now();
    this.options.sendResync(this.lastSeq);
  }

  private cancelResync(): void {
    if (this.resyncTimer !== null) window.clearTimeout(this.resyncTimer);
    this.resyncTimer = null;
  }
}
