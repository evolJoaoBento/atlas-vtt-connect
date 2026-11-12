/**
 * Tabletop's cutscenes to players. Every admitted player is told the run (`cutscene`, again whenever it changes, `null`
 * when it ends). A player whose client can draw cutscenes asks (`cutscene-ready`) and is then sent the revealed scene
 * of every map of the run (`cutscene-scene`, `cutscene-extras`, no fog, nothing GM-hidden), read from the GM's Atlas tab
 * of each map while that tab is live, and, in a live run, the GM's camera (`cutscene-camera`, at most every 100 ms, the
 * last move always). The vault path of a map never goes out: players know a map by its run-local key. The cutscene's scene
 * belongs to no one's assignments; it is dropped, with the files players may fetch for it, when the run ends. A
 * `GmSession` handler.
 */
import type { Disposer, SceneSnapshot } from '@atlas-vtt/api-types';
import { boardAssetIds, sceneAssetIds } from '../assets/assetIds';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import type { TabScenes, TabInfo } from '../atlas/tabScenes';
import { boardParts } from './BoardSender';
import type { BoardExtras } from './boardTypes';
import { projectCutscene, sceneBytes, CUTSCENE_SCENE_BYTES, type CutsceneProjectionOptions } from './projectCutscene';
import { createProjectionMemo, type ProjectionMemo } from './projectRecords';
import type { GmCutscene } from './sceneContracts';
import type { BoardSource, SceneSession } from './sceneSources';
import type { PlayerScene } from './sceneTypes';

/** The longest a live camera goes unsent while it moves. */
export const CAMERA_INTERVAL_MS = 100;
/** The scenes of a run are projected again at most this often. */
export const SCENE_INTERVAL_MS = 200;

export interface CutsceneSenderOptions {
  session: SceneSession;
  /** The GM's scene tabs; without them there is no live snapshot of a map, and no scene is sent. */
  tabs: TabScenes | null;
  /** Tabletop's board, which publishes the run; without it there is none. */
  board: BoardSource | null;
  /** What the projection reads of the session (the scene hub's options). */
  sceneOptions: Omit<CutsceneProjectionOptions, 'assets'>;
  assets: CutsceneProjectionOptions['assets'];
  /** Told of a scene the GM's settings change; optional. */
  onSettings?: (listener: () => void) => () => void;
}

/** One map of the run, as last projected. */
interface Entry {
  path: string;
  memo: ProjectionMemo;
  scene: PlayerScene | null;
  sceneText: string;
  extras: BoardExtras | null;
  extrasText: string;
  parts: BoardExtras[];
  seq: number;
  ids: ReadonlySet<string>;
}

/** What one ready player was last sent, as text. */
interface Sent {
  scenes: Map<string, string>;
  extras: Map<string, string>;
  camera: string;
}

export class CutsceneSender implements SessionHandler {
  private readonly stops: Disposer[] = [];
  private watching: Disposer[] = [];
  /** The run now, as Tabletop last published it; its `maps` are that publication's alone. */
  private run: GmCutscene | null = null;
  private runText = 'null';
  private readonly entries = new Map<string, Entry>();
  private readonly ready = new Map<string, Sent>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  private sceneCooldown: number | null = null;
  private sceneDirty = false;
  private cameraCooldown: number | null = null;
  private cameraDirty = false;

  constructor(private readonly options: CutsceneSenderOptions) {}

  start(): void {
    const { session, board } = this.options;
    this.stops.push(session.use(this));
    if (board?.subscribeCutscene) this.stops.push(board.subscribeCutscene(() => this.changed()));
    if (board?.subscribeCutsceneCamera) this.stops.push(board.subscribeCutsceneCamera(() => this.cameraMoved()));
    // A run already going when this attaches is picked up.
    this.changed();
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    this.finish();
    this.ready.clear();
  }

  /** Whether a cutscene runs: players' moves and templates are refused meanwhile. */
  running(): boolean {
    return this.run !== null;
  }

  /** The files `playerId` may fetch for the run's scenes: those of the maps sent to a ready player, until the run ends. */
  assetsFor(playerId: string): ReadonlySet<string> {
    if (!this.run || !this.ready.has(playerId)) return new Set();
    const ids = new Set<string>();
    for (const entry of this.entries.values()) for (const id of entry.ids) ids.add(id);
    return ids;
  }

