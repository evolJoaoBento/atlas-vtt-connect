/**
 * A split party end to end in the risky windows (review I3): a GM switch that takes time to load on a lit scene,
 * presentations that hold, the GM's own tab closing under its players, and a page that asks for images before its
 * readmission is handled. Every frame each player got passes the same checks as `splitPartyEndToEnd`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { character, IMAGES, lastSceneId, TOKEN, typesOf, VIEW, type RawFrame } from './splitFixtures';
import { assetClient, dropToken, idOf, moveCamera, sendLaser } from './splitParts';
import { assetsOf, BRIDGE_SEEN, clearAt, expectNothingOf, greedy, namesIn, olderReplay, party, secretsOf, textOf } from './splitPrivacy';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const LOAD_MS = 200;

const refusedOf = (messages: readonly ControlMessage[], from = 0): string[] => messages.slice(from).flatMap((message) => (message.type === 'token-move-refused' ? [message.tokenId] : []));

describe('a split party in the risky windows', () => {
  it('a slow switch on a lit scene: nothing done while the store loads reaches anyone, and nothing crosses scenes', async () => {
    const { w, anna, ben, cy, sceneOf } = await party({ lighting: true, loadDelayMs: LOAD_MS });
    const [a, b, c] = [sceneOf('a'), sceneOf('b'), sceneOf('c')];
    const [benFrom, cyFrom] = [clearAt(ben), clearAt(cy)];
    const xOf = (id: string): number | undefined => w.atlas.views.sceneOf(VIEW)?.objects.tokens[id]?.x;

    // The GM is on Cave and starts back to Bridge: activeTabId is Bridge, the store still holds Cave until it loads.
    const switching = w.atlas.views.switchTab(VIEW, 'b', { loadDelayMs: LOAD_MS });
    await vi.advanceTimersByTimeAsync(LOAD_MS / 4);
    w.editTokens({ midswitchgm: character('midswitchgm', 900) });
    moveCamera(w, 1234);
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 17, y: 17 });
    sendLaser(ben, b, 31);
    sendLaser(cy, c, 32);
    dropToken(ben, b, TOKEN.b, 455);
    for (const player of [anna, ben, cy]) greedy(player);
    await vi.advanceTimersByTimeAsync(LOAD_MS / 4);
    // The GM pans on again before the load ends: Bridge's players may get this one once it is shown, never the first.
    moveCamera(w, 1000);
    // Ben's move during the load is not applied: there is no shown scene to apply it to.
    expect(xOf(TOKEN.b)).not.toBe(455);
    // Bridge loads; its sight is pending until the GM's view has worked it out, then it is ready.
    await vi.advanceTimersByTimeAsync(LOAD_MS);
    await switching;
    await vi.advanceTimersByTimeAsync(500);
    w.atlas.lighting.setVisibility(VIEW, BRIDGE_SEEN());
    await vi.advanceTimersByTimeAsync(60);
    w.editTokens({ bridgegm: character('bridgegm', 650) });
    moveCamera(w, 800);
    await w.tick();

    const everyone = [anna, ben, cy];
    for (const player of everyone) {
      const text = textOf(player.frames);
      for (const word of ['midswitchgm', '1234', '"x":17', '"x":455']) expect(text.includes(word), `${word} reached ${player.key}`).toBe(false);
    }
    // Ben's laser stayed on Bridge, Cy's on Cave.
    expect(textOf(anna.frames).includes('"x":31') || textOf(anna.frames).includes('"x":32')).toBe(false);
    expect(textOf(cy.frames).includes('"x":31')).toBe(false);
    expect(textOf(ben.frames.slice(benFrom)).includes('"x":32')).toBe(false);
    expectNothingOf(anna, anna.frames, secretsOf('b', [b]), 'Anna, Bridge');
    expectNothingOf(anna, anna.frames, secretsOf('c', [c]), 'Anna, Cave');
    expectNothingOf(ben, ben.frames.slice(benFrom), secretsOf('a', [a]), 'Ben, Ambush');
    expectNothingOf(ben, ben.frames.slice(benFrom), secretsOf('c', [c]), 'Ben, Cave');
    expectNothingOf(cy, cy.frames.slice(cyFrom), secretsOf('a', [a]), 'Cy, Ambush');
    expectNothingOf(cy, cy.frames.slice(cyFrom), secretsOf('b', [b], ['bridgegm']), 'Cy, Bridge');
    expect(namesIn(anna.frames, ['b', 'c'])).toEqual([]);
    // Bridge's lit scene reached Ben once its sight was ready, and his own images only.
    expect(textOf(ben.frames).includes('bridgegm')).toBe(true);
    expect(assetsOf(ben.frames)).not.toContain(`asset-start:${idOf('maps/a.png')}`);
    expect(assetsOf(ben.frames)).not.toContain(`asset-start:${idOf('maps/c.png')}`);
    for (const player of everyone) expect(olderReplay(player.frames).resyncs, player.key).toBe(0);
  });

  it('a held presentation: a move on it is refused, Everyone back while held, and a presentation that starts held', async () => {
    const { w, anna, ben, cy, sceneOf } = await party();
    const a = sceneOf('a');
    // The GM is on Cave: Ambush, presented, is held and parked. Anna's move on it is refused.
    let from = anna.received.length;
    dropToken(anna, a, TOKEN.a, 500);
    await vi.advanceTimersByTimeAsync(0);
    expect(refusedOf(anna.received, from)).toEqual([TOKEN.a]);
    expect(w.atlas.views.sceneOf(VIEW)?.objects.tokens[TOKEN.a]).toBeUndefined(); // nothing landed on the GM's Cave

    // Everyone back while held: Ben and Cy get a clear, then Ambush as Anna has it, paused.
    const back = { ben: ben.received.length, cy: cy.received.length, benFrames: ben.frames.length };
    w.hub.everyoneBack();
    await vi.advanceTimersByTimeAsync(60);
    for (const player of [ben, cy]) {
      expect(typesOf(player, back[player.key as 'ben' | 'cy']).slice(0, 3)).toEqual(['scene-clear', 'scene-snapshot', 'scene-state']);
      expect(lastSceneId(player)).toBe(a);
      expect(player.received.at(-1)).toMatchObject({ type: 'scene-state', sceneId: a, paused: true });
    }
    expectNothingOf(ben, ben.frames.slice(back.benFrames), secretsOf('c', [sceneOf('c')]), 'Ben back on Ambush, Cave');

    // Den is presented while the GM stays on Cave: it starts held, so every follower is cleared and gets nothing of it.
    from = anna.received.length;
    const frames = { anna: anna.frames.length, ben: ben.frames.length, cy: cy.frames.length };
    await w.atlas.presentation.present(VIEW, 'd', { switchTab: false });
    await vi.advanceTimersByTimeAsync(60);
    w.editTokens({ cavegm: character('cavegm', 660) });
    await w.tick();
    expect(typesOf(anna, from)).toEqual(['scene-clear']);
    for (const player of [anna, ben, cy]) {
      const since = player.frames.slice(frames[player.key as 'anna' | 'ben' | 'cy']);
      for (const word of [TOKEN.d, TOKEN.c, 'cavegm']) expect(textOf(since).includes(word), `${word} reached ${player.key}`).toBe(false);
    }
    // The GM goes to Den: now it is live, and everyone gets it.
    await w.switchTo('d');
    for (const player of [anna, ben, cy]) expect(textOf(player.frames).includes(TOKEN.d), player.key).toBe(true);
  });

  it('closing the GM\'s own assigned tab sends its players back, and nothing of the tab that loads next', async () => {
    const { w, anna, cy, sceneOf } = await party({ loadDelayMs: LOAD_MS });
    const [a, c] = [sceneOf('a'), sceneOf('c')];
    // The GM is on Cave, Cy's tab, and closes it: its successor loads in its place.
    const from = { cy: cy.frames.length, anna: anna.frames.length, cyReceived: cy.received.length };
    w.atlas.views.closeTab(VIEW, 'c', { loadDelayMs: LOAD_MS });
    await vi.advanceTimersByTimeAsync(LOAD_MS + 60);
    await w.tick();
    expect(w.atlas.views.tabsOf(VIEW)?.activeTabId).not.toBe('c');
    // Cave parks as the GM leaves it (a paused state for Cy), then it is gone: a clear, then Ambush.
    const types = typesOf(cy, from.cyReceived).filter((type) => type !== 'scene-state');
    expect(types.slice(0, 2)).toEqual(['scene-clear', 'scene-snapshot']);
    expect(lastSceneId(cy)).toBe(a);
    expect(w.notices).toContain('cy went back to the presented scene: Cave was closed.');
    const successor = w.atlas.views.tabsOf(VIEW)!.activeTabId as 'a' | 'b' | 'd';
    // Unless the next tab is Ambush, where Cy now is, nothing of it reaches Cy.
    if (successor !== 'a') expectNothingOf(cy, cy.frames.slice(from.cy), secretsOf(successor, []), 'Cy, the next tab');
    expectNothingOf(cy, cy.frames.slice(clearAt(cy, from.cy)), secretsOf('c', [c]), 'Cy, Cave after its clear');
    if (successor === 'd') expectNothingOf(anna, anna.frames.slice(from.anna), secretsOf('d', []), 'Anna, the next tab');
  });

  it('a page that asks for images before its readmission is handled gets only its own scene\'s', async () => {
    const { w, ben, sceneOf } = await party();
    const b = sceneOf('b');
    ben.link.close();
    await vi.advanceTimersByTimeAsync(60);
    // The returning page joins and, in the same breath, asks for every image of every tab.
    const link = await w.network.client().connect('gm');
    const frames: RawFrame[] = [];
    link.onMessage((channel, data) => frames.push({ channel, data }));
    link.send('control', encodeControl({ v: 1, type: 'join', name: 'ben', playerKey: 'ben', client: { kind: 'web', version: '1' } }));
    assetClient({ key: 'ben', playerId: ben.playerId, received: [], frames, link }).request(Object.keys(IMAGES));
    await vi.advanceTimersByTimeAsync(200);
    const scenes = frames.flatMap((frame) => {
      const decoded = frame.channel === 'control' ? decodeControl(frame.data) : null;
      return decoded?.kind === 'message' && decoded.message.type === 'scene-snapshot' ? [decoded.message.scene.sceneId] : [];
    });
    expect(scenes).toEqual([b]);
    const started = assetsOf(frames).filter((entry) => entry.startsWith('asset-start:'));
    expect(started.length).toBeGreaterThan(0);
    const own = new Set([idOf('maps/b.png'), idOf(`art/${TOKEN.b}.png`)]);
    for (const entry of started) expect(own.has(entry.slice('asset-start:'.length)), entry).toBe(true);
    const player = { key: 'ben', playerId: ben.playerId, received: [], frames, link };
    expectNothingOf(player, frames, secretsOf('a', [sceneOf('a')]), 'returning Ben, Ambush');
    expectNothingOf(player, frames, secretsOf('c', [sceneOf('c')]), 'returning Ben, Cave');
  });
});
