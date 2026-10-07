/**
 * One scene in use by a split party: the presented scene, or a tab players are assigned to. It holds what one scene's
 * players have (`lastSent`), its projection memo, its snapshot messages, and while it is live its lighting, fog
 * coverage and ticks. Only the live slot projects; a parked one keeps its last projection, its snapshot and lighting
 * frame (to re-project on a rules change, D8), and drops its fog coverage and lighting watcher. Everything it sends goes
 * to its audience, worked out by the hub at send time (P1).
 */
import type { Disposer, SceneSnapshot } from '@atlas-vtt/api-types';
import type { TabKey } from '../split/tabKey';
import { SightWait } from './goLive';
import type { LightingFrame } from './lightingFrame';
import { projectForPlayers } from './projectForPlayers';
import { createProjectionMemo } from './projectRecords';
import { diffScenes } from './sceneDiff';
import type { PresentationLighting } from './sceneLighting';
import { patchMessage, sceneLookMessage, sceneStateMessage, type SceneOutgoing } from './sceneMessages';
import {
  FOG_TRUNCATED_NOTICE, FogCoverageCache, type FogCoverages, sameSlice, sceneContext, sliceOf, type Slice,
} from './sceneSources';
import type { SlotHost, SlotSource, SlotState } from './slotContracts';
import { MapSizeWait, SnapshotCache, TickTimer } from './sceneTicks';
import type { PlayerScene } from './sceneTypes';
import { diceLookToSend } from './sceneValidation';

export type { SlotHost, SlotSource, SlotState } from './slotContracts';

interface Prepared {
  snapshot: SceneSnapshot;
  lighting: LightingFrame | null;
  fog: FogCoverages;
}

const CLEAR: SceneOutgoing = { v: 1, type: 'scene-clear' };

export class SceneSlot {
  state: SlotState = 'waiting';
  /** What its players have: the last projection sent; null before the first, or after a clear. */
  lastSent: PlayerScene | null = null;
  /** The tab's name and map, as its tab shows them; the hub follows renames. */
  name = '';
  mapPath = '';
  /** The dice look of its map's collection, as its players were last told (`scene-look`); null for none. */
  look: string | null = null;
  /** The map path `look` was read for, and which read is the latest: an older answer that arrives late is dropped. */
  private lookMap: string | null = null;
  private lookRead = 0;
  private readonly snapshots: SnapshotCache;
  /** Per slot: a memo shared between scenes would hand one scene's records to another's projection as unchanged. */
  private readonly memo = createProjectionMemo();
  /** The last snapshot projected and its lighting frame: what a parked slot is re-projected from (D8). */
  private kept: { snapshot: SceneSnapshot; frame: LightingFrame | null } | null = null;
  /** Only while live: the raster can reach 16 MB (spec 8.1). */
  private fogCache: FogCoverageCache | null = null;
  private lighting: PresentationLighting | null = null;
  private stopWatching: Disposer | null = null;
  /** P8: going live on a lit scene waits for sight, sending nothing meanwhile. */
  private sight: SightWait | null = null;
  /** Live but holding no scene of its own yet: `resume` after parking (a patch), `reload` in place (a snapshot, as before). */
  private awaiting: 'resume' | 'reload' | null = null;
  private slice: Slice | null = null;
  private fogNoticeShownFor: string | null = null;
  /** Its players were told it is paused: going live tells them it is not. */
  private pausedSent = false;
  private gone = false;
  private readonly ticks = new TickTimer(() => this.tick());
  /** Projects again once a map size unknown at projection becomes known (ruling F-POS hides a fogged scene until then). */
  private readonly sizeWait = new MapSizeWait(() => this.schedule());

  constructor(readonly tab: TabKey, readonly sceneId: string, private readonly source: SlotSource, private readonly host: SlotHost<SceneSlot>) {
    this.snapshots = new SnapshotCache((message) => host.options.notify(message));
  }

  /** The GM is on its tab: watch it, and once it holds the scene send what changed (P8 first on a lit scene). */
  goLive(): void {
    if (this.state === 'live') return;
    this.state = 'live';
    this.fogCache = new FogCoverageCache();
    this.awaiting = 'resume';
    this.stopWatching = this.source.subscribe(() => this.snapshotChanged());
    this.lighting = this.host.lighting.open({ viewId: this.tab.viewId, sceneId: this.sceneId }, () => this.lightingDue());
    if (this.source.snapshot()) this.resume();
  }

  /** The GM left its tab: its players keep what they have, and are told it is paused. */
  park(): void {
    if (this.state !== 'live') return;
    this.detach();
    this.state = 'parked';
    if (!this.lastSent) return;
    this.pausedSent = true;
    for (const playerId of this.host.audience(this)) this.host.send(playerId, sceneStateMessage(this.sceneId, true));
  }

