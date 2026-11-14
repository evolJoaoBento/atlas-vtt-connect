import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectionFailureReason, hasTurnServer } from '../../../src/app/online/transport/connectionFailure';
import { ICE_PROBE_TIMEOUT_MS, iceProbeText, probeIceServers } from '../../../src/app/online/transport/iceProbe';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { pageScreen } from '../../../src/app/online/page/pageScreen';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('connection failure diagnostics', () => {
  it.each([
    ['peer-unavailable', 'host-offline'], ['direct-timeout', 'relay-needed'], ['relay-timeout', 'relay-failed'],
    ['signaling-timeout', 'signaling-unavailable'], ['socket-error', 'signaling-unavailable'],
    ['network', 'signaling-unavailable'], ['ssl-unavailable', 'signaling-unavailable'],
    ['browser-incompatible', 'browser-incompatible'], ['offline', 'offline'], ['webrtc', 'webrtc-failed'],
  ])('keeps a safe, actionable reason for %s', (code, expected) => {
    expect(connectionFailureReason({ code, message: 'secret credentials' })).toBe(expected);
    expect(connectionFailureReason({ type: code })).toBe(expected);
  });
  it('never presents raw error messages, unknown codes or prototypes', () => {
    for (const error of [null, undefined, new Error('password=secret'), { code: 'constructor' }]) expect(connectionFailureReason(error)).toBe('unreachable');
  });
  it('retains the reason through the actual player session and the web and Obsidian screen model', async () => {
    const player = new PlayerSession({ hostId: 'gm', name: 'A', playerKey: 'key', clientVersion: '1', transport: { connect: () => Promise.reject({ code: 'peer-unavailable', message: 'sensitive' }) }, onChange: () => {} });
    player.start(); await Promise.resolve(); await Promise.resolve();
    expect(player.state).toMatchObject({ status: 'lost', reason: 'host-offline' });
    const screen = pageScreen(player.state, false);
    expect(screen).toMatchObject({ kind: 'message' });
    expect(JSON.stringify(screen)).toContain('Mestre não encontrado');
    expect(JSON.stringify(screen)).not.toContain('sensitive'); player.stop();
  });
  it('recognizes TURN/TURNS in string and array configuration, without confusing STUN with a relay', () => {
    expect(hasTurnServer([{ urls: 'stun:example' }])).toBe(false);
    expect(hasTurnServer([{ urls: ['stun:example', 'turns:example:443'] }])).toBe(true);
  });
});

class ProbePeer {
  static last: ProbePeer;
  closed = false;
  onicecandidate: ((event: { candidate: { type: string } | null }) => void) | null = null;
  onicecandidateerror: ((event: { errorCode: number }) => void) | null = null;
  constructor() { ProbePeer.last = this; }
  createDataChannel(): void {}
  createOffer(): Promise<object> { return Promise.resolve({}); }
  setLocalDescription(): Promise<void> { return Promise.resolve(); }
  close(): void { this.closed = true; }
}

describe('relay readiness test', () => {
  it('detects a genuine relay candidate, ignores IPs, and always closes the test connection', async () => {
    vi.stubGlobal('RTCPeerConnection', ProbePeer);
    const pending = probeIceServers([{ urls: 'turns:example:443', username: 'u', credential: 'p' }]);
    const peer = ProbePeer.last;
    peer.onicecandidate?.({ candidate: { type: 'relay' } }); peer.onicecandidate?.({ candidate: null });
    const result = await pending;
    expect(result).toMatchObject({ relayReached: true, relayConfigured: true }); expect(peer.closed).toBe(true);
    expect(iceProbeText(result)).toContain('TURN acessível'); expect(JSON.stringify(result)).not.toContain('credential');
  });
  it('bounds a silent relay and deduplicates error codes without disclosing endpoint strings', async () => {
    vi.useFakeTimers(); vi.stubGlobal('RTCPeerConnection', ProbePeer);
    const pending = probeIceServers([{ urls: 'turn:example:3478' }]); const peer = ProbePeer.last;
    peer.onicecandidateerror?.({ errorCode: 701 }); peer.onicecandidateerror?.({ errorCode: 701 });
    await vi.advanceTimersByTimeAsync(ICE_PROBE_TIMEOUT_MS);
    const result = await pending; expect(result.errorCodes).toEqual([701]); expect(result.relayReached).toBe(false); expect(peer.closed).toBe(true);
    expect(iceProbeText(result)).toContain('porta 443');
  });
  it('distinguishes missing configuration from an unsupported browser', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined);
    expect(iceProbeText(await probeIceServers([]))).toContain('WebRTC indisponível');
    vi.stubGlobal('RTCPeerConnection', ProbePeer);
    const pending = probeIceServers([{ urls: 'stun:example' }]); ProbePeer.last.onicecandidate?.({ candidate: null });
    expect(iceProbeText(await pending)).toContain('Nenhum servidor TURN');
  });
});
