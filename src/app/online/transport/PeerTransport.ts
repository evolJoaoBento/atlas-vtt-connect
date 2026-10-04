import { Peer, type DataConnection } from 'peerjs';
import { randomId } from '../ids';
import { FLUSH_CAP_MS, Inbox, listen, PeerJsLink } from './peerLink';
import { asError, peerHostId, peerOptions, TransportFailure, type PeerServerOptions } from './peerOptions';
import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError } from './types';

export type { PeerServerOptions };
export { FLUSH_CAP_MS, FLUSH_GRACE_MS, FLUSH_POLL_MS } from './peerLink';

export const LINK_OPEN_TIMEOUT_MS = 15_000;
/** Pending (unpaired) links a host tolerates at once. */
const MAX_PENDING_LINKS = 32;
/** Delays before re-registering with a signaling server that dropped us; the last repeats. */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000];

/**
 * Tears a connection down, opened or not: PeerJS closes the RTCPeerConnection either
 * way, and one that never opened will not open later (it just emits no 'close').
 */
function refuse(connection: DataConnection): void {
  connection.close();
}

/**
 * Hosts a session under a fresh id. A taken id is retried once with another;
 * any other failure before the id opens rejects.
 */
export async function createPeerHost(options: PeerServerOptions): Promise<HostTransport> {
  try {
    return await openHost(options);
  } catch (error) {
    if ((error as TransportError).code === 'unavailable-id') return openHost(options);
    throw error;
  }
}

/** The connections a player has opened so far, until both channels are up. */
interface HalfLink {
  arrived: Partial<Record<Channel, DataConnection>>;
  opened: Set<Channel>;
  inbox: Inbox;
  timer: number;
}

function openHost(options: PeerServerOptions): Promise<HostTransport> {
  return new Promise((resolve, reject) => {
    const id = peerHostId();
    const peer = new Peer(id, peerOptions(options));
    const connectionListeners = new Set<(link: PeerLink) => void>();
    const errorListeners = new Set<(error: TransportError) => void>();
    const halves = new Map<string, HalfLink>();
    /** Links still flushing what was sent before they closed. */
    const flushing = new Set<Promise<void>>();
    let open = false;
    let closed = false;
    let timedOut = false;
    let gaveUp = false;
    let attempt = 0;
    let reconnectTimer: number | undefined;

    const openTimer = window.setTimeout(() => {
      if (open) return;
      timedOut = true;
      peer.destroy();
      reject(new TransportFailure('timeout', 'Timed out reaching the signaling server'));
    }, LINK_OPEN_TIMEOUT_MS);

    const clearReconnect = (): void => {
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    };

    const dropHalf = (linkId: string): void => {
      const half = halves.get(linkId);
      if (!half) return;
      halves.delete(linkId);
      window.clearTimeout(half.timer);
      Object.values(half.arrived).forEach(refuse);
    };

    peer.on('open', () => {
      if (timedOut) return;
      attempt = 0;
      clearReconnect();
      if (open) return; // signaling came back after a drop
      open = true;
      window.clearTimeout(openTimer);
      resolve({
        id,
        onConnection: (cb) => { connectionListeners.add(cb); return () => connectionListeners.delete(cb); },
        onError: (cb) => { errorListeners.add(cb); return () => errorListeners.delete(cb); },
        close: () => {
          if (closed) return;
          closed = true;
          clearReconnect();
          [...halves.keys()].forEach(dropHalf);
          // Destroying the peer closes every connection at once: let closing links flush first.
          let destroyed = false;
          const destroy = (): void => {
            if (destroyed) return;
            destroyed = true;
            window.clearTimeout(cap);
            peer.destroy();
          };
          if (flushing.size === 0) { peer.destroy(); return; }
          const cap = window.setTimeout(destroy, FLUSH_CAP_MS);
          void Promise.all([...flushing]).then(destroy);
        },
      });
    });

    peer.on('error', (error: unknown) => {
      if (timedOut || closed) return;
      const failure = asError(error);
      if (!open) {
        window.clearTimeout(openTimer);
        peer.destroy();
        reject(failure);
        return;
      }
      if (failure.code === 'unavailable-id') {
        // Our id was taken while signaling was down: retrying cannot help.
        if (gaveUp) return;
        gaveUp = true;
        clearReconnect();
      }
      errorListeners.forEach((cb) => cb(failure));
    });

    // Signaling dropped while hosting: established links keep working; get back on, backing off.
    peer.on('disconnected', () => {
      if (!open || closed || gaveUp || peer.destroyed || reconnectTimer !== undefined) return;
      const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]!;
      attempt++;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        if (!closed && !gaveUp && !peer.destroyed) peer.reconnect();
      }, delay);
    });

    peer.on('connection', (connection: DataConnection) => {
      const linkId = (connection.metadata as { linkId?: unknown } | undefined)?.linkId;
      const label = connection.label;
      if (
        closed || typeof linkId !== 'string' || (label !== 'control' && label !== 'assets')
        || connection.serialization !== 'raw' || !connection.reliable
      ) {
        refuse(connection);
        return;
      }
      let half = halves.get(linkId);
      if (!half) {
        if (halves.size >= MAX_PENDING_LINKS) { refuse(connection); return; }
        half = { arrived: {}, opened: new Set(), inbox: new Inbox(), timer: window.setTimeout(() => dropHalf(linkId), LINK_OPEN_TIMEOUT_MS) };
        halves.set(linkId, half);
      }
      const pair = half;
      const other = pair.arrived.control ?? pair.arrived.assets;
      if (pair.arrived[label]) { refuse(connection); return; }
      if (other && other.peer !== connection.peer) {
        refuse(connection);
        dropHalf(linkId);
        return;
      }
      pair.arrived[label] = connection;
      listen(connection, label, pair.inbox);
      connection.on('close', () => { if (halves.get(linkId) === pair) dropHalf(linkId); });
      connection.on('open', () => {
        if (halves.get(linkId) !== pair) return;
        pair.opened.add(label);
        const { control, assets } = pair.arrived;
        if (!control || !assets || pair.opened.size < 2) return;
        window.clearTimeout(pair.timer);
        halves.delete(linkId);
        const link = new PeerJsLink(connection.peer, { control, assets }, pair.inbox, (released) => {
          if (!released) return;
          flushing.add(released);
          void released.then(() => flushing.delete(released));
        });
        connectionListeners.forEach((cb) => cb(link));
      });
    });
  });
}