  /** A change the next live tick carries (images, a collection's rules); nothing while parked. */
  schedule(): void {
    if (this.state === 'live' && this.awaiting === null && !this.sight) this.ticks.schedule();
  }

  /** The GM's player view rules changed: live, the next tick; parked, from the kept snapshot and frame (D8). */
  rulesChanged(): void {
    if (this.state === 'live') {
      this.schedule();
      return;
    }
    if (this.state !== 'parked' || !this.kept || !this.lastSent) return;
    const { snapshot, frame } = this.kept;
    // A coverage of its own, dropped once sent: a parked slot holds none.
    const fog = new FogCoverageCache().get(snapshot.objects.fog, this.memo, frame?.darkness, snapshot.mapSize);
    this.send({ snapshot, lighting: frame, fog });
  }

  /**
   * What its players have, to one more (admitted, moved here, a resync): the snapshot, else a clear. A parked scene's
   * `scene-state` follows once the session's other handlers sent theirs (camera, control list: spec 5.1), if it is
   * still parked and still theirs then.
   */
  sendCurrentTo(playerId: string): void {
    if (!this.lastSent) {
      this.host.sendSequenced(playerId, CLEAR);
      this.sendLookTo(playerId);
      return;
    }
    this.sendSnapshotTo(playerId);
    this.sendLookTo(playerId);
    if (this.state !== 'parked') return;
    void Promise.resolve().then(() => {
      if (this.state === 'parked' && this.host.audience(this).includes(playerId)) this.host.send(playerId, sceneStateMessage(this.sceneId, true));
    });
  }

  /** The scene the GM's view holds for it now, once live and caught up (P2, P8): what the GM's camera, laser and moves act on. */
  shownSnapshot(): SceneSnapshot | null {
    return this.state === 'live' && this.awaiting === null && !this.sight ? this.source.snapshot() : null;
  }

  /** Its map may have changed (a tab's rename or map): the dice look of the map's collection is read again when it did. */
  mapSeen(): void {
    if (this.lookMap !== this.mapPath) this.readLook();
  }

  /** A look choice may have changed anywhere: read this scene's again, and tell its players when it differs. */
  readLook(): void {
    const source = this.host.options.diceLook;
    if (!source || this.gone) return;
    this.lookMap = this.mapPath;
    const read = ++this.lookRead;
    new Promise<string | null>((resolve) => { resolve(source.lookFor(this.mapPath || null)); }).then((answer) => {
      if (this.gone || read !== this.lookRead) return;
      this.setLook(diceLookToSend(answer));
    }, (error: unknown) => {
      console.error('[Atlas VTT Connect] The dice look of a scene could not be read; players keep their own:', error);
    });
  }

  /** Whether it holds a fog coverage (only while live). */
  hasFogCoverage(): boolean { return this.fogCache !== null; }

  /** Out of use: it sends nothing more, ever. */
  dispose(): void {
    this.detach();
    this.state = 'parked';
    this.gone = true;
  }

  get disposed(): boolean { return this.gone; }

  private detach(): void {
    this.ticks.cancel();
    this.sizeWait.stop();
    this.stopWatching?.();
    this.stopWatching = null;
    this.sight?.cancel();
    this.sight = null;
    this.lighting?.dispose();
    this.lighting = null;
    this.fogCache = null;
    this.awaiting = null;
  }

  private snapshotChanged(): void {
    if (this.state !== 'live') return;
    // Read anew (P2): the listener's snapshot may be another tab's, loading, or already stale.
    const snapshot = this.source.snapshot();
    this.host.observed(this, snapshot);
    if (!snapshot) {
      // Writes made by loading are not edits: nothing is sent until the map is ready.
      this.awaiting ??= 'reload';
      this.ticks.cancel();
      return;
    }
    if (this.awaiting === 'resume') {
      if (!this.sight) this.resume();
      return;
    }
    if (this.awaiting === 'reload') {
      this.awaiting = null;
      // The store holds the scene reloaded in place: nothing of the lighting worked out before stands in.
      this.lighting?.restart();
      this.broadcastSnapshot(this.prepare());
      return;
    }
    if (this.slice && sameSlice(this.slice, sliceOf(snapshot))) return;
    this.ticks.schedule();
  }

  /** Its scene is loaded again: wait for sight on a lit scene with a parked projection (P8), then send what changed. */
  private resume(): void {
    if (this.lastSent && this.lighting?.pending?.() === true) {
      this.sight = new SightWait(() => {
        this.sight = null;
        this.finishResume();
      });
      return;
    }
    this.finishResume();
  }

