import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import { registerGmUi } from '../../../src/app/online/gm-ui/registerGmUi';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { serviceStub } from '../online/gmUiFixtures';
import { presenter } from '../online/presentedFixtures';
import { connected, HOSTING } from './hostingFixtures';

const NONE = { toolbar: 0, palette: 0, dashboard: 0, viewMenu: 0, tokenMenu: 0, panel: 0 };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => { resetOnlineSessionStore(); });
  vi.useRealTimers();
});

describe('the GM\'s UI in Atlas\'s slots', () => {
  it('registers the toolbar item, palette section, menus and panel when ui is present, and removes them on Atlas unload', () => {
    const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'storage', 'ui'] });
    const presenting = presenter(atlas);
    const stop = registerGmUi(presenting.extension, serviceStub() as never, { presented: presenting });
    expect(atlas.ui!.counts()).toEqual({ toolbar: 1, palette: 1, dashboard: 0, viewMenu: 1, tokenMenu: 1, panel: 1 });
    stop();
    expect(atlas.ui!.counts()).toEqual(NONE);

    const again = registerGmUi(presenting.extension, serviceStub() as never, { presented: presenting });
    expect(atlas.ui!.counts().toolbar).toBe(1);
    atlas.unload();
    expect(atlas.ui!.counts()).toEqual(NONE);
    expect(() => again()).not.toThrow();
  });

  it('no ui capability, no toolbar item, commands still work', async () => {
    const { atlas, connect } = connected(HOSTING);
    await vi.advanceTimersByTimeAsync(0);
    expect(atlas.ui).toBeUndefined();
    expect([...connect.commands.keys()]).toContain('start-online-session');
    expect(connect.run('start-online-session')).toBe(true);
    atlas.unload();
  });

  it('with ui, startConnect registers the slots beside the commands and removes both when Atlas unloads', async () => {
    const { atlas, connect } = connected([...HOSTING, 'ui']);
    await vi.advanceTimersByTimeAsync(0);
    expect(atlas.ui!.counts()).toEqual({ toolbar: 1, palette: 1, dashboard: 0, viewMenu: 1, tokenMenu: 1, panel: 1 });
    expect([...connect.commands.keys()]).toContain('start-online-session');
    atlas.unload();
    expect(atlas.ui!.counts()).toEqual(NONE);
    expect([...connect.commands.keys()]).toEqual([]);
    expect(atlas.listenerCount()).toBe(0);
  });

  it('"Online session…" opens the panel in the active GM view', async () => {
    const { atlas, connect } = connected([...HOSTING, 'ui']);
    await vi.advanceTimersByTimeAsync(0);
    atlas.views.open('v1');
    atlas.views.setActive('v1');
    atlas.ui!.drawToolbar('v1'); // Atlas draws the toolbar of a GM view: Connect now knows it
    connect.run('online-session');
    expect(atlas.ui!.panelContainer('online', 'v1')).not.toBeNull();
    atlas.unload();
  });

  it('the token menu offers Controlled by for characters only, through the whole wiring', async () => {
    const { atlas } = connected([...HOSTING, 'ui']);
    await vi.advanceTimersByTimeAsync(0);
    atlas.views.open('v1');
    act(() => {
      onlineSessionStore.setState({
        status: 'hosting', tokenControl: new TokenControl(),
        players: [{ playerId: 'p1', name: 'Ana', status: 'admitted' }, { playerId: 'p2', name: 'Ben', status: 'admitted' }],
      });
    });
    const items = atlas.ui!.tokenMenu('v1', 't', 'character');
    expect(items.map((item) => item.label)).toEqual(['Controlled by']);
    expect(items[0]!.submenu!.map((item) => item.label)).toEqual(['Ana', 'Ben']);
    expect(atlas.ui!.tokenMenu('v1', 't', 'token')).toEqual([]);
    atlas.unload();
  });

  it('without token control, Controlled by is hidden', async () => {
    const { atlas } = connected([...HOSTING, 'ui']);
    await vi.advanceTimersByTimeAsync(0);
    atlas.views.open('v1');
    act(() => { onlineSessionStore.setState({ status: 'hosting', tokenControl: null, players: [{ playerId: 'p1', name: 'Ana', status: 'admitted' }] }); });
    expect(atlas.ui!.tokenMenu('v1', 't', 'character')).toEqual([]);
    atlas.unload();
  });

});
