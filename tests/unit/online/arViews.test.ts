import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, PLAYER_MESSAGE_TYPES, type ControlMessage } from '../../../src/app/online/protocol';
import { ArViewRelay } from '../../../src/app/online/tools/ArViewRelay';
import { BoardSessionHub, type BoardViewer } from '../../../src/app/online/tools/BoardSessionHub';
import { isArPose, type ArPose } from '../../../src/app/online/tools/arViews';
import { ViewSender, VIEW_EVERY_MS, VIEW_HEARTBEAT_MS } from '../../../online-client/ar/viewSender.mts';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
const pose = (x: number, quaternion: ArPose['quaternion'] = [0, 0, 0, 1]): ArPose => ({ position: [x, 400, 200], quaternion });

describe('the AR view on the wire', () => {
  it('is a player message, with a pose or null', () => {
    expect(PLAYER_MESSAGE_TYPES.has('ar-view')).toBe(true);
    for (const message of [
      { v: 1, type: 'ar-view', sceneId: 's1', pose: pose(1) },
      { v: 1, type: 'ar-view', sceneId: 's1', pose: null },
    ] as ControlMessage[]) {
      expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    }
  });

  it('refuses a broken pose', () => {
    for (const bad of [
      { position: [1, 2], quaternion: [0, 0, 0, 1] },
      { position: [1, 2, 1e9], quaternion: [0, 0, 0, 1] },
      { position: [1, 2, 3], quaternion: [0, 0, 0, 3] },
      { position: [1, 2, 3], quaternion: [0, 0, 0, 0] },
      { position: [1, 2, '3'], quaternion: [0, 0, 0, 1] },
    ]) {
      expect(isArPose(bad)).toBe(false);
      expect(decodeControl(JSON.stringify({ v: 1, type: 'ar-view', sceneId: 's1', pose: bad })).kind).toBe('invalid');
    }
  });

  it('is about 150 bytes a message', () => {
    const wire = encodeControl({ v: 1, type: 'ar-view', sceneId: 'scene-1234', pose: { position: [1234.56, 812.34, 2048.12], quaternion: [-0.70711, 0.01234, -0.01234, 0.70699] } });
    expect(wire.length).toBeLessThan(170);
  });
});

describe('the page sends the camera', () => {
  it('ten times a second at most while it moves, once a second while still, and null once when it goes', () => {
    const sent: Array<ArPose | null> = [];
    const sender = new ViewSender((given) => { sent.push(given); return true; });
    sender.update(pose(0), 0);
    sender.update(pose(5), 50);
    expect(sent.length).toBe(1);
    sender.update(pose(5), VIEW_EVERY_MS);
    expect(sent.length).toBe(2);
    // Still: only the heartbeat.
    for (let t = VIEW_EVERY_MS * 2; t < VIEW_EVERY_MS + VIEW_HEARTBEAT_MS; t += VIEW_EVERY_MS) sender.update(pose(5), t);
    expect(sent.length).toBe(2);
    sender.update(pose(5), VIEW_EVERY_MS + VIEW_HEARTBEAT_MS);
    expect(sent.length).toBe(3);
    // A turn counts as a move.
    const turned: ArPose['quaternion'] = [Math.sin(0.05), 0, 0, Math.cos(0.05)];
    sender.update(pose(5, turned), VIEW_EVERY_MS * 2 + VIEW_HEARTBEAT_MS);
    expect(sent.length).toBe(4);
    sender.update(null, 5000);
    sender.update(null, 5100);
    sender.stop();
    expect(sent.slice(4)).toEqual([null]);
  });

  it('rounds what it sends', () => {
    const sent: Array<ArPose | null> = [];
    new ViewSender((given) => { sent.push(given); return true; }).update({ position: [1.23456, 2, 3], quaternion: [0.1234567, 0, 0, Math.sqrt(1 - 0.1234567 ** 2)] }, 0);
    expect(sent[0]!.position[0]).toBe(1.23);
    expect(sent[0]!.quaternion[0]).toBe(0.12346);
  });
});

