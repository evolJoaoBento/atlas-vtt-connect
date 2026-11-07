import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { LASER_PALETTE, laserColor } from '../../../src/app/online/tools/laserColors';
import { PlayerColors } from '../../../src/app/online/tools/playerColors';
import { TemplateHost } from '../../../src/app/online/tools/TemplateHost';

const ANA: SessionPlayer = { playerId: 'p1', name: 'Ana', status: 'admitted' };
const BEN: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
const picked = LASER_PALETTE[4]!;

function world() {
  const handlers: SessionHandler[] = [];
  const sent: Array<[string, ControlMessage]> = [];
  vi.spyOn(Date, 'now').mockImplementation(() => 0);
  const session = { use: (h: SessionHandler) => { handlers.push(h); return () => undefined; }, send: (id: string, m: ControlMessage) => { sent.push([id, m]); }, getPlayers: () => [ANA, BEN] };
  const colors = new PlayerColors(session as never);
  colors.start();
  const templates = new TemplateHost({
    session: session as never,
    projection: {
      slotOf: () => ({ sceneId: 's1', lastSent: {}, tab: { viewId: 'v1' }, mapPath: 'm' }),
      audience: () => ['p1', 'p2'],
      shownSlot: () => null,
      onSlotChange: () => () => undefined,
    } as never,
    colors,
  });
  templates.start();
  const send = (player: SessionPlayer, message: ControlMessage): void => { for (const handler of handlers) handler.onMessage?.(player, message); };
  return { colors, templates, sent, send };
}

describe('players\' own colours', () => {
  it('a player has their place\'s colour until they pick one, then theirs', () => {
    const w = world();
    expect(w.colors.colorOf('p1')).toBe(laserColor('p1', ['p1', 'p2']));
    w.send(ANA, { v: 1, type: 'player-color', color: picked.toUpperCase() });
    expect(w.colors.colorOf('p1')).toBe(picked);
    expect(w.colors.colorOf('p2')).toBe(laserColor('p2', ['p1', 'p2']));
  });

  it('only a swatch is taken, and a player who leaves loses theirs', () => {
    const w = world();
    w.send(ANA, { v: 1, type: 'player-color', color: '#123456' });
    expect(w.colors.colorOf('p1')).toBe(laserColor('p1', ['p1', 'p2']));
    w.send(ANA, { v: 1, type: 'player-color', color: picked });
    w.colors.playersChanged([BEN]);
    expect(w.colors.colorOf('p1', ['p2'])).toBe(laserColor('p1', ['p2']));
  });

  it('templates and spells take the colour picked, and are recoloured when it changes', () => {
    const w = world();
    w.send(ANA, { v: 1, type: 'map-template', sceneId: 's1', add: { shape: 'circle', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } } });
    w.send(ANA, { v: 1, type: 'map-spell', sceneId: 's1', add: { shape: 'sphere', from: 'point', at: { x: 0, y: 0, h: 0 }, yaw: 0, pitch: 0, roll: 0, size: 70, length: 0, angle: 0.9 } });
    w.send(ANA, { v: 1, type: 'player-color', color: picked });
    expect(w.templates.listFor('s1')[0]?.color).toBe(picked);
    expect(w.templates.spellsFor('s1')[0]?.color).toBe(picked);
    const lastSpells = w.sent.filter(([, m]) => m.type === 'map-spells').at(-1)?.[1] as Extract<ControlMessage, { type: 'map-spells' }>;
    expect(lastSpells.spells[0]?.color).toBe(picked);
  });

  it('the message carries a colour; an older GM ignores it', () => {
    const message: ControlMessage = { v: 1, type: 'player-color', color: picked };
    expect(decodeControl(encodeControl(message))).toEqual({ kind: 'message', message });
    expect(decodeControl(JSON.stringify({ v: 1, type: 'player-color', color: 'red' })).kind).toBe('invalid');
    expect(decodeControl(encodeControl(message), new Set(['laser'])).kind).toBe('ignored');
  });
});
