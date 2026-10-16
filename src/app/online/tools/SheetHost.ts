/**
 * Sends each admitted player the sheets of the tokens they control (`token-sheets`): the exact numbers of every
 * resource the token has and its linked stat block, as `tools/sheets.ts` whitelists it. Only to that player, only for
 * tokens they control that their own scene shows them, and never part of a scene's projection. Sent on admission,
 * when their assignments change, when they move to another scene, and after each projection of their scene when
 * something on their sheets changed (a hit lowers HP). A scene whose snapshot is not at hand (parked, loading) keeps
 * the sheets its players have.
 *
 * Rolls from a sheet (`sheet-roll`) are found again on the GM's own copy of the stat block (`sheetRollFormula`) and
 * rolled through the dice host as the player's roll, so a player rolls only what their sheet offers.
 */
import type { Character, ResourceDefinition, SceneSnapshot, TokenEntity } from '@atlas-vtt/api-types';
import type { TokenControl } from '../control/TokenControl';
import type { SessionHandler, SessionPlayer } from '../GmSession';
import type { ControlMessage } from '../protocol';
import { MAX_CONTROL_MESSAGE_BYTES } from '../protocol';
import type { SceneSession } from '../scene/sceneContracts';
import { admitted } from '../scene/slotAudience';
import type { SlotChange, SlotProjection } from '../scene/slotViews';
import { RateLimit } from '../rateLimit';
import { buildSheet, SHEET_LIMITS, sheetColor, sheetRollFormula, sheetRollLabel, type PlayerSheet, type SheetResource, type TokenSheet } from './sheets';

/** A sheets message stays under this, well inside a control message, with room for the envelope. */
const SHEETS_BUDGET_BYTES = Math.floor(MAX_CONTROL_MESSAGE_BYTES * 0.75);
/** How long a stat block read stays fresh without a change heard from the statblock plugin. */
const SHEET_CACHE_MS = 30_000;

export interface SheetHostOptions {
  session: SceneSession;
  control: TokenControl;
  projection: Pick<SlotProjection, 'slotOf' | 'shownSnapshot' | 'audience' | 'onSlotChange'>;
  /** The resources of the collection holding the map at `mapPath`. */
  resources(mapPath: string | null): readonly ResourceDefinition[];
  /** The creature a token links (Fantasy Statblocks' shape), or null: none linked, or it cannot be read. */
  readStatblock(token: Character): unknown;
  /** Calls `listener` when stat blocks may read differently (the statblock plugin updated); returns the stop. */
  onStatblocksChanged?(listener: () => void): () => void;
  /** Rolls a formula as the player's roll, named `label` in the log; false when refused. Without it sheets offer no rolls. */
  rollFor?(player: SessionPlayer, formula: string, label: string): boolean;
  now?: () => number;
}

const isCharacter = (token: TokenEntity | undefined): token is Character => token?.kind === 'character';

function displayName(token: Character): string | null {
  const name = typeof token.name === 'string' ? token.name.trim() : '';
  if (name) return name.slice(0, SHEET_LIMITS.name);
  const statblockName = typeof token.statblockName === 'string' ? token.statblockName.trim() : '';
  return statblockName ? statblockName.slice(0, SHEET_LIMITS.name) : null;
}

/** The token's numbers for every resource of the collection it has a value for. */
function resourcesOf(token: Character, definitions: readonly ResourceDefinition[]): SheetResource[] {
  const values = typeof token.resources === 'object' && token.resources !== null ? token.resources as Record<string, unknown> : {};
  const found: SheetResource[] = [];
  for (const definition of definitions) {
    const value = values[definition.key] as { current?: unknown; max?: unknown } | undefined;
    const max = typeof value?.max === 'number' && Number.isFinite(value.max) ? value.max : null;
    const current = definition.direction === 'static' ? max : typeof value?.current === 'number' && Number.isFinite(value.current) ? value.current : null;
    if (max === null || current === null) continue;
    const color = sheetColor(definition.color);
    found.push({ name: definition.name.slice(0, 60), current, max, ...(color ? { color } : {}) });
    if (found.length >= SHEET_LIMITS.resources) break;
  }
  return found;
}

/** Keeps a list of sheets inside the budget: the longest stat blocks lose their sections first, then their stat block. */
function fitSheets(entries: TokenSheet[]): TokenSheet[] {
  const size = (list: TokenSheet[]): number => new TextEncoder().encode(JSON.stringify(list)).length;
  let fitted = entries;
  while (size(fitted) > SHEETS_BUDGET_BYTES) {
    const largest = fitted.reduce<{ index: number; bytes: number }>((best, entry, index) => {
      const bytes = entry.sheet ? JSON.stringify(entry.sheet).length : 0;
      return bytes > best.bytes ? { index, bytes } : best;
    }, { index: -1, bytes: 0 });
    if (largest.index < 0) return fitted.slice(0, Math.max(0, fitted.length - 1));
    fitted = fitted.map((entry, index) => {
      if (index !== largest.index || !entry.sheet) return entry;
      return entry.sheet.sections.length > 0 ? { ...entry, sheet: { ...entry.sheet, sections: entry.sheet.sections.slice(0, -1) } } : { ...entry, sheet: null };
    });
  }
  return fitted;
}

