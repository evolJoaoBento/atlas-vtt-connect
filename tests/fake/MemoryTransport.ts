import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError, Unsubscribe } from '../../src/app/online/transport/types';

type Listener<T extends unknown[]> = (...args: T) => void;

function listeners<T extends unknown[]>(): { add(cb: Listener<T>): Unsubscribe; emit(...args: T): void; clear(): void } {
  const set = new Set<Listener<T>>();
  return {
    add: (cb) => { set.add(cb); return () => set.delete(cb); },
    emit: (...args) => { for (const cb of [...set]) cb(...args); },
    clear: () => set.clear(),
  };
}

function sizeOf(data: string | ArrayBuffer): number {
  return typeof data === 'string' ? data.length : data.byteLength;
}

/**
 * One end of an in-memory link; `peer` is the other end. Delivery is immediate,
 * except on a channel a test holds: what is sent there waits, counts as
 * buffered, and leaves on `flush`, which signals drains as WebRTC does.
 */
export class MemoryLink implements PeerLink {
  peer!: MemoryLink;
  private closed = false;
  private readonly messages = listeners<[Channel, unknown]>();
  private readonly closes = listeners<[]>();
  private readonly held = new Set<Channel>();
  private readonly waiting: Record<Channel, Array<string | ArrayBuffer>> = { control: [], assets: [] };
  private readonly drains: Record<Channel, { threshold: number; callbacks: Set<() => void> }> = {
    control: { threshold: 0, callbacks: new Set() },
    assets: { threshold: 0, callbacks: new Set() },
  };

  constructor(readonly remoteId: string) {}

  send(channel: Channel, data: string | ArrayBuffer): void {
    if (this.closed) return;
    if (this.held.has(channel)) {
      this.waiting[channel].push(data);
      return;
    }
    this.peer.messages.emit(channel, data);
  }

  bufferedAmount(channel: Channel): number {
    return this.waiting[channel].reduce((total, data) => total + sizeOf(data), 0);
  }

  onDrain(channel: Channel, threshold: number, cb: () => void): Unsubscribe {
    const drain = this.drains[channel];
    drain.threshold = threshold;
    drain.callbacks.add(cb);
    return () => { drain.callbacks.delete(cb); };
  }

  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe { return this.messages.add(cb); }
  onClose(cb: () => void): Unsubscribe { return this.closes.add(cb); }

  /** Test control: what is sent on `channel` from now on waits until flushed. */
  hold(channel: Channel): void {
    this.held.add(channel);
  }

  /** Test control: delivers waiting messages until at least `bytes` left (all by default), then signals a drain. */
  flush(channel: Channel, bytes = Infinity): void {
    const before = this.bufferedAmount(channel);
    const queue = this.waiting[channel];
    let sent = 0;
    while (queue.length > 0 && sent < bytes && !this.closed) {
      const data = queue.shift()!;
      sent += sizeOf(data);
      this.peer.messages.emit(channel, data);
    }
    const drain = this.drains[channel];
    const after = this.bufferedAmount(channel);
    if (!this.closed && before > drain.threshold && after <= drain.threshold) [...drain.callbacks].forEach((cb) => cb());
  }

  /** Test control: stops holding `channel` after delivering what waits. */
  release(channel: Channel): void {
    this.held.delete(channel);
    this.flush(channel);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.waiting.control = [];
    this.waiting.assets = [];
    this.peer.close();
    this.closes.emit();
    this.messages.clear();
    this.closes.clear();
  }
}

class MemoryHost implements HostTransport {
  closed = false;
  private readonly hostSideLinks: MemoryLink[] = [];
  readonly connections = listeners<[PeerLink]>();
  private readonly errors = listeners<[TransportError]>();
  constructor(readonly id: string, private readonly remove: () => void) {}
  onConnection(cb: (link: PeerLink) => void): Unsubscribe { return this.connections.add(cb); }
  onError(cb: (error: TransportError) => void): Unsubscribe { return this.errors.add(cb); }
  fail(error: TransportError): void { this.errors.emit(error); }
  registerLink(link: MemoryLink): void { this.hostSideLinks.push(link); }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const link of this.hostSideLinks) {
      link.close();
    }
    this.remove();
  }
}

/** Hosts and clients in one process, for tests. */
export class MemoryNetwork {
  private readonly hosts = new Map<string, MemoryHost>();
  private clients = 0;
  private nextHostId = 1;

  host(id?: string): MemoryHost {
    const hostId = id ?? `host-${this.nextHostId++}`;
    const host = new MemoryHost(hostId, () => {
      if (this.hosts.get(hostId) === host) {
        this.hosts.delete(hostId);
      }
    });
    this.hosts.set(hostId, host);
    return host;
  }

  client(): ClientTransport {
    return {
      connect: async (hostId: string): Promise<PeerLink> => {
        const host = this.hosts.get(hostId);
        if (!host || host.closed) {
          const error: TransportError = { code: 'unreachable', message: `No host ${hostId}` };
          throw Object.assign(new Error(error.message), error);
        }
        const clientEnd = new MemoryLink(hostId);
        const hostEnd = new MemoryLink(`client-${++this.clients}`);
        clientEnd.peer = hostEnd;
        hostEnd.peer = clientEnd;
        // The host sees the link before the client can subscribe, which is safe because the GM session
        // sends nothing until the player's join arrives.
        host.registerLink(hostEnd);
        host.connections.emit(hostEnd);
        return clientEnd;
      },
    };
  }
}
