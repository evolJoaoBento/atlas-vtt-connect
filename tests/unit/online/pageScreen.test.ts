import { describe, expect, it } from 'vitest';
import type { PlayerSessionState } from '../../../src/app/online/PlayerSession';
import { pageScreen } from '../../../src/app/online/page/pageScreen';

const state = (overrides: Partial<PlayerSessionState>): PlayerSessionState => ({
  status: 'connecting', playerId: null, title: null, players: [], reason: null, ...overrides,
});
const UNREACHABLE = "Couldn't connect. Check the link, or your GM may need to add a relay server in Atlas settings.";

describe('join page screens', () => {
  it('shows the name form before joining', () => {
    expect(pageScreen(null, false)).toEqual({ kind: 'form' });
  });

  it('shows full-screen messages while connecting, waiting, refused or ended', () => {
    expect(pageScreen(state({ status: 'connecting' }), false)).toEqual({ kind: 'message', text: 'Connecting…' });
    expect(pageScreen(state({ status: 'waiting' }), false)).toEqual({ kind: 'message', text: 'Waiting for the GM to let you in…' });
    expect(pageScreen(state({ status: 'admitted', title: 'Vault' }), false))
      .toEqual({ kind: 'message', text: 'Connected to Vault. Waiting for the GM to show a scene.' });
    expect(pageScreen(state({ status: 'denied', reason: 'kicked' }), true)).toEqual({ kind: 'message', text: 'The GM removed you from the session.' });
    expect(pageScreen(state({ status: 'lost', reason: 'ended' }), true)).toEqual({ kind: 'message', text: 'The session ended.' });
    expect(pageScreen(state({ status: 'lost', reason: 'something-new' }), false)).toEqual({ kind: 'message', text: UNREACHABLE });
    expect(pageScreen(state({ status: 'lost', reason: 'constructor' }), false)).toEqual({ kind: 'message', text: UNREACHABLE });
  });

  it('shows the table with a scene, also while reconnecting', () => {
    expect(pageScreen(state({ status: 'admitted', title: 'Vault' }), true)).toEqual({ kind: 'table', title: 'Vault', connection: 'Connected' });
    expect(pageScreen(state({ status: 'connecting', title: 'Vault' }), true)).toEqual({ kind: 'table', title: 'Vault', connection: 'Reconnecting…' });
    expect(pageScreen(state({ status: 'admitted' }), true)).toMatchObject({ kind: 'table', title: 'the table' });
  });
});