  private finishResume(): void {
    const prepared = this.prepare();
    if (!prepared) return;
    this.awaiting = null;
    this.send(prepared);
    if (this.pausedSent) {
      this.pausedSent = false;
      for (const playerId of this.host.audience(this)) this.host.send(playerId, sceneStateMessage(this.sceneId, false));
    }
    this.host.caughtUp(this);
  }

  private lightingDue(): void {
    if (this.sight) this.sight.check(this.lighting?.pending?.() === true);
    else this.schedule();
  }

  private tick(): void {
    if (this.state !== 'live' || this.awaiting !== null || this.sight) return;
    const prepared = this.prepare();
    if (prepared) this.send(prepared);
  }

  /** A patch against what its players have, or a snapshot when they have nothing of it (or a clear instead of an oversized one). */
  private send(prepared: Prepared): void {
    const previous = this.lastSent;
    if (!previous || this.snapshots.failed(previous) || prepared.fog.truncated) {
      this.broadcastSnapshot(prepared);
      return;
    }
    const next = this.project(prepared);
    const patch = diffScenes(previous, next);
    if (!patch) return;
    this.setSent(next);
    const message = patchMessage(patch);
    for (const playerId of this.host.audience(this)) {
      if (message) this.host.sendSequenced(playerId, message);
      else this.sendSnapshotTo(playerId);
    }
  }

  /**
   * A truncated fog: the GM's fog has more operations than players can be sent, so what they would see is not what is
   * covered. Like an oversized scene, they get a clear until it fits again.
   */
  private broadcastSnapshot(prepared: Prepared | null): void {
    this.ticks.cancel();
    if (!prepared) return;
    if (prepared.fog.truncated) {
      this.clearForTruncatedFog(prepared.snapshot);
      return;
    }
    this.setSent(this.project(prepared));
    for (const playerId of this.host.audience(this)) {
      this.sendSnapshotTo(playerId);
      this.sendLookTo(playerId);
    }
  }

  private setLook(look: string | null): void {
    if (look === this.look) return;
    this.look = look;
    for (const playerId of this.host.audience(this)) this.host.send(playerId, sceneLookMessage(this.sceneId, look));
  }

  /** What its players are told of the look: nothing while it is none, which is what a player starts with. */
  private sendLookTo(playerId: string): void {
    if (this.look !== null) this.host.send(playerId, sceneLookMessage(this.sceneId, this.look));
  }

  /** A fresh snapshot of this slot's scene (P2), what its lighting hides now and the coverage; null when it holds none. */
  private prepare(): Prepared | null {
    const snapshot = this.source.snapshot();
    if (!snapshot || !this.fogCache) return null;
    const lighting = this.lighting?.frame(snapshot) ?? null;
    return { snapshot, lighting, fog: this.fogCache.get(snapshot.objects.fog, this.memo, lighting?.darkness, snapshot.mapSize) };
  }

  private clearForTruncatedFog(snapshot: SceneSnapshot): void {
    this.slice = sliceOf(snapshot);
    if (this.fogNoticeShownFor !== this.sceneId) {
      this.fogNoticeShownFor = this.sceneId;
      this.host.options.notify(FOG_TRUNCATED_NOTICE);
    }
    const hadScene = this.lastSent !== null;
    this.setSent(null);
    this.snapshots.forget();
    if (hadScene) for (const playerId of this.host.audience(this)) this.host.sendSequenced(playerId, CLEAR);
  }

  private project({ snapshot, lighting, fog }: Prepared): PlayerScene {
    this.slice = sliceOf(snapshot);
    this.kept = { snapshot, frame: lighting };
    // Only fog needs the size (F-POS); without fog nothing it decides waits on it.
    if (this.state === 'live' && fog.coverage.hasFog && !(snapshot.mapSize.width > 0 && snapshot.mapSize.height > 0)) {
      this.sizeWait.watch(() => this.source.snapshot()?.mapSize);
    }
    return projectForPlayers(snapshot, {
      sceneId: this.sceneId,
      rules: this.host.rules(),
      coverage: fog.coverage,
      lighting,
      assets: this.host.options.assets,
      ...sceneContext(snapshot, this.host.options),
    }, this.memo);
  }

  private setSent(scene: PlayerScene | null): void {
    this.lastSent = scene;
    this.host.projected(this);
  }

  /** A scene too large to send reaches players as a clear, never as a stale or partial scene. */
  private sendSnapshotTo(playerId: string): void {
    if (this.lastSent) this.snapshots.sendTo(this.lastSent, (message) => this.host.sendSequenced(playerId, message));
  }
}
