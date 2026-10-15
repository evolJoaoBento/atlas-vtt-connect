/** What the GM's session keeps per player and per connection, and how a returning player's identity is judged. */
import { SESSION_LIMITS, type Admission, type GmSessionOptions, type SessionPlayer } from './gmSessionTypes';
import type { DeviceProof, PresencePlayer, TableProof } from './protocol';
import type { PeerLink, Unsubscribe } from './transport/types';

export interface Entry {
  player: SessionPlayer;
  playerKey: string;
  link: PeerLink | null;
  lastPong: number;
  requestTimer: number | null;
  /** The device proof of the player's join, unchecked here (the owner checked it before giving a person id). */
  device: DeviceProof | null;
  /** The table proof sent on every admission; set with a person id. */
  table: TableProof | null;
  /** A waiting entry's earlier player of the same name, joined from another client: the one allowing takes over. */
  earlier: string | null;
}

/** Player names match regardless of case: "anna" coming back is Anna. */
export function sameName(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** The player in the session (not waiting) who already uses `name`, a disconnected one first; null when none. */
export function earlierOf(entries: Iterable<Entry>, name: string): Entry | null {
  const matches = [...entries].filter((entry) => entry.player.status !== 'pending' && sameName(entry.player.name, name));
  return matches.find((entry) => entry.player.status === 'gone') ?? matches[0] ?? null;
}

/** The player as the GM's UI sees them: a waiting one says whether their name is taken, and by whom. */
export function playerView(entries: ReadonlyMap<string, Entry>, entry: Entry): SessionPlayer {
  const player: SessionPlayer = { ...entry.player };
  const earlier = entry.player.status === 'pending' && entry.earlier ? entries.get(entry.earlier) : undefined;
  if (earlier && earlier.player.status !== 'pending') player.sameNameAs = earlier.player.status === 'gone' ? 'disconnected' : 'connected';
  return player;
}

/** A gone player with a person id whose device is the one joining: the same client after a reload, its identity checked by the owner. */
export function sameDevice(entries: Iterable<Entry>, device: DeviceProof | undefined): Entry | null {
  if (!device) return null;
  return [...entries].find((entry) => entry.player.status === 'gone' && entry.player.personId && entry.device?.key === device.key && entry.device.table === device.table) ?? null;
}

/** Per connection, before and after it joins. */
export interface LinkState {
  entry: Entry | null;
  invalid: number;
  /** A rejected message was logged for this connection already. */
  warned: boolean;
  joinTimer: number | null;
  /** A returning player's identity is being checked: no second join is read meanwhile. */
  joining: boolean;
  /** The time limit of that check; cleared with the connection. */
  reissueTimer: number | null;
  unsubscribe: Unsubscribe[];
}

/** Records which app a player joined from; a returning player may come back from the other one. */
export function setClient(player: SessionPlayer, kind: 'web' | 'obsidian'): void {
  if (kind === 'obsidian') player.client = 'obsidian';
  else delete player.client;
}

/**
 * How a player who is known by their session key comes back. Without a person id nothing is
 * checked. With one, the same device must present itself: the same proof is simply admitted again
 * (a reconnect within one join), a proof for a new join (a new nonce) is signed anew by the owner.
 */
export function rejoinCheck(entry: Entry, device: DeviceProof | undefined): 'open' | 'same' | 'reissue' | 'deny' {
  if (!entry.player.personId) {
    // A waiting request stays with the device it was made for; its proof is refreshed (a new join has a new nonce).
    return entry.player.status === 'pending' && (device?.key ?? null) !== (entry.device?.key ?? null) ? 'deny' : 'open';
  }
  const known = entry.device;
  if (!device || !known || device.table !== known.table || device.key !== known.key) return 'deny';
  return device.nonce === known.nonce && device.sig === known.sig ? 'same' : 'reissue';
}

/** The owner's admission for a returning person on a new join; null when it refuses, fails or names another person. */
export async function reissued(options: GmSessionOptions, known: Entry, device: DeviceProof): Promise<Admission | null> {
  if (!options.reissue) return null;
  try {
    const admission = await options.reissue({ ...known.player }, device);
    return admission?.personId === known.player.personId ? admission : null;
  } catch {
    return null;
  }
}

/** Everyone but the waiting, as players see them. */
export function presenceOf(entries: Iterable<Entry>): PresencePlayer[] {
  return [...entries].filter((entry) => entry.player.status !== 'pending').map((entry): PresencePlayer => ({
    playerId: entry.player.playerId, name: entry.player.name, connected: entry.link !== null,
    ...(entry.player.personId ? { personId: entry.player.personId } : {}),
  }));
}

/** Ends a link's pending identity check (its connection closed or the session stopped): nothing more comes of it. */
export function cancelReissue(state: LinkState): void {
  if (state.reissueTimer !== null) window.clearTimeout(state.reissueTimer);
  state.reissueTimer = null;
}

/**
 * Has the owner check a returning person's new device proof, within a time limit. `done` gets the
 * admission, or null to deny; it is never called once `isOpen` says the connection or the session
 * is gone, nor twice.
 */
export function runReissue(
  options: GmSessionOptions, state: LinkState, known: Entry, device: DeviceProof,
  isOpen: () => boolean, done: (admission: Admission | null) => void,
): void {
  state.joining = true;
  let settled = false;
  const settle = (admission: Admission | null): void => {
    if (settled) return;
    settled = true;
    cancelReissue(state);
    state.joining = false;
    if (isOpen()) done(admission);
  };
  state.reissueTimer = window.setTimeout(() => settle(null), SESSION_LIMITS.reissueTimeoutMs);
  void reissued(options, known, device).then(settle);
}