describe("the GM's board hears of players in AR", () => {
  function relay(slot: { sceneId: string; mapPath: string } | null = { sceneId: 's1', mapPath: 'Maps/a.md' }) {
    let handler: SessionHandler | null = null;
    const sent: unknown[] = [];
    const viewer = vi.fn();
    const where = { slot };
    const arViews = new ArViewRelay({
      session: { use: (h: SessionHandler) => { handler = h; return () => undefined; }, send: (id: string, m: unknown) => { sent.push([id, m]); }, getPlayers: () => [ANA, BEN] } as never,
      projection: { slotOf: () => (where.slot ? { ...where.slot, lastSent: {} } : null) } as never,
      board: { viewer, survey: vi.fn() },
    });
    arViews.start();
    const send = (message: Partial<ControlMessage> & Record<string, unknown>, from = ANA): void => handler!.onMessage?.(from, { v: 1, type: 'ar-view', sceneId: 's1', ...message } as ControlMessage);
    return { arViews, viewer, sent, send, where, gone: (player: SessionPlayer) => handler!.onGone?.(player) };
  }

  it("as an eye of the sender's map, in their colour and with their name, never to other players", () => {
    const { viewer, sent, send } = relay();
    send({ pose: pose(10) });
    expect(viewer).toHaveBeenCalledWith('Maps/a.md', 'p1', 'Ana', expect.stringMatching(/^#/), pose(10));
    expect(sent).toEqual([]);
    send({ pose: null });
    expect(viewer).toHaveBeenLastCalledWith('Maps/a.md', 'p1', 'Ana', expect.any(String), null);
  });

  it('not for another scene, and the eye goes when the player leaves or the session stops', () => {
    const { arViews, viewer, send, gone } = relay();
    send({ sceneId: 'other', pose: pose(1) });
    expect(viewer).not.toHaveBeenCalled();
    send({ pose: pose(1) });
    gone(ANA);
    expect(viewer).toHaveBeenLastCalledWith('Maps/a.md', 'p1', 'Ana', expect.any(String), null);
    send({ pose: pose(2) }, BEN);
    arViews.stop();
    expect(viewer).toHaveBeenLastCalledWith('Maps/a.md', 'p2', 'Ben', expect.any(String), null);
  });

  it('moves the eye off the old map when the player is shown another', () => {
    const { viewer, send, where } = relay();
    send({ pose: pose(1) });
    where.slot = { sceneId: 's1', mapPath: 'Maps/b.md' };
    send({ pose: pose(2) });
    expect(viewer.mock.calls.map((call) => [call[0], call[4] === null])).toEqual([['Maps/a.md', false], ['Maps/a.md', true], ['Maps/b.md', false]]);
  });

  it('at most fifteen a second', () => {
    const { viewer, send } = relay();
    for (let i = 0; i < 40; i++) send({ pose: pose(i) });
    expect(viewer.mock.calls.length).toBe(15);
  });

  it('through the board hub, while it is started', () => {
    const hub = new BoardSessionHub({
      projection: { shownSlot: () => null, onSlotChange: () => () => undefined } as never,
      handouts: { current: () => null, subscribe: () => () => undefined } as never,
      coneAngle: () => 90,
    });
    const heard: BoardViewer[] = [];
    hub.onViewer((viewer) => heard.push(viewer));
    hub.viewer('Maps/a.md', 'p1', 'Ana', '#ff0059', pose(1));
    expect(heard).toEqual([]);
    hub.start();
    hub.viewer('Maps/a.md', 'p1', 'Ana', '#ff0059', pose(1));
    expect(heard).toEqual([{ mapPath: 'Maps/a.md', from: 'p1', name: 'Ana', color: '#ff0059', pose: pose(1) }]);
  });
});
