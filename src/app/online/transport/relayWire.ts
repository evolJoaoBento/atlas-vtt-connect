import type { Channel } from './types';

export const MAX_RELAY_FRAME_BYTES = 2 * 1024 * 1024;
export interface RelayTarget { url: string; token: string }
export interface RelayPacket { kind: 'ready' | 'open' | 'close' | 'data' | 'end'; peerId?: string; channel?: Channel; data?: string | ArrayBuffer }
const ID = /^[a-zA-Z0-9_-]{1,64}$/;

export function validRelayUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

export function validRelayTarget(value: unknown): value is RelayTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as RelayTarget;
  return validRelayUrl(target.url) && typeof target.token === 'string' && /^[a-zA-Z0-9_-]{32,128}$/.test(target.token);
}

export function encodeRelay(packet: RelayPacket): string | ArrayBuffer {
  if (!(packet.data instanceof ArrayBuffer)) return JSON.stringify(packet);
  const { data, ...header } = packet;
  const bytes = new TextEncoder().encode(JSON.stringify(header));
  const output = new Uint8Array(2 + bytes.length + data.byteLength);
  new DataView(output.buffer).setUint16(0, bytes.length);
  output.set(bytes, 2); output.set(new Uint8Array(data), 2 + bytes.length);
  return output.buffer;
}

export function decodeRelay(raw: unknown): RelayPacket | null {
  try {
    let value: unknown; let payload: ArrayBuffer | undefined;
    if (typeof raw === 'string') {
      if (raw.length > MAX_RELAY_FRAME_BYTES) return null;
      value = JSON.parse(raw);
    } else {
      const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : ArrayBuffer.isView(raw) ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
      if (!bytes || bytes.length < 3 || bytes.length > MAX_RELAY_FRAME_BYTES) return null;
      const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
      if (length > 2048 || length + 2 > bytes.length) return null;
      value = JSON.parse(new TextDecoder().decode(bytes.subarray(2, length + 2)));
      payload = Uint8Array.from(bytes.subarray(length + 2)).buffer;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const p = value as RelayPacket;
    if (!['ready', 'open', 'close', 'data', 'end'].includes(p.kind) || (p.peerId !== undefined && !ID.test(p.peerId))) return null;
    if (p.kind === 'data' && ((p.channel !== 'control' && p.channel !== 'assets') || (payload === undefined && typeof p.data !== 'string'))) return null;
    return { kind: p.kind, ...(p.peerId ? { peerId: p.peerId } : {}), ...(p.channel ? { channel: p.channel } : {}), ...(payload !== undefined ? { data: payload } : typeof p.data === 'string' ? { data: p.data } : {}) };
  } catch { return null; }
}
