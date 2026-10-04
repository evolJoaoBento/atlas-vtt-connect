/** The GM session's admission paths: a join, a returning player taking over their entry, the identity re-check and the admit itself. */
import { rejoinCheck, runReissue, setClient, type Entry, type LinkState } from './gmSessionEntries';
import { SESSION_LIMITS, type GmSessionOptions, type PlayerStatus, type SessionHandler } from './gmSessionTypes';
import { randomId } from './ids';
import { encodeControl, normalizePlayerName, type ControlMessage, type DenyReason } from './protocol';
import type { PeerLink } from './transport/types';

export type JoinMessage = Extract<ControlMessage, { type: 'join' }>;

/** What the admission paths use of the session that owns the entries. */
export interface AdmissionHost {
  readonly options: GmSessionOptions;
  readonly entries: Map<string, Entry>;
  readonly links: Map<PeerLink, LinkState>;
  readonly handlers: Set<SessionHandler>;
  isStopped(): boolean;
  refuse(link: PeerLink | null, reason: DenyReason): void;
  countStatus(status: PlayerStatus): number;
  changed(): void;
  broadcastPresence(): void;
  deny(playerId: string): void;
}

export function joinSession(host: AdmissionHost, link: PeerLink, state: LinkState, message: JoinMessage): void {
  if (state.joinTimer) window.clearTimeout(state.joinTimer);
  state.joinTimer = null;
  const name = normalizePlayerName(message.name);
  if (!name) {
    host.refuse(link, 'denied');
    return;
  }

  const known = [...host.entries.values()].find((entry) => entry.playerKey === message.playerKey);
  if (known) {
    const check = rejoinCheck(known, message.device);
    if (check === 'deny') host.refuse(link, 'denied');
    else if (check === 'reissue') reissue(host, link, state, known, message);
    else takeOver(host, link, state, known, message);
    return;
  }

  if (host.countStatus('admitted') >= SESSION_LIMITS.maxPlayers || host.countStatus('pending') >= SESSION_LIMITS.maxPendingRequests) {
    host.refuse(link, 'full');
    return;
  }
  const entry: Entry = {
    player: { playerId: randomId(), name, status: 'pending', ...(message.client.kind === 'obsidian' ? { client: 'obsidian' as const } : {}) },
    playerKey: message.playerKey,
    link,
    lastPong: Date.now(),
    requestTimer: null,
    device: message.device ?? null,
    table: null,
  };
  entry.requestTimer = window.setTimeout(() => host.deny(entry.player.playerId), SESSION_LIMITS.requestTimeoutMs);
  state.entry = entry;
  host.entries.set(entry.player.playerId, entry);
  host.changed();
  host.options.onJoinRequest({ ...entry.player }, entry.device);
}

/** Another tab of the same player, or a reconnect: the new link takes over. */
function takeOver(host: AdmissionHost, link: PeerLink, state: LinkState, known: Entry, message: JoinMessage): void {
  if (known.player.status === 'gone' && host.countStatus('admitted') >= SESSION_LIMITS.maxPlayers) {
    host.refuse(link, 'full');
    return;
  }
  const older = known.link;
  known.link = link;
  setClient(known.player, message.client.kind);
  state.entry = known;
  if (older && older !== link) {
    host.links.get(older)!.entry = null;
    older.send('control', encodeControl({ v: 1, type: 'bye', reason: 'replaced' }));
    older.close();
  }
  if (known.player.status === 'pending') {
    known.device = message.device ?? null;
    host.changed();
    return;
  }
  admit(host, known);
}

/** The same person on a new join: the owner checks the new device proof and signs a table proof for its nonce. */
function reissue(host: AdmissionHost, link: PeerLink, state: LinkState, known: Entry, message: JoinMessage): void {
  const device = message.device;
  if (!device) {
    host.refuse(link, 'denied');
    return;
  }
  runReissue(host.options, state, known, device, () => !host.isStopped() && host.links.has(link), (admission) => {
    if (!admission || host.entries.get(known.player.playerId) !== known) {
      host.refuse(link, 'denied');
      return;
    }
    known.device = device;
    known.table = admission.table;
    takeOver(host, link, state, known, message);
  });
}

export function admit(host: AdmissionHost, entry: Entry): void {
  entry.player.status = 'admitted';
  entry.lastPong = Date.now();
  entry.link?.send('control', encodeControl({
    v: 1, type: 'admitted', playerId: entry.player.playerId, session: { title: host.options.title },
    ...(entry.table ? { table: entry.table } : {}),
  }));
  host.changed();
  host.broadcastPresence();
  for (const handler of host.handlers) handler.onAdmitted?.({ ...entry.player });
}
