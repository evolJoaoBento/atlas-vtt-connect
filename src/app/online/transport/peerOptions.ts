import { randomId } from '../ids';
import type { TransportError } from './types';

export interface PeerServerOptions {
  host?: string | undefined;
  port?: number | undefined;
  path?: string | undefined;
  key?: string | undefined;
  secure?: boolean | undefined;
  iceServers: RTCIceServer[];
}

/** What is handed to PeerJS: only the keys that are set, so its cloud defaults stay in force. */
export interface PeerConstructorOptions {
  host?: string;
  port?: number;
  path?: string;
  key?: string;
  secure?: boolean;
  config: { iceServers: RTCIceServer[] };
}

export function peerOptions(options: PeerServerOptions): PeerConstructorOptions {
  const { iceServers, ...server } = options;
  const defined = Object.fromEntries(Object.entries(server).filter(([, value]) => value !== undefined));
  return { ...defined, config: { iceServers } };
}

/** The ids PeerJS accepts: alphanumeric groups joined by single space, underscore or dash. */
export const PEER_ID_PATTERN = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

/** A fresh 128-bit host id that PeerJS will not refuse as invalid. */
export function peerHostId(): string {
  let id = randomId();
  while (!PEER_ID_PATTERN.test(id)) id = randomId();
  return id;
}

/** A TransportError that is also a real Error, so it can be a promise rejection reason. */
export class TransportFailure extends Error implements TransportError {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TransportFailure';
  }
}

export function asError(error: unknown): TransportFailure {
  const e = error as { type?: string; message?: string } | undefined;
  return new TransportFailure(e?.type ?? 'network', e?.message ?? String(error));
}
