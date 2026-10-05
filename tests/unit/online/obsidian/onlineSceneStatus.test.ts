import { describe, expect, it } from 'vitest';
import { onlineSceneStatus } from '../../../../src/app/online/obsidian/onlineSceneStatus';
import type { PlayerSessionState } from '../../../../src/app/online/PlayerSession';

const state = (status: PlayerSessionState['status'], reason: string | null = null, title: string | null = 'Table'): PlayerSessionState => ({
  status, playerId: 'p1', title, players: [], reason,
});

describe('onlineSceneStatus', () => {
  it('names the session and its connection', () => {
    expect(onlineSceneStatus(state('admitted'), true)).toEqual({ title: 'Table', connection: 'Connected', tone: 'connected', message: null, reconnect: false });
    expect(onlineSceneStatus(state('admitted'), false).message).toBe('Waiting for the GM to show a scene.');
    expect(onlineSceneStatus(state('connecting', null, null), false)).toMatchObject({ title: 'the table', connection: 'Connecting…', tone: 'pending' });
    expect(onlineSceneStatus(state('connecting'), true).connection).toBe('Reconnecting…');
    expect(onlineSceneStatus(state('waiting'), false)).toMatchObject({ connection: 'Waiting for the GM', message: 'Waiting for the GM to let you in…' });
    expect(onlineSceneStatus(null, false)).toMatchObject({ title: 'the table', connection: 'Connecting…' });
  });

  it("says why the session ended in the join page's words, and offers Reconnect after a lost connection", () => {
    expect(onlineSceneStatus(state('lost', 'ended'), true)).toEqual({ title: 'Table', connection: 'Disconnected', tone: 'ended', message: 'The session ended.', reconnect: false });
    expect(onlineSceneStatus(state('lost', 'connection-lost'), true)).toMatchObject({ message: 'Lost the connection to your GM.', reconnect: true });
    expect(onlineSceneStatus(state('lost', 'unreachable'), false)).toMatchObject({ reconnect: true });
    expect(onlineSceneStatus(state('denied', 'kicked'), true)).toMatchObject({ message: 'The GM removed you from the session.', reconnect: false });
    expect(onlineSceneStatus(state('denied', 'version'), true).message).toBe("This page is out of date for your GM's Atlas. Ask them for a new link.");
    expect(onlineSceneStatus(state('lost', 'replaced'), true).message).toBe('You joined from another tab.');
  });
});
