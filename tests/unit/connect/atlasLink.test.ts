import { describe, expect, it } from 'vitest';
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
});