export class SheetHost implements SessionHandler {
  private readonly stops: Array<() => void> = [];
  /** What each player was sent last (its JSON), so a projection that changes nothing for them sends nothing. */
  private readonly sent = new Map<string, string>();
  private readonly cache = new Map<string, { at: number; sheet: PlayerSheet | null }>();
  private readonly limit = new RateLimit(SHEET_LIMITS.rollsPerSecond);

  constructor(private readonly options: SheetHostOptions) {}

  start(): void {
    if (this.stops.length > 0) return;
    const { session, control, projection } = this.options;
    this.stops.push(
      session.use(this),
      control.onChange((playerIds) => playerIds.forEach((playerId) => this.sendIfChanged(playerId))),
      projection.onSlotChange((change) => this.slotChanged(change)),
    );
    const stopStatblocks = this.options.onStatblocksChanged?.(() => {
      this.cache.clear();
      for (const playerId of admitted(session.getPlayers())) this.sendIfChanged(playerId);
    });
    if (stopStatblocks) this.stops.push(stopStatblocks);
  }

  stop(): void {
    this.stops.splice(0).forEach((stop) => stop());
    this.sent.clear();
    this.cache.clear();
  }

  onAdmitted(player: SessionPlayer): void {
    // A reconnect or a new tab has none of what was sent before.
    this.sent.delete(player.playerId);
    this.sendIfChanged(player.playerId);
  }

  onGone(player: SessionPlayer): void {
    this.sent.delete(player.playerId);
  }

  onMessage(player: SessionPlayer, message: ControlMessage): void {
    if (message.type !== 'sheet-roll' || !this.options.rollFor) return;
    if (!this.options.control.controls(player.playerId, message.tokenId) || !this.limit.allow(player.playerId, this.now())) return;
    const scene = this.sceneOf(player.playerId);
    const token = scene?.snapshot.objects.tokens[message.tokenId];
    if (!scene || !isCharacter(token) || !Object.hasOwn(scene.shown, message.tokenId)) return;
    // Read afresh: the roll is what the stat block says now.
    const sheet = buildSheet(this.read(token), displayName(token));
    const formula = sheet ? sheetRollFormula(sheet, message.roll) : null;
    if (!sheet || !formula) return;
    this.options.rollFor(player, formula, `${player.name}: ${sheetRollLabel(sheet, message.roll)}`.slice(0, 40));
  }

  playersChanged(players: readonly SessionPlayer[]): void {
    this.limit.retain(new Set(players.map((player) => player.playerId)));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private slotChanged(change: SlotChange): void {
    if (change.kind === 'moved') this.sendIfChanged(change.playerId);
    else if (change.kind === 'projected') {
      // The hub tells its listeners just before it sends the projection: the sheets go right after it.
      const { sceneId } = change.slot;
      void Promise.resolve().then(() => {
        for (const playerId of this.options.projection.audience(sceneId)) this.sendIfChanged(playerId);
      });
    }
  }

  /** The player's scene as the GM has it now, with the tokens their projection shows; null while it is not at hand. */
  private sceneOf(playerId: string): { snapshot: SceneSnapshot; shown: Record<string, unknown>; mapPath: string } | null {
    const slot = this.options.projection.slotOf(playerId);
    if (!slot?.lastSent) return null;
    const snapshot = this.options.projection.shownSnapshot(slot.sceneId);
    return snapshot ? { snapshot, shown: slot.lastSent.tokens, mapPath: slot.mapPath } : null;
  }

  private read(token: Character): unknown {
    try {
      return this.options.readStatblock(token);
    } catch (error) {
      console.warn('[Atlas VTT Connect] Could not read a stat block for a player:', error);
      return null;
    }
  }

  private sheetOf(token: Character): PlayerSheet | null {
    const path = typeof token.statblockPath === 'string' ? token.statblockPath : '';
    const key = path || (typeof token.statblockName === 'string' ? `name:${token.statblockName}` : '');
    if (!key) return null;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.at < SHEET_CACHE_MS) return cached.sheet;
    const sheet = buildSheet(this.read(token), displayName(token));
    this.cache.set(key, { at: this.now(), sheet });
    return sheet;
  }

  /** The player's sheets now; null while their scene is not at hand (they keep what they have). */
  private sheetsOf(playerId: string): TokenSheet[] | null {
    const controlled = this.options.control.tokensOf(playerId);
    if (controlled.length === 0) return [];
    const scene = this.sceneOf(playerId);
    if (!scene) return null;
    const definitions = this.options.resources(scene.mapPath || null);
    const entries: TokenSheet[] = [];
    for (const tokenId of controlled) {
      const token = scene.snapshot.objects.tokens[tokenId];
      if (!Object.hasOwn(scene.shown, tokenId) || !isCharacter(token)) continue;
      entries.push({ tokenId, name: displayName(token), resources: resourcesOf(token, definitions), sheet: this.sheetOf(token) });
      if (entries.length >= SHEET_LIMITS.tokens) break;
    }
    return fitSheets(entries);
  }

  private sendIfChanged(playerId: string): void {
    const entries = this.sheetsOf(playerId);
    if (entries === null) return;
    const json = JSON.stringify(entries);
    if (this.sent.get(playerId) === json) return;
    this.sent.set(playerId, json);
    this.options.session.send(playerId, { v: 1, type: 'token-sheets', entries });
  }
}
