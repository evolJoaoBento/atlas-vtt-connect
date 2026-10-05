import type { AtlasCapability } from '@atlas-vtt/api-types';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONE_ANGLE } from '@atlas-vtt/shared/grid';
import { sessionDeps } from '../../../src/app/online/atlas/sessionDeps';
import { need } from '../../../src/connect/capabilities';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';

const MAP = 'maps/a.atlasmap';

function deps(capabilities: AtlasCapability[] = ['views', 'presentation', 'rules', 'settings', 'storage', 'dice', 'lasers', 'tokens']) {
  const atlas = new FakeAtlas({ capabilities });
  const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  return { atlas, deps: sessionDeps(extension, { dice: need(atlas, extension, 'dice'), lasers: need(atlas, extension, 'lasers'), lighting: need(atlas, extension, 'lighting'), tokens: need(atlas, extension, 'tokens') }) };
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
  });

  it("follows rules-changed, and Atlas's player view settings", () => {
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
    atlas.setSetting('playerView', { showGrid: false, showTokenNameplates: true, showWidgets: true, showInitiative: true });
    expect(viewRules).toHaveBeenCalledTimes(1);
    expect(d.playerViewSettings.getLocalPlayerViewSettings().showGrid).toBe(false);
  });

  it("gives players' dice and lasers when Atlas has them, and neither on an Atlas without", () => {
    expect(deps().deps).toHaveProperty('dice');
    expect(deps().deps).toHaveProperty('laser');
    const older = deps(['views', 'presentation', 'rules', 'settings', 'storage']).deps;
    expect(older).not.toHaveProperty('dice');
    expect(older).not.toHaveProperty('laser');
  });

  it("lets players move tokens through Atlas's tokens when it has them; without, no control host and no control list", () => {
    expect(deps().deps).toHaveProperty('tokenControl');
    expect(deps(['views', 'presentation', 'rules', 'settings', 'storage', 'dice', 'lasers']).deps).not.toHaveProperty('tokenControl');
  });

  it("reads players' darkness from Atlas's lighting when it has it; without, the broadcaster's closed stub applies", () => {
    expect(deps(['views', 'presentation', 'rules', 'settings', 'storage', 'lighting']).deps.lighting).toBeDefined();
    expect(deps().deps).not.toHaveProperty('lighting');
  });
});