/** Joins hosts through PeerJS; each link has its own peer, destroyed when the link closes. */
export function createPeerClient(options: PeerServerOptions): ClientTransport {
  return {
    connect: (hostId: string): Promise<PeerLink> => new Promise((resolve, reject) => {
      const peer = new Peer(peerOptions(options));
      const connections: DataConnection[] = [];
      let settled = false;
      const fail = (error: TransportFailure): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        connections.forEach(refuse);
        peer.destroy();
        reject(error);
      };
      // Bounds every path: silent signaling server, or data connections that never open.
      const timer = window.setTimeout(() => fail(new TransportFailure('timeout', 'Timed out connecting to the GM')), LINK_OPEN_TIMEOUT_MS);
      peer.on('error', (error: unknown) => fail(asError(error)));
      peer.on('open', () => {
        if (settled) return;
        const metadata = { linkId: randomId(12) };
        const inbox = new Inbox();
        const control = peer.connect(hostId, { label: 'control', metadata, reliable: true, serialization: 'raw' });
        const assets = peer.connect(hostId, { label: 'assets', metadata, reliable: true, serialization: 'raw' });
        connections.push(control, assets);
        listen(control, 'control', inbox);
        listen(assets, 'assets', inbox);
        let opened = 0;
        const onOpen = (): void => {
          if (settled || ++opened < 2) return;
          settled = true;
          window.clearTimeout(timer);
          resolve(new PeerJsLink(hostId, { control, assets }, inbox, (released) => {
            if (released) void released.then(() => peer.destroy());
            else peer.destroy();
          }));
        };
        for (const connection of connections) {
          connection.on('open', onOpen);
          connection.on('close', () => fail(new TransportFailure('unreachable', 'The GM closed the connection')));
          connection.on('error', (error: unknown) => fail(asError(error)));
        }
      });
    }),
  };
}
