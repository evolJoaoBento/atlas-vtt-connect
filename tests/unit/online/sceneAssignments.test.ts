import { describe, expect, it } from 'vitest';
import { SceneAssignments } from '../../../src/app/online/split/SceneAssignments';
import { SPLIT_LIMITS } from '../../../src/app/online/split/splitLimits';
import { sameTab, tabKeyOf, type TabKey } from '../../../src/app/online/split/tabKey';

const tab = (tabId: string, viewId = 'v1'): TabKey => ({ viewId, tabId });
const MAIN = tab('main');
const A = tab('a');
const B = tab('b');
const C = tab('c');
const D = tab('d');

function watched(): { model: SceneAssignments; changes: string[][] } {
  const model = new SceneAssignments();
  const changes: string[][] = [];
  model.onChange((ids) => changes.push(ids));
  return { model, changes };
}

describe('tab keys', () => {
  it('keys a tab by view and tab id, never confusing two that join to the same text', () => {
    expect(tabKeyOf(tab('b', 'a'))).not.toBe(tabKeyOf(tab('', 'ab')));
    expect(tabKeyOf(tab('a'))).toBe(tabKeyOf({ viewId: 'v1', tabId: 'a' }));
  });

  it('compares tabs by value, and two nulls are the same (no scene)', () => {
    expect(sameTab(A, tab('a'))).toBe(true);
    expect(sameTab(A, tab('a', 'v2'))).toBe(false);
    expect(sameTab(A, null)).toBe(false);
    expect(sameTab(null, A)).toBe(false);
    expect(sameTab(null, null)).toBe(true);
  });
});

