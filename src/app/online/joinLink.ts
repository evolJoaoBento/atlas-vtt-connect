/**
 * Join links: `<page>#id=<gm id>[&table=<table id>][&signal=...][&ice=...]`. Everything sits in the
 * fragment, which browsers never send to the page's host. Shared with the web
 * player page, so it imports no Obsidian code.
 */
import { DEFAULT_STUN, peerServerOptions, validTurnServer, type OnlineSettings } from './onlineSettings';
import { PEER_ID_PATTERN, type PeerServerOptions } from './transport/peerOptions';

export interface JoinTarget {
  hostId: string;
  server: PeerServerOptions;
  /** The GM's table id (sharing between Obsidian clients); null for older links or a malformed value. */
  tableId: string | null;
}

const TABLE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const MAX_RELAYS = 8;

/** A host id PeerJS accepts, short enough and free of spaces, so it is safe in a fragment. */
function validHostId(id: string): boolean {
  return id.length <= 64 && !id.includes(' ') && PEER_ID_PATTERN.test(id);
}

type SignalOptions = Omit<PeerServerOptions, 'iceServers'>;

function isString(value: unknown, max: number, min = 0): value is string {
  return typeof value === 'string' && value.length >= min && value.length <= max;
}

/** The signaling server a link names, allowing only the five known keys with the right types. */
function validSignal(value: unknown): SignalOptions | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { host, port, path, key, secure, ...extra } = value as Record<string, unknown>;
  if (Object.keys(extra).length) return null;
  const result: SignalOptions = {};
  if (host !== undefined) { if (!isString(host, 253, 1)) return null; result.host = host; }
  if (port !== undefined) {
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
    result.port = port;
  }
  if (path !== undefined) { if (!isString(path, 256)) return null; result.path = path; }
  if (key !== undefined) { if (!isString(key, 128)) return null; result.key = key; }
  if (secure !== undefined) { if (typeof secure !== 'boolean') return null; result.secure = secure; }
  return result;
}

function validRelays(value: unknown): RTCIceServer[] | null {
  if (!Array.isArray(value) || value.length > MAX_RELAYS) return null;
  const relays: RTCIceServer[] = [];
  for (const entry of value) {
    const relay = validTurnServer(entry);
    if (!relay) return null;
    relays.push(relay);
  }
  return relays;
}

function toBase64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): unknown {
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
}

export function buildJoinUrl(pageUrl: string, hostId: string, settings: OnlineSettings, tableId: string | null = null): string {
  if (!validHostId(hostId)) throw new Error('Invalid host id');
  const base = pageUrl.split('#')[0];
  const { iceServers, ...server } = peerServerOptions(settings);
  const params = [`id=${hostId}`];
  if (tableId && TABLE_ID_PATTERN.test(tableId)) params.push(`table=${tableId}`);
  if (Object.keys(server).length) params.push(`signal=${toBase64Url(server)}`);
  const relays = iceServers.filter((ice) => ice.urls !== DEFAULT_STUN);
  if (relays.length) params.push(`ice=${toBase64Url(relays)}`);
  return `${base}#${params.join('&')}`;
}

/** The GM and servers a join link names; null for an incomplete or broken link. */
export function parseJoinFragment(hash: string): JoinTarget | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const hostId = params.get('id') ?? '';
  if (!validHostId(hostId)) return null;
  try {
    const signal = params.get('signal');
    const ice = params.get('ice');
    const server = signal ? validSignal(fromBase64Url(signal)) : {};
    const relays = ice ? validRelays(fromBase64Url(ice)) : [];
    if (!server || !relays) return null;
    const table = params.get('table');
    return {
      hostId,
      server: { ...server, iceServers: [{ urls: DEFAULT_STUN }, ...relays] },
      tableId: table && TABLE_ID_PATTERN.test(table) ? table : null,
    };
  } catch {
    return null;
  }
}

/** The GM and servers of a pasted join link: the whole link or only its `#…` part; null for anything else. */
export function parseJoinLink(text: string): JoinTarget | null {
  const trimmed = text.trim();
  const hash = trimmed.indexOf('#');
  return hash === -1 ? null : parseJoinFragment(trimmed.slice(hash));
}
