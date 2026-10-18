/**
 * Sends a player the note of a readable pin they open (`note-request` → `pin-note`). The pin must be one their own
 * scene was last sent (its alias in their slot's `lastSent`), and the GM's scene must still offer it: readable, not
 * for the GM only, linking that note. The answer goes to that player alone, scoped by scene and pin, so a player who
 * moved on drops it. Notes are read afresh each time, so the GM's edits show the next time it is opened.
 */
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { RateLimit } from '../rateLimit';
import { notePathOf } from '../scene/projectForPlayers';
import type { SceneSession } from '../scene/sceneContracts';
import type { SlotProjection } from '../scene/slotViews';
import { PIN_NOTE_LIMITS, type PinNote } from './pinNotes';

export interface NoteHostOptions {
  session: SceneSession;
  projection: Pick<SlotProjection, 'slotOf' | 'shownSnapshot'>;
  /** The note a pin links, from the map at `mapPath`, as players read it; null where it cannot be read. */
  read(notePath: string, mapPath: string): Promise<PinNote | null>;
  now?: () => number;
}

/** Whether the GM's scene still offers a readable pin linking `notePath`. */
function stillOffered(pins: unknown, notePath: string): boolean {
  if (typeof pins !== 'object' || pins === null) return false;
  return Object.values(pins as Record<string, unknown>).some((value) => {
    if (typeof value !== 'object' || value === null) return false;
    const pin = value as { notePath?: unknown; readable?: unknown; gmOnly?: unknown };
    return pin.notePath === notePath && pin.readable === true && pin.gmOnly !== true;
  });
}

export class NoteHost implements SessionHandler {
  private stopSession: (() => void) | null = null;
  private readonly limit = new RateLimit(PIN_NOTE_LIMITS.requestsPerSecond);

  constructor(private readonly options: NoteHostOptions) {}

  start(): void {
    this.stopSession ??= this.options.session.use(this);
  }

  stop(): void {
    this.stopSession?.();
    this.stopSession = null;
  }

  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'note-request' || !this.limit.allow(player.playerId, this.options.now?.() ?? Date.now())) return;
    const { sceneId, pinId } = message;
    const answer = (note: PinNote | null): void => this.options.session.send(player.playerId, { v: 1, type: 'pin-note', sceneId, pinId, note });
    const found = this.notePath(player.playerId, sceneId, pinId);
    if (!found) {
      answer(null);
      return;
    }
    void this.options.read(found.notePath, found.mapPath).catch((error: unknown) => {
      console.warn('[Atlas VTT Connect] Could not read a pin note for a player:', error);
      return null;
    }).then((note) => {
      // Read meanwhile: still theirs to read only while the pin is still on what their scene shows.
      answer(this.notePath(player.playerId, sceneId, pinId)?.notePath === found.notePath ? note : null);
    });
  }

  /** The note the pin `pinId` of the player's scene links, while it is theirs to read; null otherwise. */
  private notePath(playerId: string, sceneId: string, pinId: string): { notePath: string; mapPath: string } | null {
    const slot = this.options.projection.slotOf(playerId);
    if (!slot?.lastSent || slot.sceneId !== sceneId) return null;
    const pin = slot.lastSent.pins?.find((candidate) => candidate.id === pinId);
    const notePath = pin ? notePathOf(pin) : null;
    if (!notePath) return null;
    const snapshot = this.options.projection.shownSnapshot(slot.sceneId);
    const pins = (snapshot?.objects as { pins?: unknown } | undefined)?.pins;
    return stillOffered(pins, notePath) ? { notePath, mapPath: slot.mapPath } : null;
  }
}
