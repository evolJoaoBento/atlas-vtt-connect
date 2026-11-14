import { Inbox } from './peerLink';
import { TransportFailure } from './peerOptions';
import { decodeRelay, encodeRelay, validRelayTarget, validRelayUrl, type RelayPacket, type RelayTarget } from './relayWire';
import type { Channel, ClientTransport, HostTransport, PeerLink, TransportError, Unsubscribe } from './types';

export interface LocalRelaySettings { url: string; adminKey: string }
const WAIT_MS = 15_000;

function socketUrl(base: string, room: string, role: 'host' | 'player', key: string): string {
  const url = new URL('socket', base.endsWith('/') ? base : base + '/');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ room, role, key }).toString();
  return url.toString();
}

class RelayLink implements PeerLink {
  readonly inbox = new Inbox();
  private readonly closes = new Set<() => void>();
  private readonly drains = new Map<number, { above: boolean; threshold: number }>();
  private closed = false;
  constructor(readonly remoteId: string, private readonly socket: () => WebSocket | null, private readonly sendPacket: (packet: RelayPacket) => void, private readonly end: () => void) {}
  send(channel: Channel, data: string | ArrayBuffer): void { if (!this.closed) { this.sendPacket({ kind: 'data', peerId: this.remoteId, channel, data }); for (const state of this.drains.values()) state.above ||= this.bufferedAmount(channel) > state.threshold; } }
  bufferedAmount(_channel: Channel): number { return this.socket()?.bufferedAmount ?? 0; }
  onDrain(channel: Channel, threshold: number, cb: () => void): Unsubscribe {
    const state = { above: this.bufferedAmount(channel) > threshold, threshold };
    const timer = window.setInterval(() => {
      const next = this.bufferedAmount(channel) > threshold;
      const drained = state.above && !next;
      state.above = next;
      if (drained) cb();
    }, 50);
    this.drains.set(timer, state);
    return () => { window.clearInterval(timer); this.drains.delete(timer); };
  }
  onMessage(cb: (channel: Channel, data: unknown) => void): Unsubscribe { return this.inbox.subscribe(cb); }
  onClose(cb: () => void): Unsubscribe { this.closes.add(cb); return () => this.closes.delete(cb); }
  close(): void { if (this.closed) return; this.end(); this.lost(); }
  lost(): void {
    if (this.closed) return;
    this.closed = true;
    for (const timer of this.drains.keys()) window.clearInterval(timer);
    this.drains.clear(); for (const cb of this.closes) cb(); this.closes.clear();
  }
}

function send(socket: WebSocket | null, packet: RelayPacket): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(encodeRelay(packet));
}

