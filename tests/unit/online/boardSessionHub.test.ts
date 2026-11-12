import { describe, expect, it, vi } from 'vitest';
import type { SessionHandler, SessionPlayer } from '../../../src/app/online/GmSession';
import type { ControlMessage } from '../../../src/app/online/protocol';
import { BoardSessionHub } from '../../../src/app/online/tools/BoardSessionHub';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
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
    cutscenes: true,
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

describe('BoardSessionHub: tokens Tabletop moves to another scene', () => {
  it('hands a well-formed move to what hears of it while hosting, and nothing else', () => {
    const w = world();
    const heard = vi.fn();
    w.hub.useMoves(heard);
    const move = { from: 'maps/a.atlasmap', to: 'maps/up.atlasmap', tokens: [{ id: 'hero', newId: 'hero' }] };
    w.hub.tokensMoved(move);
    expect(heard).toHaveBeenCalledWith(move);
    w.hub.tokensMoved({ from: 'maps/a.atlasmap', to: 5, tokens: [] } as never);
    w.hub.tokensMoved({ from: 'maps/a.atlasmap', to: 'maps/up.atlasmap', tokens: [{ id: 3 }] } as never);
    expect(heard).toHaveBeenCalledTimes(1);
    w.hub.stop();
    w.hub.tokensMoved(move);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe('BoardSessionHub: "Controlled by" on Tabletop\'s board', () => {
  it('lists the admitted players with whether each controls the token, and ticks and unticks one', () => {
    const w = world();
    const control = new TokenControl();
    const players: SessionPlayer[] = [who('anna'), who('ben'), { playerId: 'cara', name: 'Cara', status: 'pending' } as SessionPlayer];
    w.hub.useControl({ control, players: () => players });
    control.set('hero', 'anna', true);
    expect(w.hub.controllers('hero')).toEqual([{ playerId: 'anna', name: 'anna', controls: true }, { playerId: 'ben', name: 'ben', controls: false }]);
    w.hub.setController('hero', 'ben', true);
    w.hub.setController('hero', 'anna', false);
    expect(control.playersOf('hero')).toEqual(['ben']);
    // A player not admitted (or unknown) is never given a token.
    w.hub.setController('hero', 'cara', true);
    w.hub.setController('hero', 'zed', true);
    expect(control.playersOf('hero')).toEqual(['ben']);
  });

  it('offers nothing while not hosting, or where the session hands out no tokens', () => {
    const w = world();
    expect(w.hub.controllers('hero')).toBeNull();
    w.hub.useControl({ control: new TokenControl(), players: () => [who('anna')] });
    w.hub.stop();
    expect(w.hub.controllers('hero')).toBeNull();
  });
});

describe('BoardSessionHub split party and resource shows (Tabletop\'s scene tabs and token menu)', () => {
  const tab = (tabId: string) => ({ viewId: 'v', tabId });
  function split() {
    const assigned: Record<string, { viewId: string; tabId: string }> = {};
    const calls: string[] = [];
    const scenes = {
      splitSupported: () => true,
      assign: async (playerId: string, to: { viewId: string; tabId: string }) => { calls.push(`assign ${playerId} ${to.tabId}`); assigned[playerId] = to; return 'ok' as const; },
      unassign: (playerId: string) => { calls.push(`unassign ${playerId}`); delete assigned[playerId]; },
      everyoneBack: () => { calls.push('everyone back'); },
      wouldExceedCap: () => false,
      assignedTabs: () => ({ ...assigned }),
      presented: () => tab('hall'),
    };
    const names: Record<string, string> = { hall: 'Hall', cellar: 'Cellar' };
    return { scenes, calls, assigned, source: { scenes, players: () => [who('anna'), who('ben')], nameOf: (key: { tabId: string }) => names[key.tabId] ?? null } };
  }

  it('offers a scene tab\'s Present to rows and carries out a row and Everyone back', async () => {
    const w = world();
    const s = split();
    w.hub.useSplit(s.source);
    const menu = w.hub.presentTo('v', 'cellar');
    expect(menu?.heading).toBe('Present to');
    expect(menu?.rows).toEqual([
      { playerId: 'anna', label: 'anna · on Hall', checked: false, disabled: false },
      { playerId: 'ben', label: 'ben · on Hall', checked: false, disabled: false },
    ]);
    expect(menu?.everyoneBack).toEqual({ label: 'Everyone back to the presented scene', disabled: true });
    w.hub.choosePresentTo('v', 'cellar', 'anna');
    await Promise.resolve();
    expect(s.calls).toEqual(['assign anna cellar']);
    const after = w.hub.presentTo('v', 'cellar');
    expect(after?.rows[0]).toEqual({ playerId: 'anna', label: 'anna', checked: true, disabled: false });
    expect(after?.everyoneBack.disabled).toBe(false);
    // On the presented tab a follower is ticked and fixed.
    expect(w.hub.presentTo('v', 'hall')?.rows[1]).toEqual({ playerId: 'ben', label: 'ben', checked: true, disabled: true });
    w.hub.choosePresentTo('v', 'cellar', 'anna');
    w.hub.everyoneBack();
    expect(s.calls).toEqual(['assign anna cellar', 'unassign anna', 'everyone back']);
  });

  it('has no Present to for an unknown tab, without a split party, or while not hosting', () => {
    const w = world();
    expect(w.hub.presentTo('v', 'cellar')).toBeNull();
    const s = split();
    w.hub.useSplit(s.source);
    expect(w.hub.presentTo('v', 'nowhere')).toBeNull();
    w.hub.useSplit({ ...s.source, scenes: { ...s.scenes, splitSupported: () => false } });
    expect(w.hub.presentTo('v', 'cellar')).toBeNull();
    w.hub.useSplit(s.source);
    w.hub.stop();
    expect(w.hub.presentTo('v', 'cellar')).toBeNull();
    w.hub.everyoneBack();
    expect(s.calls).toEqual([]);
  });

  it('hands out a token\'s Players see choices and saves one choice at a time', () => {
    const w = world();
    const saved: Array<Array<[string, string]>> = [];
    const options = [{ value: '', label: 'Same as every Goblin' }, { value: 'bar', label: 'Bar only' }, { value: 'hidden', label: 'Hidden' }];
    w.hub.useResourceShows((mapPath, tokenId) => (mapPath === 'maps/a.atlasmap' && tokenId === 'gob' ? {
      title: 'Players see', columns: ['This token', 'Every Goblin'],
      rows: [{ label: 'HP', choices: [{ id: 'token:hp', label: 'HP, this token', value: '', options }, { id: 'statblock:hp', label: 'HP, every goblin', value: 'bar', options }] }],
      save: (values) => { saved.push([...values]); },
    } : null));
    const shows = w.hub.resourceShows('maps/a.atlasmap', 'gob');
    expect(shows?.columns).toEqual(['This token', 'Every Goblin']);
    expect(shows?.rows[0]?.choices.map((choice) => [choice.id, choice.value])).toEqual([['token:hp', ''], ['statblock:hp', 'bar']]);
    expect(w.hub.resourceShows('maps/a.atlasmap', 'nobody')).toBeNull();
    w.hub.setResourceShow('maps/a.atlasmap', 'gob', 'token:hp', 'hidden');
    // Not an option, or not a choice: nothing saved.
    w.hub.setResourceShow('maps/a.atlasmap', 'gob', 'token:hp', 'sideways');
    w.hub.setResourceShow('maps/a.atlasmap', 'gob', 'token:ac', 'hidden');
    expect(saved).toEqual([[['token:hp', 'hidden']]]);
    w.hub.stop();
    expect(w.hub.resourceShows('maps/a.atlasmap', 'gob')).toBeNull();
  });
});
