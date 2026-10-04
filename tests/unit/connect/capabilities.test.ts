import type { AtlasExtension } from '@atlas-vtt/api-types';
import { describe, expect, it } from 'vitest';
import { need } from '../../../src/connect/capabilities';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';

describe('need', () => {
  it('returns null while the capability has not landed, even when the extension carries the namespace', () => {
    const atlas = new FakeAtlas({ capabilities: [] });
    const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    expect(need(atlas, extension, 'storage')).toBeNull();
    const withStorage = new FakeAtlas({ capabilities: ['storage'] }).connect(connectingPlugin('atlas-vtt-connect'));
    expect(need(atlas, withStorage, 'storage')).toBeNull();
  });

  it('returns null for a landed capability whose namespace the extension lacks', () => {
    const atlas = new FakeAtlas({ capabilities: ['storage'] });
    // The fake carries the namespace once the capability is on; take it off to be an Atlas that lacks it.
    const { storage: _storage, ...bare } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    expect(need(atlas, bare as AtlasExtension, 'storage')).toBeNull();
  });

  it('returns the typed namespace when the capability and the namespace both exist', async () => {
    const atlas = new FakeAtlas({ capabilities: ['storage', 'settings'] });
    const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    const storage = need(atlas, extension, 'storage');
    expect(await storage?.folder()).toBe('atlas-vtt/.atlas-data/extensions/atlas-vtt-connect');
    expect(need(atlas, extension, 'settings')?.get('diceDisplay')).toBe('card');
  });
});
