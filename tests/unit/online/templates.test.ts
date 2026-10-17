import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { TemplateHost } from '../../../src/app/online/tools/TemplateHost';
import { TEMPLATE_LIMITS, templateContains, type MapTemplate } from '../../../src/app/online/tools/templates';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
const add = (x = 0) => ({ v: 1 as const, type: 'map-template' as const, sceneId: 's1', add: { shape: 'circle' as const, start: { x, y: 0 }, end: { x: x + 10, y: 0 } } });

function world() {
  const sent: Array<[string, ControlMessage]> = [];
  let handler: SessionHandler | null = null;
  const show = vi.fn();
  let now = 0;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const host = new TemplateHost({
    session: { use: (h: SessionHandler) => { handler = h; return () => undefined; }, send: (id: string, m: ControlMessage) => { sent.push([id, m]); }, getPlayers: () => [ANA, BEN] } as never,
    projection: {
      slotOf: () => ({ sceneId: 's1', lastSent: {}, tab: { viewId: 'v1' }, mapPath: 'm' }),
      audience: () => ['p1', 'p2'],
      shownSlot: () => ({ sceneId: 's1', tab: { viewId: 'v1' }, mapPath: 'm' }),
      onSlotChange: () => () => undefined,
    } as never,
    show,
  });
  host.start();
  const last = (playerId: string): MapTemplate[] => {
    const message = sent.filter(([to, m]) => to === playerId && m.type === 'map-templates').at(-1)?.[1] as Extract<ControlMessage, { type: 'map-templates' }> | undefined;
    return message?.templates ?? [];
  };
  return { host, show, last, send: (player: SessionPlayer, message: ControlMessage) => handler!.onMessage?.(player, message), tick: () => { now += 1000; } };
}

describe('lasting templates', () => {
  it('are kept per scene with their owner and colour, sent to everyone on it and shown to the GM', () => {
    const w = world();
    w.send(ANA, add());
    expect(w.last('p2')).toEqual([{ id: 't1', owner: 'p1', shape: 'circle', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, color: expect.stringMatching(/^#/) }]);
    expect(w.last('p1')).toHaveLength(1);
    expect(w.show).toHaveBeenLastCalledWith('v1', w.last('p1'), 'm', expect.any(Function));
  });

  it('can be removed only by their owner, and all of them by the GM', () => {
    const w = world();
    w.send(ANA, add());
    w.send(BEN, { v: 1, type: 'map-template', sceneId: 's1', remove: 't1' });
    expect(w.last('p1')).toHaveLength(1);
    w.send(ANA, { v: 1, type: 'map-template', sceneId: 's1', remove: 't1' });
    expect(w.last('p1')).toEqual([]);
    w.tick();
    w.send(ANA, add());
    expect(w.host.hasAny()).toBe(true);
    w.host.clear();
    expect(w.last('p2')).toEqual([]);
    expect(w.host.hasAny()).toBe(false);
  });

  it('keep to their limits and to the scene the player has', () => {
    const w = world();
    for (let index = 0; index < TEMPLATE_LIMITS.perPlayer + 2; index++) {
      w.tick();
      w.send(ANA, add(index * 20));
    }
    expect(w.last('p1')).toHaveLength(TEMPLATE_LIMITS.perPlayer);
    w.tick();
    w.send(BEN, { ...add(), sceneId: 'other' });
    expect(w.last('p1')).toHaveLength(TEMPLATE_LIMITS.perPlayer);
  });

  it('go when their owner leaves the session', () => {
    const w = world();
    w.send(ANA, add());
    w.host.playersChanged([BEN]);
    expect(w.last('p2')).toEqual([]);
  });

  it("lets a player clear all of theirs, and the GM erase anyone's", () => {
    const w = world();
    const p1 = ANA;
    const p2 = BEN;
    w.send(p1, add());
    w.tick();
    w.send(p1, add());
    w.tick();
    w.send(p2, add());
    w.tick();
    w.send(p1, { v: 1, type: 'map-template', sceneId: 's1', clear: true });
    expect(w.last('p1').map((template) => template.owner)).toEqual(['p2']);
    const erase = w.show.mock.lastCall![3] as (id: string) => void;
    erase(w.last('p1')[0]!.id);
    expect(w.last('p1')).toEqual([]);
  });

  it('pass the wire checks only as a single add or remove', () => {
    const kind = (message: unknown): string => decodeControl(encodeControl(message as ControlMessage)).kind;
    expect(kind(add())).toBe('message');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', remove: 't1' })).toBe('message');
    expect(kind({ ...add(), remove: 't1' })).toBe('invalid');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', add: { shape: 'square', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } })).toBe('message');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', add: { shape: 'hexagon', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } })).toBe('invalid');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', clear: true })).toBe('message');
    expect(kind({ v: 1, type: 'map-template', sceneId: 's1', clear: true, remove: 't1' })).toBe('invalid');
  });

  it('find whether a point lies on one', () => {
    const circle: MapTemplate = { id: 't', owner: 'p', shape: 'circle', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, color: '#ffffff' };
    expect(templateContains(circle, { x: 5, y: 5 }, Math.PI / 2, 0)).toBe(true);
    expect(templateContains(circle, { x: 20, y: 0 }, Math.PI / 2, 0)).toBe(false);
    const cone = { ...circle, shape: 'cone' as const };
    expect(templateContains(cone, { x: 8, y: 1 }, Math.PI / 2, 0)).toBe(true);
    expect(templateContains(cone, { x: -5, y: 0 }, Math.PI / 2, 0)).toBe(false);
    const line = { ...circle, shape: 'line' as const };
    expect(templateContains(line, { x: 5, y: 1 }, 0, 2)).toBe(true);
    expect(templateContains(line, { x: 5, y: 4 }, 0, 2)).toBe(false);
  });
});
