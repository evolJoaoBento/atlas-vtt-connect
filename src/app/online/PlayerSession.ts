/**
 * The player's side of an online session: join a GM, wait for approval, keep
 * the player list, and reconnect after a drop. Shared with the web player page,
 * so it imports nothing from Obsidian.
 */
import type { DiceSelection } from '@atlas-vtt/shared/rules';
import { decodeControl, encodeControl, type DeviceProof, type PresencePlayer, type TableProof } from './protocol';
import { PlayerSceneInbox } from './playerSessionScene';
import type { SceneCamera } from './scene/sceneCamera';
import type { PlayerScene, ScenePoint } from './scene/sceneTypes';
import type { DiceLogEntry, PlayerLaser } from './tools/toolMessages';
import { channelPort } from './transport/channelPort';
import type { ChannelPort, ClientTransport, PeerLink } from './transport/types';

export type PlayerStatus = 'connecting' | 'waiting' | 'admitted' | 'denied' | 'lost';

export interface PlayerSessionState {
  status: PlayerStatus;
  playerId: string | null;
  title: string | null;
  players: PresencePlayer[];
  /**
   * Why the session is denied or lost: a deny reason, `ended`, `replaced`,
   * `unreachable` (never got in) or `connection-lost` (was in, retrying gave up).
   */
  reason: string | null;
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000] as const;
export const RECONNECT_GIVE_UP_MS = 300_000;

/** The image loader's view of the session: the session only passes assets-channel data through. */
export interface PlayerAssetHandler {
  /** Admitted on a link: `send` reaches the GM's assets channel on that link until `disconnected`. */
  connected(send: (data: string) => void): void;
  receive(data: unknown): void;
  disconnected(): void;
}

/** Sharing between Obsidian clients: gets the assets channel while admitted, beside the image loader. */
export interface PlayerShareHandler {
  connected(port: ChannelPort): void;
  receive(data: unknown): void;
  disconnected(): void;
}

export interface PlayerSessionOptions {
  hostId: string;
  name: string;
  playerKey: string;
  clientVersion: string;
  /** The app that joins: the web page (the default) or Atlas in Obsidian. */
  clientKind?: 'web' | 'obsidian';
  transport: ClientTransport;
  onChange(state: PlayerSessionState): void;
  /** The presented scene changed: a snapshot or patch applied, or null when the GM shows none. */
  onScene?(scene: PlayerScene | null): void;
  /** The GM's latest camera, whatever its scene: the map view uses it once that scene is shown. */
  onCamera?(camera: SceneCamera): void;
  /** The tokens this player may move: the GM's latest `token-control` list; empty once the session is over. */
  onControl?(tokenIds: readonly string[]): void;
  /** The GM refused this player's move of the token. */
  onMoveRefused?(tokenId: string): void;
  /** The scene shown was paused (the GM is on another scene) or is live again. */
  onSceneState?(paused: boolean): void;
  /** Dice log entries from the GM, newest first; `replay` replaces the log (sent on every admission). */
  onDiceLog?(entries: readonly DiceLogEntry[], replay: boolean): void;
  /** Someone else's laser: its new points, for the scene `sceneId`. */
  onLaser?(laser: PlayerLaser): void;
  /** An Obsidian player's device proof for the link's table, sent with every join of this session. */
  device?: DeviceProof;
  /** Gets the assets channel while admitted (the join page's image loader). */
  assets?: PlayerAssetHandler;
  /** Sharing's end of the assets channel (Obsidian clients only). */
  share?: PlayerShareHandler;
}

export class PlayerSession {
  state: PlayerSessionState = { status: 'connecting', playerId: null, title: null, players: [], reason: null };
  private link: PeerLink | null = null;
  private started = false;
  private finished = false;
  private wasAdmitted = false;
  private attempt = 0;
  private droppedAt = 0;
  private retryTimer: number | null = null;
  private assetLink: PeerLink | null = null;
  private controlled: readonly string[] = [];
  private tableProof: TableProof | null = null;

  private readonly inbox: PlayerSceneInbox;

  constructor(private readonly options: PlayerSessionOptions) {
    this.inbox = new PlayerSceneInbox({
      sendResync: (seq) => this.link?.send('control', encodeControl({ v: 1, type: 'scene-resync', seq })),
      onScene: (scene) => this.options.onScene?.(scene),
      onCamera: (camera) => this.options.onCamera?.(camera),
      onPaused: (paused) => this.options.onSceneState?.(paused),
    });
  }

  /** Whether the scene shown is paused: the GM is on another scene, so moves are refused. */
  get paused(): boolean {
    return this.inbox.paused;
  }

  /** The presented scene as this player has it; null while the GM shows none. */
  get scene(): PlayerScene | null {
    return this.inbox.scene;
  }

  /** The GM's table proof from the latest admission; null before one or from a GM without a table. */
  get table(): TableProof | null {
    return this.tableProof;
  }

  /** The GM's latest camera; null before the first. */
  get camera(): SceneCamera | null {
    return this.inbox.camera;
  }

  /**
   * Sends one drop of a token for the scene this player has. False when it cannot go
   * (not admitted, no link, no scene), so the drag sends nothing. The GM checks it.
   */
  sendTokenMove(tokenId: string, x: number, y: number): boolean {
    const scene = this.inbox.scene;
    if (this.finished || this.state.status !== 'admitted' || !this.link || !scene) return false;
    this.link.send('control', encodeControl({ v: 1, type: 'token-move', sceneId: scene.sceneId, tokenId, x, y }));
    return true;
  }

