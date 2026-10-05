import { describe, expect, it, vi } from 'vitest';
import { Notice } from 'obsidian';
import { ATLAS_GRACE_MS, AtlasLink, MISSING_ATLAS_NOTICE, NO_API_NOTICE } from '../../../src/connect/atlasLink';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { fakeConnectPlugin, fakeWorkspaceApp } from '../../fake/fakeWorkspace';

describe('AtlasLink', () => {
  it('connects when the API is already there, and when it arrives later', () => {
    const early = fakeWorkspaceApp();
    early.plugins['atlas-vtt'] = { api: new FakeAtlas() };
    const started: string[] = [];
    const link = new AtlasLink(fakeConnectPlugin(early.app), (atlas) => { started.push(atlas.id); return () => undefined; }, () => undefined);
    link.start();
    expect(started).toEqual(['atlas-vtt-connect']);
    expect(link.connected?.id).toBe('atlas-vtt-connect');

    const late = fakeWorkspaceApp();
    const lateStarted: string[] = [];
    const lateLink = new AtlasLink(fakeConnectPlugin(late.app), (atlas) => { lateStarted.push(atlas.id); return () => undefined; }, () => undefined);
    lateLink.start();
    expect(lateStarted).toEqual([]);
    late.fire('atlas-vtt:api-ready', new FakeAtlas());
    expect(lateStarted).toEqual(['atlas-vtt-connect']);
  });

  it('reconnects after Atlas reloads: unload stops what start returned, a new api-ready starts again', () => {
    const { app, fire } = fakeWorkspaceApp();
    const plugin = fakeConnectPlugin(app);
    const stops: string[] = [];
    const link = new AtlasLink(plugin, (atlas) => { stops.push(`start:${atlas.id}`); return () => stops.push('stop'); }, () => undefined);
    link.start();
    const first = new FakeAtlas();
    fire('atlas-vtt:api-ready', first);
    first.unload();
    fire('atlas-vtt:api-unload');
    expect(link.connected).toBeNull();
    fire('atlas-vtt:api-ready', new FakeAtlas());
    expect(stops).toEqual(['start:atlas-vtt-connect', 'stop', 'start:atlas-vtt-connect']);
  });

  it('refuses another major version with one notice and stays idle', () => {
    const notices: string[] = [];
    const started: string[] = [];
    const { app, plugins, fire } = fakeWorkspaceApp();
    plugins['atlas-vtt'] = { api: new FakeAtlas({ version: '2.0.0' }) };
    new AtlasLink(fakeConnectPlugin(app), (atlas) => { started.push(atlas.id); return () => undefined; }, (m) => notices.push(m)).start();
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '2.0.0' }));
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '2.0.0' }));
    expect(notices.filter((m) => m.includes('found'))).toEqual(['Atlas VTT Connect needs extension API 1.13 or newer (found 2.0.0).']);
    expect(notices).toHaveLength(1);
    expect(started).toEqual([]);
  });

  it('says once that Atlas is missing, only after the grace period past layout-ready', () => {
    vi.useFakeTimers();
    try {
      const notices: string[] = [];
      const { app } = fakeWorkspaceApp();
      new AtlasLink(fakeConnectPlugin(app), () => () => undefined, (m) => notices.push(m)).start();
      vi.advanceTimersByTime(ATLAS_GRACE_MS - 1);
      expect(notices).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(notices).toEqual([MISSING_ATLAS_NOTICE]);
      expect(MISSING_ATLAS_NOTICE).toBe('Atlas VTT Connect: Install or enable Atlas VTT.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('says Atlas has no extension API when Atlas is loaded without one', () => {
    vi.useFakeTimers();
    try {
      const notices: string[] = [];
      const { app, plugins } = fakeWorkspaceApp();
      plugins['atlas-vtt'] = {};
      new AtlasLink(fakeConnectPlugin(app), () => () => undefined, (m) => notices.push(m)).start();
      vi.advanceTimersByTime(ATLAS_GRACE_MS);
      expect(notices).toEqual([NO_API_NOTICE]);
      expect(NO_API_NOTICE).toBe('Atlas VTT Connect: this Atlas VTT has no extension API (1.13 or newer) yet.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no notice when the API arrives within the grace period, and drops one already showing when it arrives late', () => {
    vi.useFakeTimers();
    try {
      const early: string[] = [];
      const first = fakeWorkspaceApp();
      first.plugins['atlas-vtt'] = {};
      const earlyStarted: string[] = [];
      new AtlasLink(fakeConnectPlugin(first.app), (atlas) => { earlyStarted.push(atlas.id); return () => undefined; }, (m) => early.push(m)).start();
      vi.advanceTimersByTime(ATLAS_GRACE_MS - 1);
      first.fire('atlas-vtt:api-ready', new FakeAtlas());
      vi.advanceTimersByTime(ATLAS_GRACE_MS);
      expect(early).toEqual([]);
      expect(earlyStarted).toEqual(['atlas-vtt-connect']);

      const shown = new Notice('Atlas VTT Connect: late');
      const hide = vi.spyOn(shown, 'hide');
      const second = fakeWorkspaceApp();
      second.plugins['atlas-vtt'] = {};
      const lateStarted: string[] = [];
      new AtlasLink(fakeConnectPlugin(second.app), (atlas) => { lateStarted.push(atlas.id); return () => undefined; }, () => shown).start();
      vi.advanceTimersByTime(ATLAS_GRACE_MS);
      expect(hide).not.toHaveBeenCalled();
      second.fire('atlas-vtt:api-ready', new FakeAtlas());
      expect(hide).toHaveBeenCalledTimes(1);
      expect(lateStarted).toEqual(['atlas-vtt-connect']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an API older than 1.13 with its version, once, and connects from 1.13 on', () => {
    const notices: string[] = [];
    const started: string[] = [];
    const { app, plugins, fire } = fakeWorkspaceApp();
    plugins['atlas-vtt'] = { api: new FakeAtlas({ version: '1.12.0' }) };
    const link = new AtlasLink(fakeConnectPlugin(app), (atlas) => { started.push(atlas.id); return () => undefined; }, (m) => notices.push(m));
    link.start();
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '1.9.0' }));
    expect(notices).toEqual(['Atlas VTT Connect needs extension API 1.13 or newer (found 1.12.0).']);
    expect(started).toEqual([]);
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '1.13.0' }));
    expect(started).toEqual(['atlas-vtt-connect']);
    fire('atlas-vtt:api-unload');
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '1.14.2' }));
    expect(started).toHaveLength(2);
  });

  it('ignores a value at plugins.atlas-vtt.api that is not an API', () => {
    const { app, plugins } = fakeWorkspaceApp();
    plugins['atlas-vtt'] = { api: { version: 1 } };
    let started = 0;
    const link = new AtlasLink(fakeConnectPlugin(app), () => { started += 1; return () => undefined; }, () => undefined);
    link.start();
    expect(started).toBe(0);
    expect(link.connected).toBeNull();
  });

  it('stops everything when Connect itself unloads, and Atlas listeners go with it', () => {
    const { app, plugins } = fakeWorkspaceApp();
    const atlas = new FakeAtlas();
    plugins['atlas-vtt'] = { api: atlas };
    const plugin = fakeConnectPlugin(app);
    const stops: string[] = [];
    const link = new AtlasLink(plugin, (extension) => {
      extension.on('unload', () => undefined);
      return () => stops.push('stop');
    }, () => undefined);
    link.start();
    expect(atlas.listenerCount()).toBe(1);
    plugin.unload();
    expect(stops).toEqual(['stop']);
    expect(link.connected).toBeNull();
    expect(atlas.listenerCount()).toBe(0);
  });

  it('a throw from connect is reported, nothing stays attached, and start() does not throw', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, plugins } = fakeWorkspaceApp();
    const atlas = new FakeAtlas();
    atlas.connect = () => { throw new Error('boom'); };
    plugins['atlas-vtt'] = { api: atlas };
    const notices: string[] = [];
    const link = new AtlasLink(fakeConnectPlugin(app), () => () => undefined, (m) => notices.push(m));
    expect(() => link.start()).not.toThrow();
    expect(link.connected).toBeNull();
    expect(notices).toEqual(['Atlas VTT Connect could not start: boom']);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('a throw from the start callback is reported and leaves nothing attached; a later api-ready recovers', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, fire } = fakeWorkspaceApp();
    const notices: string[] = [];
    let fail = true;
    const link = new AtlasLink(fakeConnectPlugin(app), () => {
      if (fail) throw new Error('bad start');
      return () => undefined;
    }, (m) => notices.push(m));
    link.start();
    expect(() => fire('atlas-vtt:api-ready', new FakeAtlas())).not.toThrow();
    expect(link.connected).toBeNull();
    expect(notices.at(-1)).toBe('Atlas VTT Connect could not start: bad start');
    fail = false;
    fire('atlas-vtt:api-ready', new FakeAtlas());
    expect(link.connected?.id).toBe('atlas-vtt-connect');
    error.mockRestore();
  });

  it('a throw from the start callback disposes the connection that connect made, so nothing stays registered on Atlas', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, plugins } = fakeWorkspaceApp();
    const atlas = new FakeAtlas();
    plugins['atlas-vtt'] = { api: atlas };
    const link = new AtlasLink(fakeConnectPlugin(app), (extension) => {
      extension.on('unload', () => undefined);
      throw new Error('bad start');
    }, () => undefined);
    link.start();
    expect(link.connected).toBeNull();
    expect(atlas.listenerCount()).toBe(0);
    error.mockRestore();
  });

  it('a wrong-major api-ready after a compatible connection detaches the old one', () => {
    const { app, fire } = fakeWorkspaceApp();
    const stops: string[] = [];
    const link = new AtlasLink(fakeConnectPlugin(app), () => () => stops.push('stop'), () => undefined);
    link.start();
    fire('atlas-vtt:api-ready', new FakeAtlas());
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '2.0.0' }));
    expect(stops).toEqual(['stop']);
    expect(link.connected).toBeNull();
  });
});
