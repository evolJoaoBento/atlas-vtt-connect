/** Public diagnostics contain fixed codes only, never raw network errors or relay credentials. */
export function connectionFailureReason(error: unknown): string {
  const value = error as { code?: unknown; type?: unknown } | null;
  const code = typeof value?.code === 'string' ? value.code : value?.type;
  switch (code) {
    case 'relay-unavailable': return 'local-relay-unavailable';
    case 'relay-auth': return 'local-relay-auth';
    case 'peer-unavailable': return 'host-offline';
    case 'invalid-id': return 'invalid-link';
    case 'browser-incompatible': return 'browser-incompatible';
    case 'offline': return 'offline';
    case 'direct-timeout': return 'relay-needed';
    case 'relay-timeout': return 'relay-failed';
    case 'signaling-timeout':
    case 'network':
    case 'socket-error':
    case 'socket-closed':
    case 'server-error':
    case 'ssl-unavailable': return 'signaling-unavailable';
    case 'webrtc': return 'webrtc-failed';
    default: return 'unreachable';
  }
}

export function hasTurnServer(servers: readonly RTCIceServer[]): boolean {
  return servers.some(({ urls }) => (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url)));
}
