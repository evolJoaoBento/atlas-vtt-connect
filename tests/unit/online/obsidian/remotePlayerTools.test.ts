import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatch } from '../../../../src/app/online/scene/sceneDiff';
import { LASER_PALETTE } from '../../../../src/app/online/tools/laserColors';
import { CONFIRM_TIMEOUT_MS, MOVE_REFUSED_TEXT, REFUSED_NOTICE_MS } from '../../../../src/app/online/view/TokenMoves';
import { playerScene, playerToken } from '../sceneFixtures';
import { admitted, remoteSceneSetup } from './remoteSceneFixtures';

/** An admitted player with t1 on the scene and theirs to move, on a grid without snapping so drops land as given. */
async function ready(options: Parameters<typeof remoteSceneSetup>[0] = {}) {
  const t = await remoteSceneSetup(options);
  const base = playerScene();
  const scene = playerScene({
    tokens: { t1: playerToken({ name: 'Hero' }), t2: playerToken({ x: 300 }) },
    measurement: { ...base.measurement, snapToGrid: false },
  });
  t.sink().session(admitted());
  t.sink().control(['t1']);
  t.sink().scene(scene);
  const token = (): { x: number; y: number } | undefined => t.handle.scene?.objects.tokens.t1;
  return { ...t, scene, token };
}

describe('player tools in the remote view', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends one token-move per drop and keeps the token there until the GM answers', async () => {
    const t = await ready();
    t.handle.drop('t1', { x: 210, y: 140 });
    expect(t.fake.sendTokenMove).toHaveBeenCalledOnce();
    expect(t.fake.sendTokenMove).toHaveBeenCalledWith('t1', 210, 140);
    expect(t.token()).toMatchObject({ x: 210, y: 140 });
    // A patch about another token is no answer.
    t.sink().scene(applyPatch(t.scene, { set: {}, upsert: { tokens: { t2: playerToken({ x: 370 }) } }, remove: {} }));
    expect(t.token()).toMatchObject({ x: 210, y: 140 });
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS);
    expect(t.token()).toMatchObject({ x: 100, y: 100 });
  });

  it("takes the GM's answer: the token where the GM's scene puts it", async () => {
    const t = await ready();
    t.handle.drop('t1', { x: 210, y: 140 });
    t.sink().scene(applyPatch(t.scene, { set: {}, upsert: { tokens: { t1: playerToken({ name: 'Hero', x: 245, y: 175 }) } }, remove: {} }));
    expect(t.token()).toMatchObject({ x: 245, y: 175 });
  });

  it('snaps a refused move back, ends the drag and says so for three seconds', async () => {
    const t = await ready();
    t.handle.drop('t1', { x: 210, y: 140 });
    t.sink().moveRefused('t1');
    expect(t.token()).toMatchObject({ x: 100, y: 100 });
    expect(t.handle.count('cancelDrag')).toBe(1);
    expect(t.handle.status?.message).toBe(MOVE_REFUSED_TEXT);
    vi.advanceTimersByTime(REFUSED_NOTICE_MS);
    expect(t.handle.status?.message).toBeNull();
  });

  it('sends nothing for a token the GM did not give, nor once the session is over', async () => {
    const t = await ready();
    t.handle.drop('t2', { x: 210, y: 140 });
    t.sink().session({ ...admitted(), status: 'lost', reason: 'ended' });
    t.handle.drop('t1', { x: 210, y: 140 });
    expect(t.fake.sendTokenMove).not.toHaveBeenCalled();
    expect(t.token()).toMatchObject({ x: 100, y: 100 });
  });

  it('sends nothing for a token that has left the scene', async () => {
    const t = await ready();
    t.sink().scene(applyPatch(t.scene, { set: {}, upsert: {}, remove: { tokens: ['t1'] } }));
    t.handle.drop('t1', { x: 210, y: 140 });
    expect(t.fake.sendTokenMove).not.toHaveBeenCalled();
  });

  it('takes a token from the player when the GM takes it back or the connection goes, so Atlas ends the drag', async () => {
    const t = await ready();
    expect(t.handle.player?.movableTokenIds).toEqual(['t1']);
    t.sink().control([]);
    expect(t.handle.player?.movableTokenIds).toEqual([]);
    t.sink().control(['t1']);
    t.sink().session({ ...admitted(), status: 'lost', reason: 'ended' });
    expect(t.handle.player?.movableTokenIds).toEqual([]);
  });

  it('hands Atlas the same token record again while nothing about it changed', async () => {
    const t = await ready();
    const before = t.handle.calls.filter((call) => call.method === 'setScene').at(-1)?.args[0] as { objects: { tokens: Record<string, unknown> } };
    t.sink().scene(applyPatch(t.scene, { set: {}, upsert: { tokens: { t2: playerToken({ x: 370 }) } }, remove: {} }));
    const after = t.handle.calls.filter((call) => call.method === 'setScene').at(-1)?.args[0] as { objects: { tokens: Record<string, unknown> } };
    expect(after.objects.tokens.t1).toBe(before.objects.tokens.t1);
    expect(after.objects.tokens.t2).not.toBe(before.objects.tokens.t2);
  });

  it("sends the player's laser in their Atlas colour", async () => {
    const t = await ready({ laserColor: LASER_PALETTE[2]! });
    t.atlas.lasers.emitLocal(t.view.viewId, { kind: 'point', x: 12, y: 34 });
    expect(t.fake.sendLaser).toHaveBeenLastCalledWith([{ x: 12, y: 34 }], false, [0], LASER_PALETTE[2]);
  });

  it('stops sending drops and lasers once disposed', async () => {
    const t = await ready();
    t.client.dispose();
    t.handle.drop('t1', { x: 210, y: 140 });
    t.atlas.lasers.emitLocal(t.view.viewId, { kind: 'point', x: 1, y: 1 });
    expect(t.fake.sendTokenMove).not.toHaveBeenCalled();
    expect(t.fake.sendLaser).not.toHaveBeenCalled();
  });
});
