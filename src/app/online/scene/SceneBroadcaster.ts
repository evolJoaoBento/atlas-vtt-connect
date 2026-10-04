/**
 * Sends the presented scene to every admitted player: a snapshot on
 * presenting, on resume, on admission and on a player's resync; patches at
 * most every 50 ms in between; `scene-clear` when presenting stops. There is
 * one projection per scene and everyone gets the same messages. It plugs into
 * `GmSession` through `session.use`, so the session never learns about maps.
 */
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { LiveScene } from '../atlas/presentedSource';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import { randomId } from '../ids';
import type { ControlMessage } from '../protocol';
import type { LightingFrame } from './lightingFrame';
import { PlayerChannels } from './PlayerChannels';
import { pickPlayerViewRules, samePlayerViewRules, type PlayerViewRules } from './playerViewRules';
import { projectForPlayers } from './projectForPlayers';
import { createProjectionMemo, type ProjectionMemo } from './projectRecords';
import { diffScenes } from './sceneDiff';
import { noLightingCapability, type LightingSource, type PresentationLighting } from './sceneLighting';
import { patchMessage } from './sceneMessages';
import {
  FOG_TRUNCATED_NOTICE, FogCoverageCache, type FogCoverages, sameSlice, sceneContext, sliceOf,
  type SceneBroadcasterOptions, type ShownScene,
} from './sceneSources';
import { SnapshotCache, TickTimer } from './sceneTicks';
import type { PlayerScene } from './sceneTypes';

export type { PlayerViewSettingsSource, PresentedSceneSource, SceneBroadcasterOptions, SceneSession } from './sceneSources';
export { FOG_TRUNCATED_NOTICE, SCENE_TICK_MS, SCENE_TOO_LARGE_NOTICE } from './sceneSources';

interface Prepared {
  snapshot: SceneSnapshot;
  lighting: LightingFrame | null;
  fog: FogCoverages;
}

