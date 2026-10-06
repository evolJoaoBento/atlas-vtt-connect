import { describe, expect, it, vi } from 'vitest';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import {
  presentToButtonLabel, presentToMenu, tabBadgeText, type RowTab, type SplitActions, type SplitView,
} from '../../../src/app/online/gm-ui/presentToRows';
import type { TabKey } from '../../../src/app/online/split/tabKey';

const tabOf = (tabId: string): TabKey => ({ viewId: 'v', tabId });
const NAMES: Record<string, string> = { a: 'Ambush', b: 'Bridge', c: 'Cave', d: 'Den', e: 'East' };
const rowTab = (tabId: string): RowTab => ({ ...tabOf(tabId), name: NAMES[tabId]! });

const anna: SessionPlayer = { playerId: 'p1', name: 'Anna', status: 'admitted' };
const ben: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
const cy: SessionPlayer = { playerId: 'p3', name: 'Cy', status: 'pending' };
const dan: SessionPlayer = { playerId: 'p4', name: 'Dan', status: 'gone' };

function view(assignments: Record<string, string> = {}, presented: string | null = 'a', players = [anna, ben, cy, dan]): SplitView {
  const tabs = Object.fromEntries(Object.entries(assignments).map(([playerId, tabId]) => [playerId, tabOf(tabId)]));
  return { players, assignments: tabs, assignedCount: Object.keys(tabs).length, presented: presented ? tabOf(presented) : null, nameOf: (tab) => NAMES[tab.tabId] ?? '' };
}

interface RecordedActions extends SplitActions {
  assign: ReturnType<typeof vi.fn<(playerId: string, tab: TabKey) => void>>;
  unassign: ReturnType<typeof vi.fn<(playerId: string) => void>>;
  everyoneBack: ReturnType<typeof vi.fn<() => void>>;
}

function actions(capped: (playerId: string, tab: TabKey) => boolean = () => false): RecordedActions {
  return { assign: vi.fn<(playerId: string, tab: TabKey) => void>(), unassign: vi.fn<(playerId: string) => void>(), everyoneBack: vi.fn<() => void>(), wouldExceedCap: capped };
}

const rowOf = (menu: ReturnType<typeof presentToMenu>, playerId: string) => menu.rows.find((row) => row.playerId === playerId)!;

