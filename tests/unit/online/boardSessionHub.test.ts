import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { BoardSessionHub } from '../../../src/app/online/tools/BoardSessionHub';
import { TemplateHost } from '../../../src/app/online/tools/TemplateHost';
import type { SlotChange, SlotView } from '../../../src/app/online/scene/slotViews';

const who = (playerId: string): SessionPlayer => ({ playerId, name: playerId, status: 'admitted' });

function world() {
  const handlers: SessionHandler[] = [];
  const sent: Array<[string, ControlMessage]> = [];
  const session = {
    use: (handler: SessionHandler) => { handlers.push(handler); return () => undefined; },
    send: (playerId: string, message: ControlMessage) => { sent.push([playerId, message]); },
    getPlayers: () => [who('anna'), who('ben')],
  };
  const slot: SlotView = { tab: { viewId: 'v', tabId: 't' }, sceneId: 's1', state: 'live', lastSent: { sceneId: 's1' } as never, mapPath: 'maps/a.atlasmap', name: 'A' };
  const listeners = new Set<(change: SlotChange) => void>();
  const projection = {
    slotOf: () => slot, audience: () => ['anna', 'ben'], shownSlot: () => slot,
    onSlotChange: (listener: (change: SlotChange) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  let handout: { path: string; title: string } | null = null;
  const handoutListeners = new Set<() => void>();
  const hub = new BoardSessionHub({
    projection,
    handouts: { current: () => handout, subscribe: (listener) => { handoutListeners.add(listener); return () => handoutListeners.delete(listener); } },
    coneAngle: () => 53,
  });
  const templates = new TemplateHost({ session, projection, board: hub });
  hub.useTemplates(templates);
  templates.start();
  hub.start();
  const playerSends = (playerId: string, message: ControlMessage) => { for (const handler of handlers) handler.onMessage?.(who(playerId), message); };
  const showHandout = (next: typeof handout) => { handout = next; for (const listener of [...handoutListeners]) listener(); };
  return { hub, templates, sent, playerSends, showHandout, listeners, slot };
}

describe('BoardSessionHub', () => {
  it('is hosting while started, and names the presented map', () => {
    const w = world();
    expect(w.hub.hosting()).toBe(true);
    expect(w.hub.presentedMap()).toBe('maps/a.atlasmap');
    w.hub.stop();
    expect(w.hub.hosting()).toBe(false);
  });

  it('a player\'s template shows on the GM\'s board of that map, with the cone angle', () => {
    const w = world();
    const changed = vi.fn();
    w.hub.onChange(changed);
    w.playerSends('anna', { v: 1, type: 'map-template', sceneId: 's1', add: { shape: 'circle', start: { x: 0, y: 0 }, end: { x: 70, y: 0 } } });
    expect(changed).toHaveBeenCalled();
    const overlay = w.hub.overlay('maps/a.atlasmap');
    expect(overlay.templates).toEqual([expect.objectContaining({ owner: 'anna', shape: 'circle' })]);
    expect(overlay.coneAngle).toBeCloseTo((53 * Math.PI) / 180);
    expect(w.hub.overlay('maps/other.atlasmap').templates).toEqual([]);
  });

  it('the GM places a template from the board, and erases any; every player is told', () => {
    const w = world();
    expect(w.hub.addTemplate('maps/a.atlasmap', { shape: 'square', start: { x: 0, y: 0 }, end: { x: 140, y: 140 } })).toBe(true);
    const [placed] = w.hub.overlay('maps/a.atlasmap').templates;
    expect(placed).toMatchObject({ owner: 'gm', shape: 'square', color: '#ff0059' });
    const lists = () => w.sent.filter(([, message]) => message.type === 'map-templates');
    expect(lists().map(([playerId]) => playerId)).toEqual(['anna', 'ben']);
    w.playerSends('anna', { v: 1, type: 'map-template', sceneId: 's1', add: { shape: 'line', start: { x: 0, y: 0 }, end: { x: 70, y: 70 } } });
    const annas = w.hub.overlay('maps/a.atlasmap').templates.find((template) => template.owner === 'anna')!;
    w.hub.eraseTemplate('maps/a.atlasmap', annas.id);
    expect(w.hub.overlay('maps/a.atlasmap').templates.map((template) => template.owner)).toEqual(['gm']);
    const last = lists().at(-1)![1] as Extract<ControlMessage, { type: 'map-templates' }>;
    expect(last.templates.map((template) => template.owner)).toEqual(['gm']);
    w.hub.clearTemplates('maps/a.atlasmap');
    expect(w.hub.overlay('maps/a.atlasmap').templates).toEqual([]);
    expect(w.hub.addTemplate('maps/nowhere.atlasmap', { shape: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } })).toBe(false);
  });

  it('pings and lasers players send reach the GM\'s board as marks of their map', () => {
    const w = world();
    const marks: unknown[] = [];
    w.hub.onMark((mark) => marks.push(mark));
    w.hub.ping('maps/a.atlasmap', 10, 20, '#00a9ff');
    w.hub.laser('maps/a.atlasmap', 'anna', [{ x: 1, y: 2 }], true, '#00a9ff');
    expect(marks).toEqual([
      { kind: 'ping', mapPath: 'maps/a.atlasmap', x: 10, y: 20, color: '#00a9ff' },
      { kind: 'laser', mapPath: 'maps/a.atlasmap', from: 'anna', points: [{ x: 1, y: 2 }], lifted: true, color: '#00a9ff' },
    ]);
  });

  it('the handout the GM shows is on the board, and a change is told', () => {
    const w = world();
    const changed = vi.fn();
    w.hub.onChange(changed);
    w.showHandout({ path: 'handouts/map.png', title: 'Old map' });
    expect(changed).toHaveBeenCalled();
    expect(w.hub.overlay('maps/a.atlasmap').handout).toEqual({ path: 'handouts/map.png', title: 'Old map' });
  });

  it('a projection that changes nothing the board shows tells it nothing', () => {
    const w = world();
    const changed = vi.fn();
    w.hub.onChange(changed);
    for (const listener of [...w.listeners]) listener({ kind: 'projected', slot: w.slot });
    for (const listener of [...w.listeners]) listener({ kind: 'projected', slot: w.slot });
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
