import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { TemplateHost } from '../../../src/app/online/tools/TemplateHost';
import type { Spell } from '../../../src/app/online/tools/spells';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const cone: Spell = { shape: 'cone', from: 'self', at: { x: 385, y: 385, h: 40 }, yaw: -1.57, pitch: -0.1, roll: 0, size: 280, length: 0, angle: 0.93, caster: 'mine' };
const addTemplate = { v: 1 as const, type: 'map-template' as const, sceneId: 's1', add: { shape: 'circle' as const, start: { x: 0, y: 0 }, end: { x: 10, y: 0 } } };
const castSpell = { v: 1 as const, type: 'map-spell' as const, sceneId: 's1', add: cone };

function world() {
  const sent: Array<[string, ControlMessage]> = [];
  let handler: SessionHandler | null = null;
  let now = 0;
  let running = true;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const host = new TemplateHost({
    session: { use: (h: SessionHandler) => { handler = h; return () => undefined; }, send: (id: string, m: ControlMessage) => { sent.push([id, m]); }, getPlayers: () => [ANA] } as never,
    projection: {
      slotOf: () => ({ sceneId: 's1', lastSent: {}, tab: { viewId: 'v1' }, mapPath: 'm' }),
      audience: () => ['p1'],
      shownSlot: () => ({ sceneId: 's1', tab: { viewId: 'v1' }, mapPath: 'm' }),
      onSlotChange: () => () => undefined,
    } as never,
    cutscene: { running: () => running },
  });
  host.start();
  return {
    host,
    send: (message: ControlMessage) => { now += 1000; handler!.onMessage?.(ANA, message); },
    end: () => { running = false; },
    begin: () => { running = true; },
    templates: () => host.listFor('s1').length,
    spells: () => host.spellsFor('s1').length,
  };
}

describe('players add no template or spell while a cutscene runs', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('ignores an add, and takes it again after the end', () => {
    const w = world();
    w.send(addTemplate);
    w.send(castSpell);
    expect(w.templates()).toBe(0);
    expect(w.spells()).toBe(0);
    w.end();
    w.send(addTemplate);
    w.send(castSpell);
    expect(w.templates()).toBe(1);
    expect(w.spells()).toBe(1);
  });

  it('still lets a player remove or clear their own while it runs', () => {
    const w = world();
    w.end();
    w.send(addTemplate);
    w.send(castSpell);
    w.begin();
    w.send({ v: 1, type: 'map-template', sceneId: 's1', remove: 't1' });
    w.send({ v: 1, type: 'map-spell', sceneId: 's1', clear: true });
    expect(w.templates()).toBe(0);
    expect(w.spells()).toBe(0);
    w.send(addTemplate);
    expect(w.templates()).toBe(0);
  });
});