  /** Asks the GM to roll; false when it cannot go (not admitted, no link). */
  sendDiceRoll(dice: DiceSelection, modifier: number): boolean {
    if (this.finished || this.state.status !== 'admitted' || !this.link) return false;
    this.link.send('control', encodeControl({ v: 1, type: 'dice-roll', dice, modifier }));
    return true;
  }

  /** Sends new points of this player's laser for the scene they have; false when it cannot go. */
  sendLaser(points: readonly ScenePoint[], lifted: boolean, dt?: readonly number[], color?: string): boolean {
    const scene = this.inbox.scene;
    if (this.finished || this.state.status !== 'admitted' || !this.link || !scene) return false;
    this.link.send('control', encodeControl({ v: 1, type: 'laser', sceneId: scene.sceneId, points: [...points], lifted, ...(dt ? { dt: [...dt] } : {}), ...(color ? { color } : {}) }));
    return true;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.update({ status: 'connecting' });
    void this.connect();
  }

  stop(): void {
    this.finished = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.inbox.dispose();
    this.leaveAssets();
    this.link?.send('control', encodeControl({ v: 1, type: 'bye', reason: 'left' }));
    this.link?.close();
  }

  private async connect(): Promise<void> {
    let link: PeerLink;
    try {
      link = await this.options.transport.connect(this.options.hostId);
    } catch {
      this.dropped();
      return;
    }
    if (this.finished) {
      link.close();
      return;
    }
    this.link = link;
    link.onMessage((channel, data) => {
      if (channel === 'control') this.receive(link, data);
      else if (this.assetLink === link && !this.finished) {
        this.options.assets?.receive(data);
        this.options.share?.receive(data);
      }
    });
    link.onClose(() => {
      if (this.assetLink === link) this.leaveAssets();
      if (this.link === link) { this.link = null; this.dropped(); }
    });
    link.send('control', encodeControl({
      v: 1, type: 'join', name: this.options.name, playerKey: this.options.playerKey,
      client: { kind: this.options.clientKind ?? 'web', version: this.options.clientVersion },
      ...(this.options.device ? { device: this.options.device } : {}),
    }));
    if (!this.wasAdmitted && this.state.status === 'connecting') this.update({ status: 'waiting' });
  }

  private receive(link: PeerLink, data: unknown): void {
    if (this.finished || this.link !== link) return;
    const decoded = decodeControl(data);
    this.inbox.invalid(decoded);
    if (decoded.kind !== 'message') return;
    const message = decoded.message;
    if (this.inbox.receive(message)) return;
    switch (message.type) {
      case 'admitted':
        this.wasAdmitted = true;
        this.attempt = 0;
        this.tableProof = message.table ?? null;
        this.update({ status: 'admitted', playerId: message.playerId, title: message.session.title, reason: null });
        if (this.assetLink !== link) {
          // A repeated admission on the same link must not start the handler over.
          this.assetLink = link;
          this.options.assets?.connected((data) => link.send('assets', data));
          this.options.share?.connected(channelPort(link, 'assets'));
        }
        break;
      case 'denied':
        this.finish('denied', message.reason);
        link.close();
        break;
      case 'presence':
        this.update({ players: message.players });
        break;
      case 'ping':
        link.send('control', encodeControl({ v: 1, type: 'pong', t: message.t }));
        break;
      case 'bye':
        // A newer tab of this player took over, or the GM ended the session.
        this.finish('lost', message.reason === 'replaced' ? 'replaced' : 'ended');
        link.close();
        break;
      case 'token-control':
        this.setControlled(message.tokenIds);
        break;
      case 'token-move-refused':
        this.options.onMoveRefused?.(message.tokenId);
        break;
      case 'dice-log':
        this.options.onDiceLog?.(message.entries, message.replay);
        break;
      case 'laser':
        // Only the GM's relays carry `from`.
        if (message.from !== undefined) {
          this.options.onLaser?.({ from: message.from, sceneId: message.sceneId, points: message.points, lifted: message.lifted, ...(message.dt ? { dt: message.dt } : {}), ...(message.color ? { color: message.color } : {}) });
        }
        break;
      default:
        break;
    }
  }

  /** The link closed or could not be made: retry if we were in, else stop. */
  private dropped(): void {
    if (this.finished) return;
    if (!this.wasAdmitted) {
      this.finish('lost', 'unreachable');
      return;
    }
    if (this.attempt === 0) this.droppedAt = Date.now();
    if (Date.now() - this.droppedAt >= RECONNECT_GIVE_UP_MS) {
      this.finish('lost', 'connection-lost');
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)]!;
    this.attempt++;
    this.update({ status: 'connecting' });
    this.retryTimer = window.setTimeout(() => void this.connect(), delay);
  }

  private finish(status: 'denied' | 'lost', reason: string): void {
    this.finished = true;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.inbox.dispose();
    this.leaveAssets();
    this.setControlled([]);
    this.update({ status, reason });
  }

  private leaveAssets(): void {
    if (!this.assetLink) return;
    this.assetLink = null;
    this.options.assets?.disconnected();
    this.options.share?.disconnected();
  }

  /** Keeps the GM's list; an empty list after an empty one tells nobody. */
  private setControlled(tokenIds: readonly string[]): void {
    if (tokenIds.length === 0 && this.controlled.length === 0) return;
    this.controlled = tokenIds;
    this.options.onControl?.(tokenIds);
  }

  private update(partial: Partial<PlayerSessionState>): void {
    this.state = { ...this.state, ...partial };
    this.options.onChange(this.state);
  }
}