describe('the Present to rows (spec 3.4)', () => {
  it('lists admitted and disconnected players in the panel order, never waiting ones', () => {
    const menu = presentToMenu(rowTab('b'), view(), actions(), 'panel');
    expect(menu.rows.map((row) => row.playerId)).toEqual(['p1', 'p2', 'p4']);
    expect(menu.heading).toBe('Present Bridge to');
    expect(presentToMenu(rowTab('b'), view(), actions(), 'section').heading).toBe('Present to');
  });

  it('a follower on the presented tab is checked and disabled (D16)', () => {
    const act = actions();
    const row = rowOf(presentToMenu(rowTab('a'), view(), act, 'panel'), 'p1');
    expect(row).toMatchObject({ label: 'Anna', checked: true, disabled: true });
    row.choose();
    expect(act.assign).not.toHaveBeenCalled();
    expect(act.unassign).not.toHaveBeenCalled();
  });

  it('a follower on another tab reads where they are, and choosing assigns them', () => {
    const act = actions();
    const row = rowOf(presentToMenu(rowTab('b'), view(), act, 'panel'), 'p1');
    expect(row).toMatchObject({ label: 'Anna · on Ambush', checked: false, disabled: false });
    row.choose();
    expect(act.assign).toHaveBeenCalledWith('p1', tabOf('b'));
  });

  it('a follower with nothing presented reads no scene', () => {
    expect(rowOf(presentToMenu(rowTab('b'), view({}, null), actions(), 'panel'), 'p1').label).toBe('Anna · no scene');
  });

  it('a player assigned to the tab is checked, and choosing unassigns them', () => {
    const act = actions();
    const row = rowOf(presentToMenu(rowTab('b'), view({ p2: 'b' }), act, 'panel'), 'p2');
    expect(row).toMatchObject({ label: 'Ben', checked: true, disabled: false });
    row.choose();
    expect(act.unassign).toHaveBeenCalledWith('p2');
  });

  it('a player assigned to another tab reads it, and choosing moves them; on the presented tab it assigns there (they follow)', () => {
    const act = actions();
    const onC = rowOf(presentToMenu(rowTab('b'), view({ p2: 'c' }), act, 'panel'), 'p2');
    expect(onC).toMatchObject({ label: 'Ben · on Cave', checked: false, disabled: false });
    onC.choose();
    expect(act.assign).toHaveBeenLastCalledWith('p2', tabOf('b'));
    const back = rowOf(presentToMenu(rowTab('a'), view({ p2: 'c' }), act, 'panel'), 'p2');
    expect(back).toMatchObject({ label: 'Ben · on Cave', checked: false });
    back.choose();
    expect(act.assign).toHaveBeenLastCalledWith('p2', tabOf('a'));
  });

  it('a disconnected player reads disconnected, and their rows act as anyone else\'s', () => {
    const act = actions();
    expect(rowOf(presentToMenu(rowTab('a'), view(), act, 'panel'), 'p4')).toMatchObject({ label: 'Dan · disconnected', checked: true, disabled: true });
    const row = rowOf(presentToMenu(rowTab('c'), view({ p4: 'b' }), act, 'panel'), 'p4');
    expect(row.label).toBe('Dan · on Bridge · disconnected');
    row.choose();
    expect(act.assign).toHaveBeenCalledWith('p4', tabOf('c'));
  });

  it('rows that would open a fifth scene are disabled and the heading notes the cap', () => {
    const act = actions((playerId, tab) => tab.tabId === 'e' && playerId !== 'p2');
    const menu = presentToMenu(rowTab('e'), view({ p2: 'b' }), act, 'panel');
    expect(rowOf(menu, 'p1')).toMatchObject({ checked: false, disabled: true });
    expect(rowOf(menu, 'p2').disabled).toBe(false);
    expect(menu.capNote).toBe('At most 4 scenes at once');
    rowOf(menu, 'p1').choose();
    expect(act.assign).not.toHaveBeenCalled();
    expect(presentToMenu(rowTab('b'), view({ p2: 'b' }), actions(), 'panel').capNote).toBeNull();
  });

  it('everyone back is disabled with nothing assigned or nothing presented (D9)', () => {
    expect(presentToMenu(rowTab('a'), view(), actions(), 'panel').everyoneBack).toMatchObject({ label: 'Everyone back to the presented scene', disabled: true });
    expect(presentToMenu(rowTab('a'), view({ p2: 'b' }, null), actions(), 'panel').everyoneBack.disabled).toBe(true);
    const act = actions();
    const back = presentToMenu(rowTab('a'), view({ p2: 'b' }), act, 'panel').everyoneBack;
    expect(back.disabled).toBe(false);
    back.choose();
    expect(act.everyoneBack).toHaveBeenCalledOnce();
  });

  it('has no rows with nobody admitted or disconnected', () => {
    expect(presentToMenu(rowTab('a'), view({}, 'a', [cy]), actions(), 'panel').rows).toEqual([]);
  });
});

describe('who sees a tab', () => {
  it('labels the button everyone, the players who see it, or nobody', () => {
    expect(presentToButtonLabel(view(), tabOf('a'))).toBe('Present to: everyone');
    expect(presentToButtonLabel(view({ p2: 'b' }), tabOf('a'))).toBe('Present to: Anna, Dan');
    expect(presentToButtonLabel(view({ p2: 'b' }), tabOf('b'))).toBe('Present to: Ben');
    expect(presentToButtonLabel(view({ p2: 'b' }), tabOf('c'))).toBe('Present to: nobody');
  });

  it('badges a tab only while someone is assigned, counting the presented tab\'s followers', () => {
    expect(tabBadgeText(view(), tabOf('a'))).toBeNull();
    expect(tabBadgeText(view({ p2: 'b' }), tabOf('a'))).toBe('2 players');
    expect(tabBadgeText(view({ p2: 'b' }), tabOf('b'))).toBe('1 player');
    expect(tabBadgeText(view({ p2: 'b' }), tabOf('c'))).toBeNull();
  });
});
