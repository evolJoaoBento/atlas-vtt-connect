import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MenuItem } from '@atlas-vtt/api-types';
import { CONTROLLED_BY_LABEL, NO_PLAYERS_LABEL } from '../../../src/app/online/gm-ui/controlledByMenu';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { anna, ben, cy, dan, gmUiHarness, type GmUiHarness } from './gmUiFixtures';

const players: SessionPlayer[] = [anna, ben, cy, dan];
let harness: GmUiHarness;

beforeEach(() => { harness = gmUiHarness(); });
afterEach(() => {
  harness.gm();
  act(() => { resetOnlineSessionStore(); });
});

const menu = (tokenId = 'hero', tokenKind: 'token' | 'character' = 'character'): MenuItem[] => harness.ui.tokenMenu(harness.scene.view, tokenId, tokenKind);
const submenu = (tokenId = 'hero'): MenuItem[] => menu(tokenId)[0]!.submenu!;

describe('Controlled by', () => {
  it('lists every admitted player as a checkbox that gives or takes the token', () => {
    const control = harness.host(players);
    expect(menu().map((item) => item.label)).toEqual([CONTROLLED_BY_LABEL]);
    expect(menu()[0]).toMatchObject({ icon: 'users' });
    expect(submenu().map(({ label, checked, keepOpen }) => ({ label, checked, keepOpen }))).toEqual([
      { label: 'Anna', checked: false, keepOpen: true },
      { label: 'Ben', checked: false, keepOpen: true },
    ]);
    submenu()[1]!.onClick!();
    expect(control.tokensOf('p2')).toEqual(['hero']);
    expect(submenu()[1]!.checked).toBe(true);
    submenu()[1]!.onClick!();
    expect(control.tokensOf('p2')).toEqual([]);
  });

  it('stays open while players are ticked in a row, its ticks following each choice (API 1.13.0)', () => {
    const control = harness.host(players);
    const open = harness.ui.openTokenMenu(harness.scene.view, 'hero', 'character');
    expect(open.choose([CONTROLLED_BY_LABEL, 'Anna'])).toBe(true);
    expect(open.choose([CONTROLLED_BY_LABEL, 'Ben'])).toBe(true);
    expect(open.isOpen).toBe(true);
    expect(open.submenu([CONTROLLED_BY_LABEL]).map(({ label, checked }) => ({ label, checked }))).toEqual([
      { label: 'Anna', checked: true },
      { label: 'Ben', checked: true },
    ]);
    expect([control.tokensOf('p1'), control.tokensOf('p2')]).toEqual([['hero'], ['hero']]);
    expect(open.choose([CONTROLLED_BY_LABEL, 'Anna'])).toBe(true);
    expect(open.submenu([CONTROLLED_BY_LABEL])[0]).toMatchObject({ label: 'Anna', checked: false });
  });

  it("is not offered in a remote view, a player's since API 1.12.0", () => {
    harness.host(players);
    harness.atlas.views.openRemote('remote-1');
    expect(harness.ui.tokenMenu('remote-1', 'hero', 'character')).toEqual([]);
  });

  it('says no players are connected while nobody is admitted', () => {
    harness.host(players.slice(2));
    expect(submenu().map(({ label, disabled }) => ({ label, disabled }))).toEqual([{ label: NO_PLAYERS_LABEL, disabled: true }]);
  });

  it('is hidden when this Atlas cannot land players\' moves: hosting without token control', () => {
    harness.host(players);
    act(() => { onlineSessionStore.setState({ tokenControl: null }); });
    expect(menu()).toEqual([]);
  });

  it('asks Atlas to read the menu again after assignment and player changes, until it is disposed', () => {
    const control = harness.host(players);
    let before = harness.ui.version();
    control.set('hero', 'p1', true);
    expect(harness.ui.version()).toBeGreaterThan(before);
    before = harness.ui.version();
    act(() => { onlineSessionStore.setState({ players: players.slice(0, 1) }); });
    expect(harness.ui.version()).toBeGreaterThan(before);
    harness.gm();
    before = harness.ui.version();
    control.set('hero', 'p1', false);
    act(() => { onlineSessionStore.setState({ players: [] }); });
    expect(harness.ui.version()).toBe(before);
  });

  it('follows a new session\'s control list, not the finished one\'s', () => {
    const first = harness.host(players);
    const second = harness.host(players);
    const before = harness.ui.version();
    first.set('hero', 'p1', true);
    expect(harness.ui.version()).toBe(before);
    second.set('hero', 'p1', true);
    expect(harness.ui.version()).toBeGreaterThan(before);
  });
});
