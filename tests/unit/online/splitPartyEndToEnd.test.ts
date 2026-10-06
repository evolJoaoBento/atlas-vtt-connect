/**
 * A split party end to end (B13, Review Focus 3): a real GM session, the scene hub and every part the hosted session
 * runs (camera, images, token control, dice, lasers), three players on three tabs, and every raw frame each player's
 * link received, the assets channel's binary chunks included.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeControl } from '../../../src/app/online/protocol';
import { character, lastSceneId, TOKEN, typesOf, VIEW } from './splitFixtures';
import { dropToken, idOf, moveCamera, rollD6, sendLaser } from './splitParts';
import { assetsOf, bytesOf, expectNothingOf, fog, greedy, namesIn, olderReplay, party, secretsOf, textOf } from './splitPrivacy';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('a split party end to end', () => {
  it('no byte of B reaches a player on A', async () => {
    const { w, anna, ben, cy, sceneOf } = await party();
    const [a, b, c] = [sceneOf('a'), sceneOf('b'), sceneOf('c')];
    expect(new Set([a, b, c]).size).toBe(3);
    const benFrom = ben.frames.findIndex((frame) => typeof frame.data === 'string' && frame.data.includes('"scene-clear"'));
    const cyFrom = cy.frames.findIndex((frame) => typeof frame.data === 'string' && frame.data.includes('"scene-clear"'));
    expect(benFrom).toBeGreaterThan(0);
    for (const player of [anna, ben, cy]) greedy(player);

    // The GM edits on Ambush, moves the camera there, then switches to Bridge.
    await w.switchTo('a');
    w.editTokens({ ambushgm: character('ambushgm', 600) });
    moveCamera(w, 700);
    await w.tick();
    await w.switchTo('b');
    await w.tick();
    // On Bridge: an edit, the camera, Ben's move, lasers (the GM's and Ben's), rolls, and fog revealed.
    w.editTokens({ bridgegm: character('bridgegm', 650) });
    moveCamera(w, 800);
    dropToken(ben, b, TOKEN.b, 420);
    w.atlas.lasers.emitLocal(VIEW, { kind: 'point', x: 9, y: 9 });
    sendLaser(ben, b, 30);
    await w.tick();
    rollD6(ben);
    rollD6(anna);
    const scene = w.atlas.views.sceneOf(VIEW)!;
    w.atlas.views.update(VIEW, { objects: { ...scene.objects, fog: { bridgefogpaint: fog('bridgefogpaint', false), bridgefogreveal: fog('bridgefogreveal', true) } } });
    await w.tick();
    for (const player of [anna, ben, cy]) greedy(player);
    await w.tick();
    // Then to Cave, and Bridge closes.
    await w.switchTo('c');
    w.editTokens({ cavegm: character('cavegm', 660) });
    await w.tick();
    const benBeforeClose = ben.frames.length;
    w.atlas.views.removeTab(VIEW, 'b');
    await vi.advanceTimersByTimeAsync(60);
    await w.tick();

    // The capture holds the assets channel: each player's own images streamed, as binary chunks; another scene's were denied.
    expect(assetsOf(anna.frames)).toEqual(expect.arrayContaining([`asset-start:${idOf('maps/a.png')}`, `asset-denied:${idOf('maps/b.png')}`, `asset-denied:${idOf(`art/${TOKEN.b}.png`)}`]));
    expect(assetsOf(ben.frames)).toEqual(expect.arrayContaining([`asset-start:${idOf('maps/b.png')}`, `asset-denied:${idOf('maps/c.png')}`]));
    expect(anna.frames.some((frame) => frame.channel === 'assets' && bytesOf(frame.data) !== null)).toBe(true);
    expectNothingOf(anna, anna.frames, secretsOf('b', [b]), 'Anna, Bridge');
    expectNothingOf(anna, anna.frames, secretsOf('c', [c]), 'Anna, Cave');
    expectNothingOf(ben, ben.frames.slice(benFrom, benBeforeClose), secretsOf('a', [a]), 'Ben, Ambush before Bridge closed');
    expectNothingOf(ben, ben.frames.slice(benFrom), secretsOf('c', [c]), 'Ben, Cave');
    expectNothingOf(cy, cy.frames.slice(cyFrom), secretsOf('a', [a]), 'Cy, Ambush');
    expectNothingOf(cy, cy.frames.slice(cyFrom), secretsOf('b', [b]), 'Cy, Bridge');
    // Another scene's name reaches a player only as a roller's scene in the dice log (P9).
    expect(namesIn(anna.frames, ['b', 'c'])).toEqual([]);
    expect(namesIn(cy.frames.slice(cyFrom), ['a', 'b'])).toEqual([]);
    const labelled = anna.received.flatMap((message) => (message.type === 'dice-log' ? message.entries : [])).map((entry) => entry.scene);
    expect(labelled).toContain('Bridge');

    // Bridge closed: Ben's first scene message is a clear, then Ambush's snapshot.
    const after = ben.frames.slice(benBeforeClose).flatMap((frame) => {
      const decoded = frame.channel === 'control' && typeof frame.data === 'string' ? decodeControl(frame.data) : null;
      return decoded?.kind === 'message' && decoded.message.type.startsWith('scene-') ? [decoded.message] : [];
    });
    expect(after.slice(0, 2).map((message) => message.type)).toEqual(['scene-clear', 'scene-snapshot']);
    expect(after[1]?.type === 'scene-snapshot' && after[1].scene.sceneId).toBe(a);
    expect(w.notices).toContain('ben went back to the presented scene: Bridge was closed.');
    // An older page given Ben's frames follows every move with no gap in its sequence, and ends on Ambush as sent.
    expect(olderReplay(ben.frames)).toEqual({ scene: w.hub.slotOf(ben.playerId)!.lastSent, resyncs: 0 });
  });

  it('a reconnecting player lands on their assigned scene', async () => {
    const { w, ben, sceneOf } = await party();
    const b = sceneOf('b');
    ben.link.close();
    await vi.advanceTimersByTimeAsync(60);
    const again = await w.join('ben');
    await vi.advanceTimersByTimeAsync(60);
    // A returning player is let back in as who they were, by their player key: no new request, the same player id.
    expect(w.gm.getPlayers().filter((player) => player.name === 'ben')).toEqual([expect.objectContaining({ playerId: ben.playerId, status: 'admitted' })]);
    expect(lastSceneId(again)).toBe(b);
    expect(textOf(again.frames).includes(TOKEN.a)).toBe(false);
    expect(again.received.find((message) => message.type === 'scene-state')).toMatchObject({ sceneId: b, paused: true });
  });

  it('everyone back sends every player A\'s snapshot after a clear', async () => {
    const { w, anna, ben, cy, sceneOf } = await party();
    const a = sceneOf('a');
    const from = { anna: anna.received.length, ben: ben.received.length, cy: cy.received.length };
    w.hub.everyoneBack();
    await vi.advanceTimersByTimeAsync(60);
    for (const player of [ben, cy]) {
      expect(typesOf(player, from[player.key as 'ben' | 'cy']).slice(0, 2)).toEqual(['scene-clear', 'scene-snapshot']);
      expect(lastSceneId(player)).toBe(a);
    }
    expect(typesOf(anna, from.anna).filter((type) => type === 'scene-clear' || type === 'scene-snapshot')).toEqual([]);
    expect(w.hub.splitActive()).toBe(false);
  });
});
