import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal } from 'obsidian';
import { joinedSessionStore } from '../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService } from '../../../src/app/online/obsidian/OnlineJoinService';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { connected, HOSTING } from './hostingFixtures';

const LINK = 'https://example.org/join/#id=gm';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => { resetOnlineSessionStore(); });
  joinedSessionStore.setState({ session: null });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('joining from Obsidian, through startConnect', () => {
  it('registers "Join online session…" for every Atlas, with or without hosting or ui, and removes it on unload', async () => {
    const { atlas, connect } = connected([]);
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.keys()]).toEqual(['join-online-session']);
    expect(connect.commands.get('join-online-session')!.name).toBe('Join online session…');
    const open = vi.spyOn(Modal.prototype, 'open');
    expect(connect.run('join-online-session')).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    atlas.unload();
    expect([...connect.commands.keys()]).toEqual([]);
  });

  it('has a join service for the app, disposed with Atlas', async () => {
    const dispose = vi.spyOn(OnlineJoinService.prototype, 'dispose');
    const { atlas, connect } = connected([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(OnlineJoinService.forApp(connect.plugin.app)).toBeInstanceOf(OnlineJoinService);
    atlas.unload();
    expect(dispose).toHaveBeenCalledOnce();
    // A disposed service is not found any more.
    expect(OnlineJoinService.forApp(connect.plugin.app)).toBeUndefined();
  });

  it('refuses to join while hosting, with the fork\'s reason', async () => {
    const { atlas, connect } = connected(HOSTING);
    await vi.advanceTimersByTimeAsync(0);
    act(() => { onlineSessionStore.setState({ status: 'hosting' }); });
    expect(OnlineJoinService.forApp(connect.plugin.app)!.join(LINK, 'Ben')).toBe('hosting');
    atlas.unload();
  });

  it('refuses to host while joined: starting a session shows why', async () => {
    const { atlas, connect } = connected(HOSTING);
    await vi.advanceTimersByTimeAsync(0);
    joinedSessionStore.setState({ session: { status: 'admitted', playerId: 'p', title: 'T', players: [], reason: null } });
    expect(connect.run('start-online-session')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineSessionStore.getState()).toMatchObject({ status: 'error', error: 'Leave the online session you joined before hosting one.' });
    atlas.unload();
  });

  it('the panel\'s join button opens the real dialog', async () => {
    const open = vi.spyOn(Modal.prototype, 'open');
    const { atlas, connect } = connected([...HOSTING, 'ui']);
    await vi.advanceTimersByTimeAsync(0);
    atlas.views.open('v1');
    atlas.views.setActive('v1');
    await act(async () => { connect.run('online-session'); await Promise.resolve(); });
    const panel = atlas.ui!.panelContainer('online', 'v1')!;
    const button = [...panel.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Join online session…')!;
    act(() => { button.click(); });
    expect(open).toHaveBeenCalledOnce();
    atlas.unload();
  });
});
