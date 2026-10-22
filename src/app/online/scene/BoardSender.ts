/**
 * Tabletop's 3D board for the players who show it. Every admitted player is told whether the GM can send the board
 * (`board-offer`: Tabletop is there and shares its board) and told again when that changes. A player showing the board
 * asks for it (`board-request`); from then on it gets its scene's board extras whenever they change (`board-extras`,
 * in parts when large, all of one `seq`) and the GM's 3D camera of that scene, at most every 100 ms with the last move
 * always included (`board-camera`). A player who stops asking, or leaves, gets nothing more. Where the GM takes
 * players' physical rolls, the offer says so (`diceResults`) with the dice rules of the player's map (`diceRules`), as
 * the GM judges their rolls by. A `GmSession` handler.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { offeredDiceRules } from '../tools/physicalRolls';
import type { OfferedDiceRules } from '../tools/toolMessages';
import { BOARD_PART_LIMITS, type BoardCamera, type BoardExtras } from './boardTypes';
import type { BoardSource, SceneSession } from './sceneSources';
import type { SlotChange, SlotProjection, SlotView } from './slotViews';

export const BOARD_CAMERA_INTERVAL_MS = 100;

export interface BoardSenderOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'onSlotChange'>;
  /** Tabletop's board; without it every player is told no. */
  board: BoardSource | null;
  /** The dice rules of the collection holding `mapPath`; given when the GM takes players' physical rolls (`dice-result`). */
  diceRules?: (mapPath: string | null) => OfferedDiceRules;
}

/** What one part may weigh as JSON, well under the control message's cap with its envelope and non-ASCII text. */
export const BOARD_PART_BYTES = 180 * 1024;

/**
 * `extras` cut into parts no larger than one message may carry, by size as much as by count; at least one part. The
 * first part carries the materials and the scene's light; walls, then lights, then props fill the parts in order.
 */
export function boardParts(extras: BoardExtras): BoardExtras[] {
  const empty = (first: boolean): BoardExtras => ({ ...extras, walls: [], lights: [], props: [], materials: first ? extras.materials.slice(0, BOARD_PART_LIMITS.materials) : [] });
  const size = (value: unknown): number => JSON.stringify(value).length + 1;
  const parts: BoardExtras[] = [empty(true)];
  let current = parts[0]!;
  let used = size(current);
  const place = <K extends 'walls' | 'lights' | 'props'>(key: K, item: BoardExtras[K][number], cap: number): void => {
    const weight = size(item);
    if (used + weight > BOARD_PART_BYTES || (current[key] as unknown[]).length >= cap) {
      if (parts.length >= BOARD_PART_LIMITS.parts) return;
      current = empty(false);
      parts.push(current);
      used = size(current);
    }
    (current[key] as unknown[]).push(item);
    used += weight;
  };
  for (const wall of extras.walls) place('walls', wall, BOARD_PART_LIMITS.walls);
  for (const light of extras.lights) place('lights', light, BOARD_PART_LIMITS.lights);
  for (const prop of extras.props) place('props', prop, BOARD_PART_LIMITS.props);
  return parts;
}

export class BoardSender implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  /** The players who asked, with what each was last sent (as text) of the board and of the camera. */
  private readonly asking = new Map<string, { board: string; camera: string }>();
  private offered: boolean | null = null;
  private seq = 0;
  private cooldown: number | null = null;
  private dirty = false;

  constructor(private readonly options: BoardSenderOptions) {}

  start(): void {
    const { board, session, projection } = this.options;
    this.stops.push(session.use(this), projection.onSlotChange((change) => this.changed(change)));
    if (board) this.stops.push(board.subscribe(() => this.availabilityChanged()), board.subscribeCamera(() => this.cameraMoved()));
    this.offered = this.available();
  }

  stop(): void {
    if (this.cooldown !== null) window.clearTimeout(this.cooldown);
    this.cooldown = null;
    this.stops.splice(0).forEach((stop) => stop());
    this.asking.clear();
  }

  onAdmitted(player: SessionPlayer): void {
    this.offer(player.playerId, this.available());
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type === 'board-request') {
      if (!message.on) {
        this.asking.delete(player.playerId);
        return;
      }
      if (!this.available()) return;
      this.asking.set(player.playerId, { board: '', camera: '' });
      this.sendBoard(player.playerId, this.options.projection.slotOf(player.playerId));
      this.sendCamera(player.playerId);
    } else if (message.type === 'scene-resync' && this.asking.has(player.playerId)) {
      this.asking.set(player.playerId, { board: '', camera: '' });
      this.sendBoard(player.playerId, this.options.projection.slotOf(player.playerId));
      this.sendCamera(player.playerId);
    }
  }

  onGone(player: SessionPlayer): void {
    this.asking.delete(player.playerId);
  }

  private available(): boolean {
    return this.options.board?.available() ?? false;
  }

  /** The offer for `playerId`, with the dice rules of their scene's map where the GM takes physical rolls. */
  private offer(playerId: string, available: boolean): void {
    const { diceRules } = this.options;
    const dice = diceRules ? { diceResults: true as const, diceRules: offeredDiceRules(diceRules(this.options.projection.slotOf(playerId)?.mapPath || null)) } : {};
    this.options.session.send(playerId, { v: 1, type: 'board-offer', available, ...dice });
  }

  private availabilityChanged(): void {
    const available = this.available();
    if (available === this.offered) return;
    this.offered = available;
    for (const player of this.options.session.getPlayers()) this.offer(player.playerId, available);
    if (!available) this.asking.clear();
  }

  private changed(change: SlotChange): void {
    if (change.kind === 'projected') {
      for (const playerId of this.asking.keys()) {
        if (this.options.projection.slotOf(playerId)?.sceneId === change.slot.sceneId) this.sendBoard(playerId, change.slot);
      }
    } else if (change.kind === 'moved' && this.asking.has(change.playerId)) {
      this.sendBoard(change.playerId, change.to);
      this.sendCamera(change.playerId);
    }
  }

  /** The board of `slot` to `playerId`, when it differs from what they have. */
  private sendBoard(playerId: string, slot: SlotView | null): void {
    const kept = this.asking.get(playerId);
    if (!kept) return;
    const extras = slot?.board ?? null;
    const text = JSON.stringify(extras);
    if (text === kept.board) return;
    kept.board = text;
    const seq = ++this.seq;
    const parts = extras ? boardParts(extras) : [null];
    parts.forEach((part, index) => {
      this.options.session.send(playerId, { v: 1, type: 'board-extras', seq, part: index, parts: parts.length, extras: part });
    });
  }

  /** The GM's 3D camera of `playerId`'s scene, when it differs from what they have. */
  private sendCamera(playerId: string): void {
    const kept = this.asking.get(playerId);
    if (!kept) return;
    const slot = this.options.projection.slotOf(playerId);
    const pose = slot ? this.options.board?.camera(slot.mapPath) ?? null : null;
    const camera: BoardCamera | null = slot && pose ? { sceneId: slot.sceneId, eye: { ...pose.eye }, target: { ...pose.target } } : null;
    const text = JSON.stringify(camera);
    if (text === kept.camera) return;
    kept.camera = text;
    this.options.session.send(playerId, { v: 1, type: 'board-camera', camera });
  }

  private cameraMoved(): void {
    if (this.asking.size === 0) return;
    if (this.cooldown !== null) {
      this.dirty = true;
      return;
    }
    for (const playerId of this.asking.keys()) this.sendCamera(playerId);
    this.cooldown = window.setTimeout(() => {
      this.cooldown = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.cameraMoved();
    }, BOARD_CAMERA_INTERVAL_MS);
  }
}
