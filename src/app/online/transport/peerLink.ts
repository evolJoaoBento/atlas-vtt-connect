/**
 * A player's two PeerJS data connections as one `PeerLink`: an inbox that
 * replays messages which beat the first subscriber, a flush before the
 * connections close, and pacing on each data channel's buffer.
 */
import type { DataConnection } from 'peerjs';
import type { Channel, PeerLink, Unsubscribe } from './types';

/** Messages kept for a link nobody listens to yet. */
const MAX_BUFFERED_MESSAGES = 64;
/** How often a closing link checks whether what it sent has left. */
export const FLUSH_POLL_MS = 50;
/** Extra wait after the send buffers are empty, for the last bytes on the wire. */
export const FLUSH_GRACE_MS = 100;
/** Longest a closing link (or host) waits before tearing the connection down anyway. */
export const FLUSH_CAP_MS = 1500;

/**
 * Collects what arrives on a link's connections from the moment they exist, so a
 * message that beats the first subscriber (a join on the first-open half) is replayed.
 */
export class Inbox {
  private queue: Array<[Channel, unknown]> = [];
  private readonly listeners = new Set<(channel: Channel, data: unknown) => void>();

  push(channel: Channel, data: unknown): void {
    if (this.listeners.size === 0) {
      if (this.queue.length < MAX_BUFFERED_MESSAGES) this.queue.push([channel, data]);
      return;
    }
    [...this.listeners].forEach((cb) => cb(channel, data));
  }

  subscribe(cb: (channel: Channel, data: unknown) => void): Unsubscribe {
    const early = this.queue;
    this.queue = [];
    this.listeners.add(cb);
    early.forEach(([channel, data]) => cb(channel, data));
    return () => { this.listeners.delete(cb); };
  }
}

export function listen(connection: DataConnection, channel: Channel, inbox: Inbox): void {
  connection.on('data', (data: unknown) => inbox.push(channel, data));
}

/** The data channel under a connection; null before it opened or after it closed. */
function dataChannelOf(connection: DataConnection): RTCDataChannel | null {
  const dataChannel: RTCDataChannel | null | undefined = connection.dataChannel;
  return dataChannel ?? null;
}

/** Nothing queued in PeerJS or the data channel: what was sent has left this side. */
function drained(connection: DataConnection): boolean {
  if (!connection.open) return true;
  const queued = (connection as { bufferSize?: number }).bufferSize ?? 0;
  return queued === 0 && (dataChannelOf(connection)?.bufferedAmount ?? 0) === 0;
}

/**
 * Closes connections once what was sent on them has left, bounded by FLUSH_CAP_MS.
 * PeerJS closes the RTCPeerConnection in the same tick as close(), which would drop
 * a message sent just before (a refusal, a bye). Never closes in the calling tick.
 */
function closeAfterFlush(connections: DataConnection[]): Promise<void> {
  return new Promise((resolve) => {
    let waited = 0;
    const finish = (): void => {
      connections.forEach((connection) => connection.close());
      resolve();
    };
    const check = (): void => {
      if (waited >= FLUSH_CAP_MS) { finish(); return; }
      if (connections.every(drained)) {
        window.setTimeout(finish, Math.min(FLUSH_GRACE_MS, FLUSH_CAP_MS - waited));
        return;
      }
      waited += FLUSH_POLL_MS;
      window.setTimeout(check, FLUSH_POLL_MS);
    };
    window.setTimeout(check, 0);
  });
}

/**
 * A player's two data connections as one link. Closing it is immediate for the
 * sessions (no more sends or messages, close listeners fire), while the
 * connections themselves close once what was sent has been flushed.
 */
export class PeerJsLink implements PeerLink {
  private closed = false;
  private readonly closeListeners = new Set<() => void>();

  constructor(
    readonly remoteId: string,
    private readonly channels: Record<Channel, DataConnection>,
    private readonly inbox: Inbox,
    /** Told once the link closes: null when its connections closed already, else when they will have. */
    private readonly onClosed: (released: Promise<void> | null) => void,
  ) {
    // The other end went away: nothing to flush, tear down now.
    for (const connection of Object.values(channels)) {
      connection.on('close', () => this.shut(false));
      connection.on('error', () => this.shut(false));
    }
  }

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (!this.closed) void this.channels[channel].send(data);
  }

  bufferedAmount(channel: Channel): number {
    if (this.closed) return 0;
    return dataChannelOf(this.channels[channel])?.bufferedAmount ?? 0;
  }

  onDrain(channel: Channel, threshold: number, cb: () => void): Unsubscribe {
    const dataChannel = dataChannelOf(this.channels[channel]);
    if (!dataChannel || typeof dataChannel.addEventListener !== 'function') return () => {};
    dataChannel.bufferedAmountLowThreshold = threshold;
    const listener = (): void => { if (!this.closed) cb(); };
    dataChannel.addEventListener('bufferedamountlow', listener);
    return () => dataChannel.removeEventListener('bufferedamountlow', listener);
  }

  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe {
    return this.inbox.subscribe((channel, data) => { if (!this.closed) cb(channel, data); });
  }

  onClose(cb: () => void): Unsubscribe {
    this.closeListeners.add(cb);
    return () => this.closeListeners.delete(cb);
  }

  close(): void {
    this.shut(true);
  }

  private shut(flush: boolean): void {
    if (this.closed) return;
    this.closed = true;
    const connections = Object.values(this.channels);
    let released: Promise<void> | null = null;
    if (flush) released = closeAfterFlush(connections);
    else connections.forEach((connection) => connection.close());
    this.closeListeners.forEach((cb) => cb());
    this.closeListeners.clear();
    this.onClosed(released);
  }
}
