/**
 * A page from before split party (Connect 0.1.0-beta.3 and older) against a GM with one: it knows neither `scene-state`
 * nor the dice entry's `scene`. Its decoder drops the first as `ignored` (B2); here the frames never reach it at all, so
 * a real `PlayerSession` behaves exactly as the older page's. It must still show the right scene through a move, a pause
 * and a resume, never lose its place in the patch sequence, and snap back a move on a paused scene.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerSession } from '../../../src/app/online/PlayerSession';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import type { ClientTransport, PeerLink } from '../../../src/app/online/transport/types';
import { character, splitWorld, tab, TOKEN, type SplitWorld } from './splitFixtures';
import { tokenPart, toolParts } from './splitParts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

interface OlderPage {
  session: PlayerSession;
  playerId: string;
  resyncs: number;
  /** The `scene-state` frames the GM sent that this page never read. */
  unread: number;
  paused: boolean[];
  refused: string[];
  sceneLabels: unknown[];
}

/** What an older page reads of a control frame: no `scene-state`, and dice entries without `scene`. */
function olderFrame(data: string): string | null {
  const decoded = decodeControl(data);
  if (decoded.kind !== 'message') return data;
  const { message } = decoded;
  if (message.type === 'scene-state') return null;
  if (message.type === 'dice-log') return encodeControl({ ...message, entries: message.entries.map(({ scene: _scene, ...entry }) => entry) });
  return data;
}

async function olderPage(w: SplitWorld, name: string): Promise<OlderPage> {
  const page: Omit<OlderPage, 'session' | 'playerId'> = { resyncs: 0, unread: 0, paused: [], refused: [], sceneLabels: [] };
  const inner = w.network.client();
  const transport: ClientTransport = {
    connect: async (hostId: string): Promise<PeerLink> => {
      const link = await inner.connect(hostId);
      return {
        remoteId: link.remoteId,
        send: (channel, data) => {
          if (channel === 'control' && typeof data === 'string' && decodeControl(data).kind === 'message' && data.includes('"scene-resync"')) page.resyncs++;
          link.send(channel, data);
        },
        bufferedAmount: (channel) => link.bufferedAmount(channel),
        onDrain: (channel, threshold, cb) => link.onDrain(channel, threshold, cb),
        onMessage: (cb) => link.onMessage((channel, data) => {
          if (channel !== 'control' || typeof data !== 'string') return cb(channel, data);
          const kept = olderFrame(data);
          if (kept !== null) cb(channel, kept);
          else page.unread++;
        }),
        onClose: (cb) => link.onClose(cb),
        close: () => link.close(),
      };
    },
  };
  const session = new PlayerSession({
    hostId: 'gm', name, playerKey: name, clientVersion: '0.1.0-beta.3', transport, onChange: () => {},
    onSceneState: (paused) => page.paused.push(paused),
    onMoveRefused: (tokenId) => page.refused.push(tokenId),
    onDiceLog: (entries) => page.sceneLabels.push(...entries.map((entry) => entry.scene)),
  });
  session.start();
  await vi.advanceTimersByTimeAsync(0);
  const request = w.gm.getPlayers().find((player) => player.name === name && player.status === 'pending');
  if (request) w.gm.allow(request.playerId);
  await vi.advanceTimersByTimeAsync(0);
  const playerId = w.gm.getPlayers().find((player) => player.name === name)!.playerId;
  return Object.assign(page, { session, playerId });
}

describe('an older page with a split party', () => {
  it('follows a move, a pause and a resume with no resync, and a move on a paused scene snaps back', async () => {
    const w = await splitWorld();
    const control = tokenPart(w);
    toolParts(w);
    await w.present('a');
    const page = await olderPage(w, 'old');
    const watcher = await w.join('anna');
    expect(Object.keys(page.session.scene!.tokens)).toContain(TOKEN.a);

    // Moved to Bridge: a clear, then Bridge's scene; nothing of Ambush is left.
    control.control.set(TOKEN.b, page.playerId, true);
    void w.hub.assign(page.playerId, tab('b'));
    await vi.advanceTimersByTimeAsync(60);
    const bridge = w.hub.slotOf(page.playerId)!;
    expect(page.session.scene).toEqual(bridge.lastSent);
    expect(Object.keys(page.session.scene!.tokens)).not.toContain(TOKEN.a);

    // The GM goes back to Ambush: Bridge is paused, which this page is never told.
    await w.switchTo('a');
    expect(w.hub.slotOf(page.playerId)?.state).toBe('parked');
    expect(page.session.sendTokenMove(TOKEN.b, 600, 140)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(page.refused).toEqual([TOKEN.b]);
    expect(page.session.scene!.tokens[TOKEN.b]?.x).toBe(140);

    // A roll is logged, without the scene label this page cannot read.
    page.session.sendDiceRoll({ d6: 1 }, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(page.sceneLabels.length).toBeGreaterThan(0);
    expect(page.sceneLabels.every((label) => label === undefined)).toBe(true);
    expect(watcher.received.some((message) => message.type === 'dice-log' && message.entries.some((entry) => entry.scene === 'Bridge'))).toBe(true);

    // Back on Bridge: live again; the GM's edits there reach the page as patches it applies in order.
    await w.switchTo('b');
    w.editTokens({ [TOKEN.b]: character(TOKEN.b, 280) });
    await w.tick();
    expect(page.session.scene).toEqual(w.hub.slotOf(page.playerId)!.lastSent);
    expect(page.session.scene!.tokens[TOKEN.b]?.x).toBe(280);
    expect(page.unread).toBeGreaterThanOrEqual(2); // paused, then live again
    expect(page.paused).toEqual([]);
    expect(page.resyncs).toBe(0);
    page.session.stop();
  });
});