  /** Calls `listener` when what `assetsFor` allows changed; returns the stop. */
  onAssetsChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onAdmitted(player: SessionPlayer): void {
    if (this.run) this.options.session.send(player.playerId, { v: 1, type: 'cutscene', cutscene: this.run.cutscene });
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'cutscene-ready') {
      if (!message.on) {
        this.ready.delete(player.playerId);
        this.assetsChanged();
        return;
      }
      this.ready.set(player.playerId, { scenes: new Map(), extras: new Map(), camera: '' });
      this.sendAll(player.playerId);
      this.assetsChanged();
    } else if (message.type === 'scene-resync' && this.ready.has(player.playerId)) {
      this.ready.set(player.playerId, { scenes: new Map(), extras: new Map(), camera: '' });
      this.sendAll(player.playerId);
    }
  }

  onGone(player: SessionPlayer): void {
    this.ready.delete(player.playerId);
  }

  /** Tabletop published (or ended) the run. */
  private changed(): void {
    const next = this.options.board?.cutscene?.() ?? null;
    if (!next) {
      this.end();
      return;
    }
    if (this.run && this.run.cutscene.runId !== next.cutscene.runId) this.finish();
    this.run = next;
    const text = JSON.stringify(next.cutscene);
    // Tabletop may publish one change twice: told once.
    if (text !== this.runText) {
      this.runText = text;
      for (const playerId of this.admitted()) this.options.session.send(playerId, { v: 1, type: 'cutscene', cutscene: next.cutscene });
    }
    this.watch();
    // A map without a projection yet is sent at once (the player's board holds black for it); the rest is paced.
    if (Object.keys(next.maps).some((key) => !this.entries.has(key))) this.refresh();
    else this.refreshSoon();
    this.cameraMoved();
  }

  /** The run ended: players are told, and everything of it is dropped. */
  private end(): void {
    if (this.runText !== 'null') for (const playerId of this.admitted()) this.options.session.send(playerId, { v: 1, type: 'cutscene', cutscene: null });
    this.finish();
  }

  private finish(): void {
    const hadRun = this.run !== null || this.entries.size > 0;
    this.run = null;
    this.runText = 'null';
    this.entries.clear();
    this.unwatch();
    for (const sent of this.ready.values()) {
      sent.scenes.clear();
      sent.extras.clear();
      sent.camera = '';
    }
    if (this.sceneCooldown !== null) window.clearTimeout(this.sceneCooldown);
    if (this.cameraCooldown !== null) window.clearTimeout(this.cameraCooldown);
    this.sceneCooldown = this.cameraCooldown = null;
    this.sceneDirty = this.cameraDirty = false;
    if (hadRun) this.assetsChanged();
  }

  private admitted(): string[] {
    return this.options.session.getPlayers().filter((player) => player.status === 'admitted').map((player) => player.playerId);
  }

  private assetsChanged(): void {
    for (const listener of [...this.listeners]) listener();
  }

  // ── Watching the GM's tabs ─────────────────────────────────────────────────

  private tabsOf(path: string): TabInfo[] {
    return this.options.tabs?.tabs().filter((tab) => tab.mapPath === path) ?? [];
  }

  private unwatch(): void {
    this.watching.splice(0).forEach((stop) => stop());
  }

  /** Watches the tabs of this publication's maps, and what else changes a scene's projection, until the run ends. */
  private watch(): void {
    this.unwatch();
    const { tabs, board, assets, onSettings } = this.options;
    if (!tabs || !this.run) return;
    const views = new Set<string>();
    for (const path of Object.values(this.run.maps)) for (const tab of this.tabsOf(path)) views.add(tab.viewId);
    for (const viewId of views) this.watching.push(tabs.watch(viewId, () => this.refreshSoon()));
    this.watching.push(
      // A tab that goes live brings its map: sent without waiting for the pace.
      tabs.subscribeLive(() => this.refresh()),
      tabs.subscribeTabs(() => { this.watch(); this.refresh(); }),
      assets.onChange(() => this.refreshSoon()),
    );
    if (board) this.watching.push(board.subscribe(() => this.refreshSoon()));
    if (onSettings) this.watching.push(onSettings(() => this.refreshSoon()));
  }

  // ── The scenes ─────────────────────────────────────────────────────────────

  private refreshSoon(): void {
    if (this.sceneCooldown !== null) {
      this.sceneDirty = true;
      return;
    }
    this.refresh();
    this.sceneCooldown = window.setTimeout(() => {
      this.sceneCooldown = null;
      if (!this.sceneDirty) return;
      this.sceneDirty = false;
      this.refreshSoon();
    }, SCENE_INTERVAL_MS);
  }

  /** Every map of the run whose tab is live is projected; those whose projection changed go to the ready players. */
  private refresh(): void {
    const run = this.run;
    const { tabs, board } = this.options;
    if (!run || !tabs) return;
    // The map shown now first.
    const keys = Object.keys(run.maps).sort((a, b) => Number(b === run.cutscene.key) - Number(a === run.cutscene.key));
    for (const key of keys) {
      const path = run.maps[key]!;
      let snapshot: SceneSnapshot | null = null;
      for (const tab of this.tabsOf(path)) {
        snapshot = tabs.liveSnapshot(tab);
        if (snapshot) break;
      }
      if (!snapshot) continue;
      try {
        this.project(run, key, path, snapshot, board?.lookFor(path) ?? null);
      } catch (error) {
        console.error('[Atlas VTT Connect] Could not project a cutscene scene:', error);
      }
    }
  }

  private project(run: GmCutscene, key: string, path: string, snapshot: SceneSnapshot, look: ReturnType<BoardSource['lookFor']>): void {
    let entry = this.entries.get(key);
    if (!entry || entry.path !== path) {
      entry = { path, memo: createProjectionMemo(), scene: null, sceneText: '', extras: null, extrasText: '', parts: [], seq: 0, ids: new Set() };
      this.entries.set(key, entry);
    }
    const sceneId = `cutscene:${run.cutscene.runId}:${key}`;
    const { scene, extras } = projectCutscene(snapshot, { ...this.options.sceneOptions, assets: this.options.assets }, look, sceneId, entry.memo);
    if (sceneBytes(scene) > CUTSCENE_SCENE_BYTES) {
      console.warn('[Atlas VTT Connect] A cutscene scene is too large to send to players.');
      return;
    }
    const sceneText = JSON.stringify(scene);
    const extrasText = JSON.stringify(extras);
    if (sceneText === entry.sceneText && extrasText === entry.extrasText) return;
    if (extrasText !== entry.extrasText) {
      entry.seq = ++this.seq;
      entry.parts = boardParts(extras);
    }
    entry.scene = scene;
    entry.sceneText = sceneText;
    entry.extras = extras;
    entry.extrasText = extrasText;
    entry.ids = new Set([...sceneAssetIds(scene), ...boardAssetIds(extras)]);
    for (const playerId of this.ready.keys()) this.sendKey(playerId, run, key, entry);
    this.assetsChanged();
  }

  /** `key`'s scene and extras to `playerId`, each only when it differs from what they have. */
  private sendKey(playerId: string, run: GmCutscene, key: string, entry: Entry): void {
    const sent = this.ready.get(playerId);
    if (!sent || !entry.scene) return;
    const { runId } = run.cutscene;
    if (sent.scenes.get(key) !== entry.sceneText) {
      sent.scenes.set(key, entry.sceneText);
      this.options.session.send(playerId, { v: 1, type: 'cutscene-scene', runId, key, scene: entry.scene });
    }
    if (entry.extras && sent.extras.get(key) !== entry.extrasText) {
      sent.extras.set(key, entry.extrasText);
      entry.parts.forEach((extras, part) => {
        this.options.session.send(playerId, { v: 1, type: 'cutscene-extras', runId, key, seq: entry.seq, part, parts: entry.parts.length, extras });
      });
    }
  }

  /** Everything of the run to `playerId`: the map shown now first, then the rest, and the camera. */
  private sendAll(playerId: string): void {
    const run = this.run;
    if (!run) return;
    const keys = [...this.entries.keys()].sort((a, b) => Number(b === run.cutscene.key) - Number(a === run.cutscene.key));
    for (const key of keys) this.sendKey(playerId, run, key, this.entries.get(key)!);
    this.sendCamera(playerId);
  }

  // ── The live camera ────────────────────────────────────────────────────────

  private sendCamera(playerId: string): void {
    const run = this.run;
    const sent = this.ready.get(playerId);
    if (!run || run.cutscene.mode !== 'live' || !sent) return;
    const pose = this.options.board?.cutsceneCamera?.() ?? null;
    if (!pose) return;
    const text = JSON.stringify([run.cutscene.runId, pose]);
    if (text === sent.camera) return;
    sent.camera = text;
    this.options.session.send(playerId, { v: 1, type: 'cutscene-camera', runId: run.cutscene.runId, eye: { ...pose.eye }, target: { ...pose.target } });
  }

  private cameraMoved(): void {
    if (this.run?.cutscene.mode !== 'live' || this.ready.size === 0) return;
    if (this.cameraCooldown !== null) {
      this.cameraDirty = true;
      return;
    }
    for (const playerId of this.ready.keys()) this.sendCamera(playerId);
    this.cameraCooldown = window.setTimeout(() => {
      this.cameraCooldown = null;
      if (!this.cameraDirty) return;
      this.cameraDirty = false;
      this.cameraMoved();
    }, CAMERA_INTERVAL_MS);
  }
}
