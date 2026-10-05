import { admit, joinSession, type AdmissionHost } from './gmSessionAdmission';
import { cancelReissue, presenceOf, type Entry, type LinkState } from './gmSessionEntries';
import { SESSION_LIMITS, type Admission, type GmSessionOptions, type PlayerStatus, type SessionHandler, type SessionPlayer } from './gmSessionTypes';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage, type DenyReason, type DeviceProof } from './protocol';
import { channelPort } from './transport/channelPort';
import type { ChannelPort, HostTransport, PeerLink, Unsubscribe } from './transport/types';

export { SESSION_LIMITS } from './gmSessionTypes';
export type { Admission, GmSessionOptions, PlayerStatus, SessionHandler, SessionPlayer } from './gmSessionTypes';

/**
 * The GM's side of an online session: who may join, who is here, and a hook
 * for later pieces to send and receive game messages. It never learns about maps.
 */
export class GmSession {
  private readonly entries = new Map<string, Entry>();
  private readonly links = new Map<PeerLink, LinkState>();
  private readonly handlers = new Set<SessionHandler>();
  private pingTimer: number | null = null;
  private stopTransport: Unsubscribe | null = null;
  private stopped = false;

  /** What the admission paths (`gmSessionAdmission.ts`) use of this session. */
  private readonly host: AdmissionHost;

  constructor(private readonly transport: HostTransport, private readonly options: GmSessionOptions) {
    this.host = {
      options, entries: this.entries, links: this.links, handlers: this.handlers,
      isStopped: () => this.stopped,
      refuse: (link, reason) => this.refuse(link, reason),
      countStatus: (status) => this.countStatus(status),
      changed: () => this.changed(),
      broadcastPresence: () => this.broadcastPresence(),
      deny: (playerId) => this.deny(playerId),
    };
  }

  start(): void {
    if (this.stopped || this.stopTransport) return;
    this.stopTransport = this.transport.onConnection((link) => this.accept(link));
    this.pingTimer = window.setInterval(() => this.pingAll(), SESSION_LIMITS.pingIntervalMs);
  }

