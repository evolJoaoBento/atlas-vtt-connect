import { describe, expect, it, vi } from 'vitest';
import { AtlasLink } from '../../../src/connect/atlasLink';
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
    expect(notices.filter((m) => m.includes('found'))).toEqual(['Atlas VTT Connect needs Atlas VTT with extension API 1.x (found 2.0.0).']);
    expect(notices).toHaveLength(1);
    expect(started).toEqual([]);
  });

  it('says once that Atlas is missing after layout-ready', () => {
    const notices: string[] = [];
    const { app } = fakeWorkspaceApp();
    new AtlasLink(fakeConnectPlugin(app), () => () => undefined, (m) => notices.push(m)).start();
    expect(notices).toEqual(['Atlas VTT Connect needs Atlas VTT. Install or enable it, then reload.']);
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