export class SceneBroadcaster implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  private readonly projectionListeners = new Set<(scene: PlayerScene | null) => void>();
  private memo: ProjectionMemo = createProjectionMemo();
  private rules: PlayerViewRules;
  private live: ShownScene | null = null;
  /** The presentation players were last shown, kept while it is held. */
  private shown: LiveScene | null = null;
  private sceneId: string | null = null;
  /** What players have: the last projection sent. Held scenes keep it; nothing re-projects it. */
  private lastSent: PlayerScene | null = null;
  private readonly snapshots: SnapshotCache;
  private readonly fogCache = new FogCoverageCache();
  private readonly lightingSource: LightingSource;
  /** The presented view's lighting, while a scene is shown. */
  private lighting: PresentationLighting | null = null;
  private readonly ticks = new TickTimer(() => this.tick());
  private fogNoticeShownFor: string | null = null;
  private readonly channels: PlayerChannels;

  constructor(private readonly options: SceneBroadcasterOptions) {
    this.channels = new PlayerChannels(options.session);
    this.rules = pickPlayerViewRules(options.settings.getLocalPlayerViewSettings());
    this.snapshots = new SnapshotCache((message) => options.notify(message));
    this.lightingSource = options.lighting ?? noLightingCapability((message) => options.notify(message));
  }

  start(): void {
    const { session, presented, settings, assets } = this.options;
    this.stops.push(
      session.use(this),
      presented.subscribe({
        presented: (scene, resumed) => this.showScene(scene, resumed),
        held: (scene) => this.holdScene(scene),
        cleared: () => this.clearScene(),
      }),
      settings.onChange(() => this.settingsChanged()),
      // A fingerprint became known or was forgotten: the next tick carries the change.
      assets.onChange(() => { if (this.live && !this.live.loading) this.ticks.schedule(); }),
      // A collection's resources and initiative rules are not in the snapshot: edits to them arrive here.
      this.options.watchResources?.(() => { if (this.live && !this.live.loading) this.ticks.schedule(); }) ?? (() => undefined),
    );
    const current = presented.current();
    if (current && !presented.isHeld()) this.showScene(current, false);
  }

  stop(): void {
    this.detach();
    this.channels.clear();
    this.stops.splice(0).forEach((stop) => stop());
  }

  /** The scene players have now; null when none was sent or it was cleared. */
  currentProjection(): PlayerScene | null {
    return this.lastSent;
  }

  /** Tells `listener` each time the scene players have changes; the asset server serves only its images. */
  onProjection(listener: (scene: PlayerScene | null) => void): () => void {
    this.projectionListeners.add(listener);
    return () => { this.projectionListeners.delete(listener); };
  }

  /** Also fires when a newer tab of a player replaces an older one: always a full snapshot. */
  onAdmitted(player: SessionPlayer): void {
    this.sendCurrent(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    // Players never send scene data; a resync is the only scene message the GM acts on.
    if (message.type !== 'scene-resync') return;
    const { playerId } = player;
    this.channels.requestResync(playerId, () => {
      if (this.channels.admitted().includes(playerId)) this.sendCurrent(playerId);
    });
  }

  onGone(player: SessionPlayer): void {
    this.channels.forget(player.playerId);
  }

  private showScene(scene: LiveScene, resumed: boolean): void {
    this.detach();
    this.shown = scene;
    const sceneId = resumed && this.sceneId !== null ? this.sceneId : randomId();
    if (sceneId !== this.sceneId) this.memo = createProjectionMemo();
    this.sceneId = sceneId;
    const live: ShownScene = {
      scene,
      sceneId,
      loading: scene.snapshot()?.loaded !== true,
      slice: null,
      unsubscribe: scene.subscribe((snapshot) => this.snapshotChanged(live, snapshot)),
    };
    this.live = live;
    this.lighting = this.lightingSource.open({ viewId: scene.info.viewId, sceneId }, () => {
      if (this.live === live && !live.loading) this.ticks.schedule();
    });
    if (!live.loading) this.broadcastSnapshot(live);
  }

  /** A presentation that starts held is a new one: players must not see the old scene as its start. */
  private holdScene(scene: LiveScene): void {
    this.detach();
    if (this.shown === scene) return;
    const hadScene = this.shown !== null;
    this.forgetScene();
    if (hadScene) this.clearPlayers();
  }

  private snapshotChanged(live: ShownScene, snapshot: SceneSnapshot): void {
    if (this.live !== live) return;
    if (!snapshot.loaded) {
      // Writes made by loading are not edits: nothing is sent until the map is ready.
      live.loading = true;
      this.ticks.cancel();
      return;
    }
    if (live.loading) {
      live.loading = false;
      // The store may hold the scene reloaded in place: nothing of the lighting worked out before stands in.
      this.lighting?.restart();
      this.broadcastSnapshot(live);
      return;
    }
    if (live.slice && sameSlice(live.slice, sliceOf(snapshot))) return;
    this.ticks.schedule();
  }

  private settingsChanged(): void {
    const rules = pickPlayerViewRules(this.options.settings.getLocalPlayerViewSettings());
    if (samePlayerViewRules(rules, this.rules)) return;
    this.rules = rules;
    // A held scene is not projected again; it gets the new rules when it resumes.
    if (this.live && !this.live.loading) this.ticks.schedule();
  }

  private detach(): void {
    this.ticks.cancel();
    this.live?.unsubscribe();
    this.live = null;
    this.lighting?.dispose();
    this.lighting = null;
  }

  private clearScene(): void {
    this.detach();
    this.forgetScene();
    this.clearPlayers();
  }

  private forgetScene(): void {
    this.shown = null;
    this.sceneId = null;
    this.snapshots.forget();
    this.setSent(null);
  }

  /** Every change of what players have goes through here, so projection listeners see each one. */
  private setSent(scene: PlayerScene | null): void {
    this.lastSent = scene;
    for (const listener of [...this.projectionListeners]) listener(scene);
  }

  private clearPlayers(): void {
    for (const playerId of this.channels.admitted()) this.channels.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
  }

  private tick(): void {
    const live = this.live;
    if (!live || live.loading) return;
    const prepared = this.prepare(live);
    if (!prepared) return;
    const previous = this.lastSent;
    // Players who got a clear instead of an oversized scene need a snapshot, not a patch.
    if (!previous || previous.sceneId !== live.sceneId || this.snapshots.failed(previous) || prepared.fog.truncated) {
      this.broadcastSnapshot(live, prepared);
      return;
    }
    const next = this.project(live, prepared);
    const patch = diffScenes(previous, next);
    if (!patch) return;
    this.setSent(next);
    const message = patchMessage(patch);
    for (const playerId of this.channels.admitted()) {
      if (message) this.channels.sendSequenced(playerId, message);
      else this.sendSnapshot(playerId);
    }
  }

  /**
   * A truncated fog (`prepared.fog.truncated`): the GM's fog has more operations than players can be sent, so
   * what they would see is not what is covered. Like an oversized scene, they get a clear until it fits again.
   */
  private broadcastSnapshot(live: ShownScene, prepared: Prepared | null = this.prepare(live)): void {
    this.ticks.cancel();
    if (!prepared) return;
    if (prepared.fog.truncated) {
      this.clearForTruncatedFog(live, prepared.snapshot);
      return;
    }
    this.setSent(this.project(live, prepared));
    for (const playerId of this.channels.admitted()) this.sendSnapshot(playerId);
  }

  /**
   * A fresh snapshot (its map size may settle after loading), what the view's lighting hides now (null
   * while unlit) and the coverage, worked out once per projection. Null when the view holds no loaded scene.
   */
  private prepare(live: ShownScene): Prepared | null {
    const snapshot = live.scene.snapshot();
    if (!snapshot?.loaded) return null;
    const lighting = this.lighting?.frame(snapshot) ?? null;
    // Rebuilt only when the fog operations or the darkness change.
    return { snapshot, lighting, fog: this.fogCache.get(snapshot.objects.fog, this.memo, lighting?.darkness) };
  }

  private clearForTruncatedFog(live: ShownScene, snapshot: SceneSnapshot): void {
    live.slice = sliceOf(snapshot);
    if (this.fogNoticeShownFor !== live.sceneId) {
      this.fogNoticeShownFor = live.sceneId;
      this.options.notify(FOG_TRUNCATED_NOTICE);
    }
    const hadScene = this.lastSent !== null;
    this.setSent(null);
    this.snapshots.forget();
    if (hadScene) this.clearPlayers();
  }

  private project(live: ShownScene, { snapshot, lighting, fog }: Prepared): PlayerScene {
    live.slice = sliceOf(snapshot);
    return projectForPlayers(snapshot, {
      sceneId: live.sceneId,
      rules: this.rules,
      coverage: fog.coverage,
      darkCoverage: fog.darkCoverage,
      lighting,
      assets: this.options.assets,
      ...sceneContext(snapshot, this.options),
    }, this.memo);
  }

  /** What players have, or a clear when they have nothing: never a new projection. */
  private sendCurrent(playerId: string): void {
    if (this.lastSent) this.sendSnapshot(playerId);
    else this.channels.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
  }

  /** A scene too large to send reaches players as a clear, never as a stale or partial scene. */
  private sendSnapshot(playerId: string): void {
    const scene = this.lastSent;
    if (!scene) return;
    const messages = this.snapshots.messagesOf(scene);
    if (!messages) {
      this.channels.sendSequenced(playerId, { v: 1, type: 'scene-clear' });
      return;
    }
    for (const message of messages) this.channels.sendSequenced(playerId, message);
  }
}
