import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atlasFloor, compareVersions, floorNotice, FLOOR_POLL_MS, MIN_ATLAS_VERSION, pairingNotice, watchAtlasFloor, type AtlasFloor } from '../../../packages/atlas-host/src/index';
import { fakeHostApp } from '../../fake/fakeHostWorkspace';

describe('the Atlas version floor', () => {
  it('compareVersions orders pre-releases and short versions', () => {
    expect(compareVersions('0.15.0-beta.1', '0.15.0')).toBeLessThan(0);
    expect(compareVersions('0.15', '0.15.0')).toBe(0);
    expect(compareVersions('0.15.10', '0.15.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '0.15.0')).toBeGreaterThan(0);
    expect(compareVersions('x.y', '0.0.1')).toBeLessThan(0);
    expect(compareVersions('', '0.0.0')).toBeLessThan(0);
  });

  it('reads Atlas as ok, old or missing, and never ok from a version it cannot read', () => {
    expect(atlasFloor(fakeHostApp([], '0.15.0').app)).toEqual({ state: 'ok', version: '0.15.0' });
    expect(atlasFloor(fakeHostApp([], '0.15').app).state).toBe('ok');
    expect(atlasFloor(fakeHostApp([], '0.15.10').app).state).toBe('ok');
    expect(atlasFloor(fakeHostApp([], '1.0.0').app).state).toBe('ok');
    expect(atlasFloor(fakeHostApp([], '0.14.0').app)).toEqual({ state: 'old', version: '0.14.0' });
    expect(atlasFloor(fakeHostApp([], '0.15.0-beta.1').app)).toEqual({ state: 'old', version: '0.15.0-beta.1' });
    expect(atlasFloor(fakeHostApp([], null).app)).toEqual({ state: 'missing' });
    expect(atlasFloor(fakeHostApp([], 'x.y').app)).toEqual({ state: 'old', version: 'x.y' });
    expect(atlasFloor(fakeHostApp([], '').app)).toEqual({ state: 'old', version: 'unknown' });
    const noVersion = fakeHostApp([], '0.15.0');
    noVersion.plugins.plugins['atlas-vtt'] = {};
    noVersion.plugins.manifests['atlas-vtt'] = {};
    expect(atlasFloor(noVersion.app)).toEqual({ state: 'old', version: 'unknown' });
  });

  it('words the notices', () => {
    expect(floorNotice('Tabletop', '0.14.0')).toBe('Tabletop needs Atlas VTT 0.15 or later (found 0.14.0)');
    expect(floorNotice('Connect', 'unknown')).toBe('Connect needs Atlas VTT 0.15 or later (found unknown)');
    expect(pairingNotice('1.4.0', null)).toBe('Tabletop for Atlas VTT 1.4.0 and Connect for Atlas VTT unknown do not match: update both to the same release.');
  });

  it('is the tag atlas-shared is copied from', () => {
    const source = JSON.parse(readFileSync(path.resolve(__dirname, '../../../packages/atlas-shared/SOURCE.json'), 'utf8')) as { tag: string };
    expect(MIN_ATLAS_VERSION).toBe(source.tag);
  });

  it('watchAtlasFloor tells of a reloaded or changed Atlas, and of nothing else', () => {
    const fake = fakeHostApp([], '0.15.0');
    let tick: () => void = () => undefined;
    let stopped = false;
    const heard: AtlasFloor[] = [];
    const stop = watchAtlasFloor(fake.app, (floor) => heard.push(floor), (ms, fn) => {
      expect(ms).toBe(FLOOR_POLL_MS);
      tick = fn;
      return () => { stopped = true; };
    });
    tick();
    expect(heard).toEqual([]);
    fake.plugins.plugins['atlas-vtt'] = { manifest: { version: '0.14.0' } };
    fake.plugins.manifests['atlas-vtt'] = { version: '0.14.0' };
    tick();
    tick();
    expect(heard).toEqual([{ state: 'old', version: '0.14.0' }]);
    delete fake.plugins.plugins['atlas-vtt'];
    tick();
    expect(heard.at(-1)).toEqual({ state: 'missing' });
    stop();
    expect(stopped).toBe(true);
  });
});
