import { afterEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

/** Just enough of PeerJS to drive the transport. */
class FakeEmitter {
  handlers = new Map<string, Handler[]>();
  on(event: string, handler: Handler): this { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]); return this; }
  emit(event: string, ...args: unknown[]): void { (this.handlers.get(event) ?? []).forEach((h) => h(...args)); }
}

/** Just enough of RTCDataChannel for flushing and pacing. */
class FakeDataChannel {
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  private readonly lowListeners = new Set<() => void>();
  addEventListener(_type: 'bufferedamountlow', cb: () => void): void { this.lowListeners.add(cb); }
  removeEventListener(_type: 'bufferedamountlow', cb: () => void): void { this.lowListeners.delete(cb); }
  /** Drains to `amount`; like a browser, fires `bufferedamountlow` when it falls to the threshold from above. */
  drainTo(amount: number): void {
    const above = this.bufferedAmount > this.bufferedAmountLowThreshold;
    this.bufferedAmount = amount;
    if (above && amount <= this.bufferedAmountLowThreshold) [...this.lowListeners].forEach((cb) => cb());
  }
}

class FakeConnection extends FakeEmitter {
  sent: unknown[] = [];
  closed = false;
  opened = false;
  /** PeerJS's own send queue, then the data channel's. */
  bufferSize = 0;
  dataChannel: FakeDataChannel | null = new FakeDataChannel();
  constructor(
    public peer: string,
    public label: string,
    public metadata: unknown,
    public serialization = 'raw',
    public reliable = true,
  ) { super(); }
  emit(event: string, ...args: unknown[]): void {
    if (event === 'open') this.opened = true;
    super.emit(event, ...args);
  }
  get open(): boolean { return this.opened && !this.closed; }
  send(data: unknown): void { this.sent.push(data); }
  /** Like PeerJS: closing a connection that never opened emits nothing. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.dataChannel = null;
    if (this.opened) this.emit('close');
  }
}

const peers: FakePeer[] = [];
class FakePeer extends FakeEmitter {
  destroyed = false;
  reconnects = 0;
  connections: FakeConnection[] = [];
  constructor(public id: string | undefined, public options: unknown) { super(); peers.push(this); }
  connect(peer: string, options: { label: string; metadata: unknown }): FakeConnection {
    const connection = new FakeConnection(peer, options.label, options.metadata);
    this.connections.push(connection);
    return connection;
  }
  reconnect(): void { if (this.destroyed) throw new Error('destroyed'); this.reconnects++; }
  destroy(): void { this.destroyed = true; }
}

vi.mock('peerjs', () => ({ Peer: FakePeer }));

const { createPeerHost, createPeerClient, LINK_OPEN_TIMEOUT_MS, FLUSH_CAP_MS, FLUSH_GRACE_MS, FLUSH_POLL_MS } = await import('../../../src/app/online/transport/PeerTransport');
const { peerHostId, peerOptions, PEER_ID_PATTERN } = await import('../../../src/app/online/transport/peerOptions');

afterEach(() => { peers.length = 0; vi.useRealTimers(); });

async function openedHost(): Promise<{ peer: FakePeer; host: Awaited<ReturnType<typeof createPeerHost>> }> {
  const pending = createPeerHost({ iceServers: [] });
  const peer = peers[0]!;
  peer.emit('open', peer.id);
  return { peer, host: await pending };
}

describe('PeerTransport', () => {
  it('opens a host with a 128-bit id and pairs the two connections of a player', async () => {
    const pending = createPeerHost({ iceServers: [] });
    const peer = peers[0]!;
    expect(peer.id).toMatch(PEER_ID_PATTERN);
    expect(peer.id).toHaveLength(22);
    peer.emit('open', peer.id);
    const host = await pending;

    const links: Array<{ remoteId: string }> = [];
    host.onConnection((link) => links.push(link));
    const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
    const assets = new FakeConnection('p1', 'assets', { linkId: 'L1' });
    peer.emit('connection', control);
    peer.emit('connection', assets);
    control.emit('open');
    expect(links).toHaveLength(0);
    assets.emit('open');
    expect(links).toHaveLength(1);
    expect(links[0]!.remoteId).toBe('p1');
  });

  it('retries once with a new id when the id is taken', async () => {
    const pending = createPeerHost({ iceServers: [] });
    peers[0]!.emit('error', { type: 'unavailable-id', message: 'taken' });
    await vi.waitFor(() => expect(peers).toHaveLength(2)); // the retry starts after the first rejection settles
    const second = peers[1]!;
    expect(second.id).not.toBe(peers[0]!.id);
    second.emit('open', second.id);
    await expect(pending).resolves.toMatchObject({ id: second.id });
  });

  it('reports a signaling failure', async () => {
    const pending = createPeerHost({ iceServers: [] });
    peers[0]!.emit('error', { type: 'server-error', message: 'Could not get an ID from the server.' });
    await expect(pending).rejects.toMatchObject({ code: 'server-error', message: 'Could not get an ID from the server.' });
  });

  it('connects a client with both channels and closes both together', async () => {
    const client = createPeerClient({ iceServers: [] });
    const pending = client.connect('gm-id');
    const peer = peers[0]!;
    peer.emit('open', 'me');
    const [control, assets] = peer.connections;
    expect(control!.label).toBe('control');
    expect(assets!.label).toBe('assets');
    expect(control!.metadata).toEqual(assets!.metadata);
    control!.emit('open');
    assets!.emit('open');
    const link = await pending;
    const received: unknown[] = [];
    link.onMessage((channel, data) => received.push([channel, data]));
    assets!.emit('data', 'chunk');
    expect(received).toEqual([['assets', 'chunk']]);
    let closed = 0;
    link.onClose(() => closed++);
    control!.close();
    expect(assets!.closed).toBe(true);
    expect(closed).toBe(1);
    expect(peer.destroyed).toBe(true);
  });

  it('rejects a client whose data connections never open', async () => {
    vi.useFakeTimers();
    const pending = createPeerClient({ iceServers: [] }).connect('gm-id');
    const outcome = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    const peer = peers[0]!;
    peer.emit('open', 'me');
    await vi.advanceTimersByTimeAsync(LINK_OPEN_TIMEOUT_MS);
    await outcome;
    expect(peer.destroyed).toBe(true);
    expect(peer.connections.every((c) => c.closed)).toBe(true);
  });

  it('rejects a client when the signaling server never answers', async () => {
    vi.useFakeTimers();
    const pending = createPeerClient({ iceServers: [] }).connect('gm-id');
    const outcome = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(LINK_OPEN_TIMEOUT_MS);
    await outcome;
    expect(peers[0]!.destroyed).toBe(true);
  });

  it('drops a half-paired player after the open timeout', async () => {
    vi.useFakeTimers();
    const { peer, host } = await openedHost();
    const links: unknown[] = [];
    host.onConnection((link) => links.push(link));
    const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
    const assets = new FakeConnection('p1', 'assets', { linkId: 'L1' });
    peer.emit('connection', control);
    peer.emit('connection', assets);
    control.emit('open');
    await vi.advanceTimersByTimeAsync(LINK_OPEN_TIMEOUT_MS);
    expect(control.closed).toBe(true);
    expect(assets.closed).toBe(true); // asked to close although it never opened
    assets.emit('open');
    expect(links).toHaveLength(0);
  });

  it('reconnects signaling with backoff while hosting, and never after close', async () => {
    vi.useFakeTimers();
    const { peer, host } = await openedHost();
    peer.emit('disconnected');
    expect(peer.reconnects).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.reconnects).toBe(1);
    peer.emit('disconnected'); // still down
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.reconnects).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.reconnects).toBe(2);
    peer.emit('open', peer.id); // back: the backoff starts over
    peer.emit('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.reconnects).toBe(3);
    peer.emit('disconnected');
    host.close();
    peer.emit('disconnected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(peer.reconnects).toBe(3);
  });

  it('reports a taken id once while reconnecting and stops retrying', async () => {
    vi.useFakeTimers();
    const { peer, host } = await openedHost();
    const errors: string[] = [];
    host.onError((error) => errors.push(error.code));
    peer.emit('disconnected');
    await vi.advanceTimersByTimeAsync(1000);
    peer.emit('error', { type: 'unavailable-id', message: 'taken' });
    peer.emit('error', { type: 'unavailable-id', message: 'taken' });
    peer.emit('disconnected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(errors).toEqual(['unavailable-id']);
    expect(peer.reconnects).toBe(1);
  });

  it('draws host ids PeerJS accepts', () => {
    for (let i = 0; i < 2000; i++) expect(peerHostId()).toMatch(PEER_ID_PATTERN);
  });

  it('leaves unset server options to the PeerJS defaults', () => {
    expect(peerOptions({ host: undefined, port: undefined, iceServers: [] })).toEqual({ config: { iceServers: [] } });
    void createPeerHost({ host: undefined, path: '/p', iceServers: [] }).catch(() => undefined);
    expect(peers[0]!.options).toEqual({ path: '/p', config: { iceServers: [] } });
    expect('host' in (peers[0]!.options as object)).toBe(false);
  });

  it('rejects a host that never reaches the signaling server', async () => {
    vi.useFakeTimers();
    const pending = createPeerHost({ iceServers: [] });
    const outcome = expect(pending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(LINK_OPEN_TIMEOUT_MS);
    await outcome;
    expect(peers[0]!.destroyed).toBe(true);
  });

  it('replays what arrived before the link was handed out', async () => {
    const { peer, host } = await openedHost();
    const received: Array<[string, unknown]> = [];
    host.onConnection((link) => { link.onMessage((channel, data) => received.push([channel, data])); });
    const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
    const assets = new FakeConnection('p1', 'assets', { linkId: 'L1' });
    peer.emit('connection', control);
    peer.emit('connection', assets);
    control.emit('open');
    control.emit('data', 'join');
    assets.emit('open');
    expect(received).toEqual([['control', 'join']]);
    control.emit('data', 'next');
    expect(received).toEqual([['control', 'join'], ['control', 'next']]);
  });

  describe('closing flushes what was sent first', () => {
    async function clientLink(): Promise<{ peer: FakePeer; control: FakeConnection; assets: FakeConnection; link: Awaited<ReturnType<ReturnType<typeof createPeerClient>['connect']>> }> {
      const pending = createPeerClient({ iceServers: [] }).connect('gm-id');
      const peer = peers[0]!;
      peer.emit('open', 'me');
      const [control, assets] = peer.connections as [FakeConnection, FakeConnection];
      control.emit('open');
      assets.emit('open');
      return { peer, control, assets, link: await pending };
    }

    async function hostLink(): Promise<{ peer: FakePeer; host: Awaited<ReturnType<typeof createPeerHost>>; control: FakeConnection; assets: FakeConnection; link: import('../../../src/app/online/transport/types').PeerLink }> {
      const { peer, host } = await openedHost();
      const links: import('../../../src/app/online/transport/types').PeerLink[] = [];
      host.onConnection((link) => links.push(link));
      const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
      const assets = new FakeConnection('p1', 'assets', { linkId: 'L1' });
      peer.emit('connection', control);
      peer.emit('connection', assets);
      control.emit('open');
      assets.emit('open');
      return { peer, host, control, assets, link: links[0]! };
    }

    it('reports the close at once but keeps the connections until the buffers drain', async () => {
      vi.useFakeTimers();
      const { peer, control, assets, link } = await clientLink();
      let closed = 0;
      link.onClose(() => closed++);
      link.send('control', 'bye');
      control.dataChannel!.bufferedAmount = 3;
      link.close();
      expect(closed).toBe(1);
      expect(control.sent).toEqual(['bye']);
      expect(control.closed).toBe(false);
      expect(assets.closed).toBe(false);
      link.send('control', 'late');
      expect(control.sent).toEqual(['bye']);
      await vi.advanceTimersByTimeAsync(500);
      expect(control.closed).toBe(false);
      control.dataChannel!.bufferedAmount = 0;
      await vi.advanceTimersByTimeAsync(FLUSH_POLL_MS);
      expect(control.closed).toBe(false); // still in the grace period
      await vi.advanceTimersByTimeAsync(FLUSH_GRACE_MS);
      expect(control.closed).toBe(true);
      expect(assets.closed).toBe(true);
      expect(peer.destroyed).toBe(true);
      expect(closed).toBe(1);
    });

    it('waits for the PeerJS send queue too', async () => {
      vi.useFakeTimers();
      const { control, link } = await clientLink();
      control.bufferSize = 1;
      link.close();
      await vi.advanceTimersByTimeAsync(FLUSH_GRACE_MS * 3);
      expect(control.closed).toBe(false);
      control.bufferSize = 0;
      await vi.advanceTimersByTimeAsync(FLUSH_POLL_MS + FLUSH_GRACE_MS);
      expect(control.closed).toBe(true);
    });

    it('closes an empty link after only the grace period', async () => {
      vi.useFakeTimers();
      const { control, link } = await clientLink();
      link.close();
      expect(control.closed).toBe(false);
      await vi.advanceTimersByTimeAsync(FLUSH_GRACE_MS);
      expect(control.closed).toBe(true);
    });

    it('gives up waiting after the cap when the buffer never drains', async () => {
      vi.useFakeTimers();
      const { peer, assets, link } = await clientLink();
      assets.dataChannel!.bufferedAmount = 1;
      link.close();
      await vi.advanceTimersByTimeAsync(FLUSH_CAP_MS - 1);
      expect(assets.closed).toBe(false);
      expect(peer.destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(assets.closed).toBe(true);
      expect(peer.destroyed).toBe(true);
    });

    it('stops delivering messages once closed', async () => {
      vi.useFakeTimers();
      const { control, link } = await clientLink();
      const received: unknown[] = [];
      link.onMessage((_channel, data) => received.push(data));
      link.close();
      control.emit('data', 'after');
      expect(received).toEqual([]);
    });

    it('host close() destroys the peer only after closing links have flushed', async () => {
      vi.useFakeTimers();
      const { peer, host, control, link } = await hostLink();
      link.send('control', 'denied');
      control.dataChannel!.bufferedAmount = 10;
      link.close();
      host.close();
      expect(peer.destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(peer.destroyed).toBe(false);
      control.dataChannel!.bufferedAmount = 0;
      await vi.advanceTimersByTimeAsync(FLUSH_POLL_MS + FLUSH_GRACE_MS);
      expect(control.closed).toBe(true);
      expect(peer.destroyed).toBe(true);
    });

    it('host close() destroys the peer by the cap when a link never drains', async () => {
      vi.useFakeTimers();
      const { peer, host, control, link } = await hostLink();
      control.dataChannel!.bufferedAmount = 10;
      link.close();
      host.close();
      await vi.advanceTimersByTimeAsync(FLUSH_CAP_MS - 1);
      expect(peer.destroyed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(peer.destroyed).toBe(true);
    });

    it('host close() with nothing to flush destroys at once, and reports no later errors', async () => {
      const { peer, host } = await openedHost();
      const errors: string[] = [];
      host.onError((error) => errors.push(error.code));
      host.close();
      expect(peer.destroyed).toBe(true);
      peer.emit('error', { type: 'network', message: 'gone' });
      expect(errors).toEqual([]);
    });

    it('a link closed by the other end tears down at once', async () => {
      const { control, assets } = await hostLink();
      control.close();
      expect(assets.closed).toBe(true);
    });
  });

  describe('host refuses', () => {
    it('connections that are not raw and reliable', async () => {
      const { peer } = await openedHost();
      const json = new FakeConnection('p1', 'control', { linkId: 'L1' }, 'json');
      const unreliable = new FakeConnection('p1', 'assets', { linkId: 'L2' }, 'raw', false);
      peer.emit('connection', json);
      peer.emit('connection', unreliable);
      expect(json.closed).toBe(true);
      expect(unreliable.closed).toBe(true);
    });

    it('a second connection for the same link and channel', async () => {
      const { peer } = await openedHost();
      const first = new FakeConnection('p1', 'control', { linkId: 'L1' });
      const again = new FakeConnection('p1', 'control', { linkId: 'L1' });
      peer.emit('connection', first);
      peer.emit('connection', again);
      expect(again.closed).toBe(true);
      expect(first.closed).toBe(false);
    });

    it('halves that come from different peers', async () => {
      const { peer } = await openedHost();
      const control = new FakeConnection('p1', 'control', { linkId: 'L1' });
      const assets = new FakeConnection('p2', 'assets', { linkId: 'L1' });
      peer.emit('connection', control);
      peer.emit('connection', assets);
      expect(control.closed).toBe(true);
      expect(assets.closed).toBe(true);
    });

    it('more than 32 unpaired links at once', async () => {
      const { peer } = await openedHost();
      const kept = Array.from({ length: 32 }, (_, i) => new FakeConnection(`p${i}`, 'control', { linkId: `L${i}` }));
      kept.forEach((connection) => peer.emit('connection', connection));
      const extra = new FakeConnection('px', 'control', { linkId: 'LX' });
      peer.emit('connection', extra);
      expect(extra.closed).toBe(true);
      expect(kept.some((connection) => connection.closed)).toBe(false);
    });
  });
});

describe('PeerTransport pacing', () => {
  async function openedClient(): Promise<{ control: FakeConnection; assets: FakeConnection; link: Awaited<ReturnType<ReturnType<typeof createPeerClient>['connect']>> }> {
    const pending = createPeerClient({ iceServers: [] }).connect('gm-id');
    const peer = peers[0]!;
    peer.emit('open', 'me');
    const [control, assets] = peer.connections as [FakeConnection, FakeConnection];
    control.emit('open');
    assets.emit('open');
    return { control, assets, link: await pending };
  }

  it('reports the bytes waiting on each channel and calls back when one drains', async () => {
    const { control, assets, link } = await openedClient();
    assets.dataChannel!.bufferedAmount = 2_000_000;
    control.dataChannel!.bufferedAmount = 5;
    expect(link.bufferedAmount('assets')).toBe(2_000_000);
    expect(link.bufferedAmount('control')).toBe(5);

    let drained = 0;
    const stop = link.onDrain('assets', 256 * 1024, () => drained++);
    expect(assets.dataChannel!.bufferedAmountLowThreshold).toBe(256 * 1024);
    assets.dataChannel!.drainTo(300_000);
    expect(drained).toBe(0);
    assets.dataChannel!.drainTo(100_000);
    expect(drained).toBe(1);

    stop();
    assets.dataChannel!.bufferedAmount = 2_000_000;
    assets.dataChannel!.drainTo(0);
    expect(drained).toBe(1);
  });

  it('reports nothing buffered and no drains once closed', async () => {
    vi.useFakeTimers();
    const { assets, link } = await openedClient();
    let drained = 0;
    link.onDrain('assets', 10, () => drained++);
    assets.dataChannel!.bufferedAmount = 50;
    link.close();
    expect(link.bufferedAmount('assets')).toBe(0);
    assets.dataChannel!.drainTo(0);
    expect(drained).toBe(0);
  });

  it('does without a data channel that has no events', async () => {
    const { assets, link } = await openedClient();
    (assets as unknown as { dataChannel: unknown }).dataChannel = { bufferedAmount: 7 };
    expect(link.bufferedAmount('assets')).toBe(7);
    expect(() => link.onDrain('assets', 1, () => {})()).not.toThrow();
  });
});
