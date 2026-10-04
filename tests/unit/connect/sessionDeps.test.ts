import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONE_ANGLE } from '@atlas-vtt/shared/grid';
import { sessionDeps } from '../../../src/app/online/atlas/sessionDeps';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';

const MAP = 'maps/a.atlasmap';

function deps() {
  const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'storage'] });
  return { atlas, deps: sessionDeps(atlas.connect(connectingPlugin('atlas-vtt-connect'))) };
}

describe('sessionDeps', () => {
  it("reads a map's rules from its collection, and Atlas's defaults outside one", () => {
    const { atlas, deps: d } = deps();
    expect(d.collectionGrid!(MAP)).toBeNull();
    expect(d.coneAngle!(MAP)).toBe(DEFAULT_CONE_ANGLE);
    const hp = { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', visibleToPlayers: true } as const;
    atlas.rules.saveCollection('c1', {
      maps: [MAP], gridDefaults: { unitType: 'meters', unitDistance: 1.5, measurementMode: 'metric', coneAngle: 53.13 },
      resources: [hp], initiative: { mode: 'sides', roll: '1d20', firstSide: 'opponents' },
    });
    expect(d.collectionGrid!(MAP)).toMatchObject({ unitType: 'meters', unitDistance: 1.5 });
    expect(d.coneAngle!(MAP)).toBe(53.13);
    expect(d.resources!(MAP)).toEqual([hp]);
    expect(d.initiativeRules!(MAP)).toEqual({ mode: 'sides', roll: '1d20', firstSide: 'opponents' });
    expect(d.diceRules!(null)).toEqual(atlas.connect(connectingPlugin('other')).rules.forMap(null).dice);
  });

  it("follows rules-changed, and Atlas's player view and laser settings", () => {
    const { atlas, deps: d } = deps();
    const resources = vi.fn();
    const stop = d.watchResources!(resources);
    atlas.rules.saveCollection('c1', { maps: [MAP] });
    atlas.rules.indexLoaded();
    expect(resources).toHaveBeenCalledTimes(2);
    stop();
    atlas.rules.saveCollection('c1', { maps: [MAP] });
    expect(resources).toHaveBeenCalledTimes(2);
    const viewRules = vi.fn();
    d.playerViewSettings.onChange(viewRules);
    atlas.setSetting('laserPointer', { color: '#00ff00', size: 3 });
    expect(viewRules).not.toHaveBeenCalled();
    expect(d.gmLaserColor!()).toBe('#00ff00');
    atlas.setSetting('playerView', { showGrid: false, showTokenNameplates: true, showWidgets: true, showInitiative: true });
    expect(viewRules).toHaveBeenCalledTimes(1);
    expect(d.playerViewSettings.getLocalPlayerViewSettings().showGrid).toBe(false);
  });
});