export async function createWebSocketHost(settings: LocalRelaySettings): Promise<HostTransport> {
  if (!validRelayUrl(settings.url) || settings.adminKey.length < 32) throw new TransportFailure('relay-auth', 'Configure o endereço e a chave privada do servidor local.');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), WAIT_MS);
  let room: { roomId: string; hostKey: string; joinKey: string; publicUrl: string };
  try {
    // The same transport runs on the player page, where Obsidian requestUrl is unavailable.
    const response = await fetch(new URL('api/rooms', settings.url.endsWith('/') ? settings.url : settings.url + '/'), { method: 'POST', headers: { Authorization: `Bearer ${settings.adminKey}` }, signal: controller.signal });
    if (!response.ok) throw new Error('Relay refused');
    const value = await response.json() as Record<string, unknown>;
    if (typeof value.roomId !== 'string' || !/^[a-f0-9]{32}$/.test(value.roomId)
      || typeof value.hostKey !== 'string' || !validRelayTarget({ url: value.publicUrl, token: value.joinKey })) throw new Error('Invalid relay response');
    room = value as unknown as typeof room;
  } catch { throw new TransportFailure('relay-unavailable', 'O servidor local não respondeu. Execute INICIAR SERVIDOR antes de abrir a sessão.'); }
  finally { window.clearTimeout(timer); }
  const connections = new Set<(link: PeerLink) => void>(); const errors = new Set<(error: TransportError) => void>();
  const links = new Map<string, RelayLink>(); const pending = new Set<RelayLink>();
  let socket: WebSocket | null = null; let closed = false; let everReady = false; let retry: number | null = null;
  const connect = (): Promise<void> => new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl(settings.url, room.roomId, 'host', room.hostKey)); ws.binaryType = 'arraybuffer'; socket = ws;
    let ready = false;
    const wait = window.setTimeout(() => { ws.close(); reject(new TransportFailure('relay-unavailable', 'Servidor local não confirmou a sessão.')); }, WAIT_MS);
    ws.onmessage = (event): void => {
      const packet = decodeRelay(event.data); if (!packet || closed) return;
      if (packet.kind === 'ready') { ready = everReady = true; window.clearTimeout(wait); resolve(); }
      else if (packet.kind === 'open' && packet.peerId && !links.has(packet.peerId)) {
        const id = packet.peerId;
        const link = new RelayLink(id, () => socket, (data) => send(socket, data), () => { send(socket, { kind: 'close', peerId: id }); links.delete(id); pending.delete(link); });
        links.set(id, link);
        if (connections.size) for (const cb of connections) cb(link); else pending.add(link);
      } else if (packet.kind === 'close' && packet.peerId) { const link = links.get(packet.peerId); link?.lost(); if (link) pending.delete(link); links.delete(packet.peerId); }
      else if (packet.kind === 'data' && packet.peerId && packet.channel) links.get(packet.peerId)?.inbox.push(packet.channel, packet.data);
    };
    ws.onerror = (): void => { if (!ready) { window.clearTimeout(wait); ws.close(); reject(new TransportFailure('relay-unavailable', 'Servidor local inacessível.')); } };
    ws.onclose = (): void => {
      window.clearTimeout(wait); for (const link of links.values()) link.lost(); links.clear(); pending.clear();
      if (!ready) reject(new TransportFailure('relay-unavailable', 'Conexão com o servidor local encerrada.'));
      if (!closed && everReady) {
        for (const cb of errors) cb({ code: 'network', message: 'Reconectando ao servidor local.' });
        retry = window.setTimeout(() => { void connect().catch(() => {}); }, 2000);
      }
    };
  });
  const closeSocket = (): void => { socket?.close(); };
  try { await connect(); } catch (error) { closed = true; closeSocket(); throw error; }
  return {
    id: room.roomId, relay: { url: room.publicUrl, token: room.joinKey },
    onConnection: (cb) => { connections.add(cb); const early = [...pending]; pending.clear(); for (const link of early) cb(link); return () => connections.delete(cb); },
    onError: (cb) => { errors.add(cb); return () => errors.delete(cb); },
    close: () => { closed = true; if (retry !== null) window.clearTimeout(retry); send(socket, { kind: 'end' }); socket?.close(); for (const link of links.values()) link.lost(); links.clear(); },
  };
}

export function createWebSocketClient(target: RelayTarget): ClientTransport {
  return { connect: (hostId) => new Promise((resolve, reject) => {
    if (!validRelayTarget(target) || !/^[a-f0-9]{32}$/.test(hostId)) { reject(new TransportFailure('invalid-id', 'Link inválido.')); return; }
    const ws = new WebSocket(socketUrl(target.url, hostId, 'player', target.token)); ws.binaryType = 'arraybuffer';
    let ready = false;
    const link = new RelayLink(hostId, () => ws, (packet) => send(ws, packet), () => ws.close());
    const fail = (): void => { window.clearTimeout(timer); if (!ready) reject(new TransportFailure('relay-unavailable', 'Servidor local inacessível. Peça um link atualizado ao mestre.')); link.lost(); };
    const timer = window.setTimeout(() => { fail(); ws.close(); }, WAIT_MS);
    ws.onmessage = (event): void => {
      const packet = decodeRelay(event.data); if (!packet) return;
      if (packet.kind === 'ready' && !ready) { ready = true; window.clearTimeout(timer); resolve(link); }
      else if (packet.kind === 'data' && packet.channel) link.inbox.push(packet.channel, packet.data);
    };
    ws.onerror = (): void => { fail(); ws.close(); };
    ws.onclose = fail;
  }) };
}
