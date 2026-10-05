import type { PeerServerOptions } from './transport/peerOptions';

export interface TurnServer {
  urls: string;
  username: string;
  credential: string;
}

export interface StoredTable {
  /** The table id: the key's id, carried in join links. */
  id: string;
  publicKey: string;
  privateKey: JsonWebKey;
}

/** A stored table key of the right shape; null for anything else. */
export function validStoredTable(value: unknown): StoredTable | null {
  if (!isRecord(value)) return null;
  const { id, publicKey, privateKey } = value;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  if (typeof publicKey !== 'string' || publicKey.length > 200) return null;
  if (!isRecord(privateKey) || privateKey.kty !== 'EC' || privateKey.crv !== 'P-256' || typeof privateKey.d !== 'string') return null;
  return { id, publicKey, privateKey };
}

export interface OnlineSettings {
  signaling: { mode: 'cloud' | 'custom'; host: string; port: number; path: string; key: string; secure: boolean };
  turnServers: TurnServer[];
  /** Where join links point: the published `online-client/` page. */
  playerPageUrl: string;
  /** Developer diagnostics: log presented-scene events and messages to players to the console. */
  logEvents: boolean;
  /** The name this Atlas last joined a session with, offered next time. */
  playerName: string;
  /** Joining from Atlas: keep a session's images on this device (outside the vault) for the next one. */
  keepImages: boolean;
  /**
   * The GM's table key (sharing between Obsidian clients): made the first time this Atlas hosts; null before. Kept in
   * Obsidian's local storage on this device, never in `data.json` (`ConnectSettingsStore`).
   */
  table: StoredTable | null;
  /** Note properties that shared notes keep (all others are stripped; `atlas-share` always). */
  shareableProperties: string[];
}

export const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

export const DEFAULT_ONLINE_SETTINGS: OnlineSettings = {
  signaling: { mode: 'cloud', host: '', port: 443, path: '/', key: 'peerjs', secure: true },
  turnServers: [],
  playerPageUrl: 'https://evoljoaobento.github.io/atlas-vtt-connect/',
  logEvents: false,
  playerName: '',
  keepImages: true,
  table: null,
  shareableProperties: ['tags', 'aliases'],
};

/** PeerJS options for these settings: the PeerJS cloud unless a custom server is set. */
export function peerServerOptions(settings: OnlineSettings): PeerServerOptions {
  const iceServers: RTCIceServer[] = [{ urls: DEFAULT_STUN }, ...settings.turnServers.map((server) => ({ ...server }))];
  if (settings.signaling.mode !== 'custom' || !settings.signaling.host) return { iceServers };
  const { host, port, path, key, secure } = settings.signaling;
  return { host, port, path, key, secure, iceServers };
}

/** One relay per line: `turn:host:port username credential`. */
export function parseTurnServers(text: string): TurnServer[] {
  return text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(/\s+/))
    .filter(([urls]) => /^turns?:/i.test(urls ?? ''))
    .map(([urls = '', username = '', credential = '']) => ({ urls, username, credential }));
}

export function formatTurnServers(servers: TurnServer[]): string {
  return servers.map((server) => `${server.urls} ${server.username} ${server.credential}`).join('\n');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One TURN/TURNS relay if `value` is a well-formed entry, else null. Shared by join links and stored settings. */
export function validTurnServer(value: unknown): TurnServer | null {
  if (!isRecord(value)) return null;
  const { urls, username, credential } = value;
  if (typeof urls !== 'string' || urls.length > 512 || !/^turns?:/i.test(urls)) return null;
  if (typeof username !== 'string' || username.length > 256) return null;
  if (typeof credential !== 'string' || credential.length > 256) return null;
  return { urls, username, credential };
}

/** Settings from stored data of any shape: every wrongly typed field falls back to its default. */
export function resolveOnlineSettings(stored: unknown): OnlineSettings {
  const defaults = DEFAULT_ONLINE_SETTINGS;
  const source = isRecord(stored) ? stored : {};
  const signaling = isRecord(source.signaling) ? source.signaling : {};
  const port = signaling.port;
  return {
    signaling: {
      mode: signaling.mode === 'custom' || signaling.mode === 'cloud' ? signaling.mode : defaults.signaling.mode,
      host: typeof signaling.host === 'string' ? signaling.host : defaults.signaling.host,
      port: typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : defaults.signaling.port,
      path: typeof signaling.path === 'string' ? signaling.path : defaults.signaling.path,
      key: typeof signaling.key === 'string' ? signaling.key : defaults.signaling.key,
      secure: typeof signaling.secure === 'boolean' ? signaling.secure : defaults.signaling.secure,
    },
    turnServers: Array.isArray(source.turnServers)
      ? source.turnServers.flatMap((entry) => validTurnServer(entry) ?? [])
      : [],
    playerPageUrl: typeof source.playerPageUrl === 'string' ? source.playerPageUrl : defaults.playerPageUrl,
    logEvents: source.logEvents === true,
    playerName: typeof source.playerName === 'string' ? source.playerName.slice(0, 200) : defaults.playerName,
    keepImages: source.keepImages !== false,
    table: validStoredTable(source.table),
    shareableProperties: Array.isArray(source.shareableProperties)
      ? source.shareableProperties.filter((key): key is string => typeof key === 'string' && key.trim().length > 0 && key.length <= 64)
        .map((key) => key.trim()).slice(0, 50)
      : [...defaults.shareableProperties],
  };
}