  use(handler: SessionHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  getPlayers(): SessionPlayer[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.player }));
  }

  /** Admits a waiting player; `admission` gives them a person id and tells them with the table proof. */
  allow(playerId: string, admission?: Admission): void {
    const entry = this.entries.get(playerId);
    if (this.stopped || !entry || entry.player.status !== 'pending' || !entry.link) return;
    this.closeRequest(entry);
    if (this.countStatus('admitted') >= SESSION_LIMITS.maxPlayers) {
      this.entries.delete(playerId);
      this.refuse(this.release(entry), 'full');
      this.changed();
      return;
    }
    if (admission) {
      entry.player.personId = admission.personId;
      entry.table = admission.table;
    }
    admit(this.host, entry);
  }

  /** The person an admitted or gone player was admitted as; null for web players and unknown ids. */
  personOf(playerId: string): string | null {
    return this.entries.get(playerId)?.player.personId ?? null;
  }

  /** The device proof of a player's latest join, which a takeover may have refreshed; null for web players and unknown ids. */
  deviceOf(playerId: string): DeviceProof | null {
    return this.entries.get(playerId)?.device ?? null;
  }

  deny(playerId: string): void {
    const entry = this.entries.get(playerId);
    if (!entry || entry.player.status !== 'pending') return;
    this.closeRequest(entry);
    this.entries.delete(playerId);
    this.refuse(this.release(entry), 'denied');
    this.changed();
  }

  /** Removes a player; they will have to be approved again. */
  kick(playerId: string): void {
    const entry = this.entries.get(playerId);
    if (!entry) return;
    this.closeRequest(entry);
    this.entries.delete(playerId);
    this.refuse(this.release(entry), 'kicked');
    this.changed();
    this.broadcastPresence();
  }

  send(playerId: string, message: ControlMessage): void {
    const entry = this.entries.get(playerId);
    if (entry?.player.status === 'admitted') entry.link?.send('control', encodeControl(message));
  }

  /** An admitted player's assets channel on their current link, for the image server; null for anyone else. */
  assetChannel(playerId: string): ChannelPort | null {
    const entry = this.entries.get(playerId);
    return entry?.player.status === 'admitted' && entry.link ? channelPort(entry.link, 'assets') : null;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.pingTimer) window.clearInterval(this.pingTimer);
    this.stopTransport?.();
    for (const entry of this.entries.values()) this.closeRequest(entry);
    this.links.forEach(cancelReissue);
    for (const link of [...this.links.keys()]) {
      link.send('control', encodeControl({ v: 1, type: 'bye', reason: 'ended' }));
      link.close();
    }
    this.entries.clear();
    this.transport.close();
    this.changed();
  }

  // ── Connections ───────────────────────────────────────────

  private accept(link: PeerLink): void {
    if (this.stopped) {
      link.close();
      return;
    }
    const state: LinkState = { entry: null, invalid: 0, warned: false, joinTimer: null, joining: false, reissueTimer: null, unsubscribe: [] };
    state.joinTimer = window.setTimeout(() => link.close(), SESSION_LIMITS.joinTimeoutMs);
    state.unsubscribe.push(
      link.onMessage((channel, data) => { if (channel === 'control') this.receive(link, state, data); else this.receiveAsset(link, state, data); }),
      link.onClose(() => this.linkClosed(link, state)),
    );
    this.links.set(link, state);
  }

  private receive(link: PeerLink, state: LinkState, data: unknown): void {
    const decoded = decodeControl(data);
    if (decoded.kind === 'ignored') return;
    if (decoded.kind === 'version') {
      this.logRejected(state, 'protocol version mismatch');
      this.refuse(link, 'version');
      return;
    }
    if (decoded.kind === 'invalid' || (!state.entry && decoded.message.type !== 'join')) {
      this.logRejected(state, decoded.kind === 'invalid' ? decoded.reason : `${decoded.message.type} before join`);
      if (++state.invalid >= SESSION_LIMITS.maxInvalidMessages) link.close();
      return;
    }
    const message = decoded.message;
    if (message.type === 'join') {
      if (!state.entry && !state.joining) joinSession(this.host, link, state, message);
      return;
    }
    const entry = state.entry;
    if (!entry || entry.player.status !== 'admitted') return;
    if (message.type === 'pong') entry.lastPong = Date.now();
    else if (message.type === 'ping') link.send('control', encodeControl({ v: 1, type: 'pong', t: message.t }));
    else if (message.type === 'bye') link.close();
    else if (PLAYER_MESSAGE_TYPES.has(message.type)) for (const handler of this.handlers) handler.onMessage?.({ ...entry.player }, message);
  }

  /** Assets-channel data counts only from an admitted player's current link; handlers decode it. */
  private receiveAsset(link: PeerLink, state: LinkState, data: unknown): void {
    const entry = state.entry;
    if (!entry || entry.link !== link || entry.player.status !== 'admitted') return;
    for (const handler of this.handlers) handler.onAssetData?.({ ...entry.player }, data);
  }

  private linkClosed(link: PeerLink, state: LinkState): void {
    if (state.joinTimer) window.clearTimeout(state.joinTimer);
    cancelReissue(state);
    state.unsubscribe.forEach((unsubscribe) => unsubscribe());
    this.links.delete(link);
    const entry = state.entry;
    if (!entry || entry.link !== link || this.stopped) return;
    entry.link = null;
    if (entry.player.status === 'pending') {
      this.closeRequest(entry);
      this.entries.delete(entry.player.playerId);
      this.changed();
      return;
    }
    entry.player.status = 'gone';
    this.changed();
    this.broadcastPresence();
    for (const handler of this.handlers) handler.onGone?.({ ...entry.player });
  }

  // ── Helpers ───────────────────────────────────────────────

  private pingAll(): void {
    const now = Date.now();
    for (const entry of this.entries.values()) {
      if (entry.player.status !== 'admitted' || !entry.link) continue;
      if (now - entry.lastPong > SESSION_LIMITS.pingTimeoutMs) entry.link.close();
      else entry.link.send('control', encodeControl({ v: 1, type: 'ping', t: now }));
    }
  }

  private broadcastPresence(): void {
    const players = presenceOf(this.entries.values());
    const message = encodeControl({ v: 1, type: 'presence', players });
    for (const entry of this.entries.values()) {
      if (entry.player.status === 'admitted') entry.link?.send('control', message);
    }
  }

  /** Detaches an entry from its connection so closing it is not seen as a drop. */
  private release(entry: Entry): PeerLink | null {
    const link = entry.link;
    const state = link ? this.links.get(link) : undefined;
    if (state) state.entry = null;
    entry.link = null;
    return link;
  }

  /** Once per connection, and never the message itself: it comes from a stranger. */
  private logRejected(state: LinkState, reason: string): void {
    if (state.warned) return;
    state.warned = true;
    console.warn(`[Atlas VTT Connect] Rejected a message from a player connection: ${reason}. Later ones from it are not logged.`);
  }

  private refuse(link: PeerLink | null, reason: DenyReason): void {
    if (!link) return;
    link.send('control', encodeControl({ v: 1, type: 'denied', reason }));
    link.close();
  }

  private closeRequest(entry: Entry): void {
    if (entry.requestTimer) window.clearTimeout(entry.requestTimer);
    if (entry.player.status === 'pending' && entry.requestTimer !== null) this.options.onRequestClosed(entry.player.playerId);
    entry.requestTimer = null;
  }

  private countStatus(status: PlayerStatus): number {
    return [...this.entries.values()].filter((entry) => entry.player.status === status).length;
  }

  private changed(): void {
    this.options.onPlayersChanged(this.getPlayers());
  }
}