describe('SceneAssignments', () => {
  it('assigning to the presented tab stores nothing: the player follows', () => {
    const { model, changes } = watched();
    expect(model.assign('anna', tab('main'), MAIN)).toBe('follows');
    expect(model.tabOf('anna')).toBeNull();
    expect(model.assignedCount()).toBe(0);
    expect(changes).toEqual([]);
    // Assigned elsewhere, then to the presented tab: she follows again.
    expect(model.assign('anna', A, MAIN)).toBe('ok');
    expect(model.assign('anna', MAIN, MAIN)).toBe('follows');
    expect(model.tabOf('anna')).toBeNull();
    expect(model.sceneOf('anna', MAIN)).toEqual(MAIN);
    expect(changes).toEqual([['anna'], ['anna']]);
  });

  it('resolves a player to their tab, else to the presented one, else to none', () => {
    const model = new SceneAssignments();
    model.assign('anna', A, MAIN);
    expect(model.sceneOf('anna', MAIN)).toEqual(A);
    expect(model.sceneOf('ben', MAIN)).toEqual(MAIN);
    expect(model.sceneOf('ben', null)).toBeNull();
    expect(model.sceneOf('anna', null)).toEqual(A);
  });

  it('fires no change for an assignment that changes nothing', () => {
    const { model, changes } = watched();
    model.assign('anna', A, MAIN);
    model.assign('anna', tab('a'), MAIN);
    model.unassign('ben');
    expect(changes).toEqual([['anna']]);
    model.unassign('anna');
    expect(changes).toEqual([['anna'], ['anna']]);
  });

  it('lists the scenes in use: the presented one first, then each assigned tab once', () => {
    const model = new SceneAssignments();
    expect(model.scenesInUse(null)).toEqual([]);
    expect(model.scenesInUse(MAIN)).toEqual([MAIN]);
    model.assign('anna', A, MAIN);
    model.assign('ben', A, MAIN);
    model.assign('cara', B, MAIN);
    expect(model.scenesInUse(MAIN)).toEqual([MAIN, A, B]);
    expect(model.scenesInUse(null)).toEqual([A, B]);
  });

  it('refuses a fifth scene in use, the presented one counted', () => {
    expect(SPLIT_LIMITS.scenesInUse).toBe(4);
    const { model, changes } = watched();
    model.assign('anna', A, MAIN);
    model.assign('ben', B, MAIN);
    model.assign('cara', C, MAIN);
    expect(model.scenesInUse(MAIN)).toHaveLength(4);
    expect(model.wouldExceedCap('dan', D, MAIN)).toBe(true);
    expect(model.assign('dan', D, MAIN)).toBe('cap');
    expect(model.tabOf('dan')).toBeNull();
    expect(changes).toHaveLength(3);
    // A tab already in use, and the presented one, are always open to more players.
    expect(model.wouldExceedCap('dan', A, MAIN)).toBe(false);
    expect(model.assign('dan', A, MAIN)).toBe('ok');
    expect(model.wouldExceedCap('anna', MAIN, MAIN)).toBe(false);
    // With nothing presented, four assigned tabs fill the cap.
    const loose = new SceneAssignments();
    for (const [player, where] of [['anna', A], ['ben', B], ['cara', C], ['dan', D]] as const) loose.assign(player, where, null);
    expect(loose.assign('eve', tab('e'), null)).toBe('cap');
  });

  it('moving the last player of C to new D keeps the count and is allowed at the cap', () => {
    const model = new SceneAssignments();
    model.assign('anna', A, MAIN);
    model.assign('ben', B, MAIN);
    model.assign('cara', C, MAIN);
    expect(model.wouldExceedCap('cara', D, MAIN)).toBe(false);
    expect(model.assign('cara', D, MAIN)).toBe('ok');
    expect(model.scenesInUse(MAIN)).toEqual([MAIN, A, B, D]);
    // Dan leaving A does not empty it (Anna stays), so C would be a fifth scene.
    model.assign('dan', A, MAIN);
    expect(model.assign('dan', C, MAIN)).toBe('cap');
  });

  it('presenting a tab turns its assigned players into followers (D15)', () => {
    const { model, changes } = watched();
    model.assign('anna', A, MAIN);
    model.assign('ben', A, MAIN);
    model.assign('cara', B, MAIN);
    changes.length = 0;
    expect(model.presentedChanged(A)).toEqual(['anna', 'ben']);
    expect(model.tabOf('anna')).toBeNull();
    expect(model.sceneOf('anna', A)).toEqual(A);
    expect(model.tabOf('cara')).toEqual(B);
    expect(changes).toEqual([['anna', 'ben']]);
    expect(model.presentedChanged(C)).toEqual([]);
    expect(model.presentedChanged(null)).toEqual([]);
    expect(changes).toHaveLength(1);
  });

  it('a closed tab drops its assignments and returns who went back', () => {
    const { model, changes } = watched();
    model.assign('anna', A, MAIN);
    model.assign('ben', A, MAIN);
    model.assign('cara', B, MAIN);
    changes.length = 0;
    expect(model.dropTab(A)).toEqual(['anna', 'ben']);
    expect(model.sceneOf('anna', MAIN)).toEqual(MAIN);
    expect(model.tabOf('cara')).toEqual(B);
    expect(changes).toEqual([['anna', 'ben']]);
    expect(model.dropTab(A)).toEqual([]);
    expect(changes).toHaveLength(1);
  });

  it('a closed view drops every tab of it, and only of it', () => {
    const { model, changes } = watched();
    model.assign('anna', A, MAIN);
    model.assign('ben', tab('x', 'v2'), MAIN);
    model.assign('cara', B, MAIN);
    changes.length = 0;
    expect(model.dropView('v1')).toEqual(['anna', 'cara']);
    expect(model.tabOf('ben')).toEqual(tab('x', 'v2'));
    expect(changes).toEqual([['anna', 'cara']]);
    expect(model.dropView('v1')).toEqual([]);
    expect(changes).toHaveLength(1);
  });

  it('keeps a disconnected player and drops a kicked one', () => {
    const { model, changes } = watched();
    model.assign('anna', A, MAIN);
    model.assign('ben', B, MAIN);
    changes.length = 0;
    // The session still knows Anna (disconnected), but not Ben (kicked).
    model.retainPlayers(new Set(['anna', 'cara']));
    expect(model.tabOf('anna')).toEqual(A);
    expect(model.tabOf('ben')).toBeNull();
    expect(changes).toEqual([['ben']]);
    model.retainPlayers(new Set(['anna']));
    expect(changes).toHaveLength(1);
    // A disconnected player's tab still counts as in use.
    expect(model.scenesInUse(MAIN)).toEqual([MAIN, A]);
  });

  it('clear returns every assigned player once and fires one change', () => {
    const { model, changes } = watched();
    model.assign('anna', A, MAIN);
    model.assign('ben', A, MAIN);
    model.assign('cara', B, MAIN);
    model.assign('anna', B, MAIN);
    changes.length = 0;
    expect(model.clear()).toEqual(['anna', 'ben', 'cara']);
    expect(model.assignedCount()).toBe(0);
    expect(changes).toEqual([['anna', 'ben', 'cara']]);
    expect(model.clear()).toEqual([]);
    expect(changes).toHaveLength(1);
  });

  it('counts the assigned players, and stops telling a listener once it is disposed', () => {
    const model = new SceneAssignments();
    const heard: string[][] = [];
    const stop = model.onChange((ids) => heard.push(ids));
    model.assign('anna', A, MAIN);
    model.assign('ben', B, MAIN);
    expect(model.assignedCount()).toBe(2);
    stop();
    model.unassign('anna');
    expect(heard).toEqual([['anna'], ['ben']]);
    expect(model.assignedCount()).toBe(1);
  });

  it('keeps its own copy of a tab, so a caller changing theirs moves nobody', () => {
    const model = new SceneAssignments();
    const mine = tab('a');
    model.assign('anna', mine, MAIN);
    mine.tabId = 'z';
    expect(model.tabOf('anna')).toEqual(A);
  });
});
