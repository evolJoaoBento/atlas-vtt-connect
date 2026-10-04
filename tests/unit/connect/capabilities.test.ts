import type { AtlasExtension } from '@atlas-vtt/api-types';
import { describe, expect, it } from 'vitest';
import { need } from '../../../src/connect/capabilities';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';

describe('need', () => {
  it('returns the namespace only when the capability has landed', () => {
    const atlas = new FakeAtlas({ capabilities: [] });
    const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    // NeedMap is empty until B5 synced namespaces; B5 replaces the cast.
    expect(need(atlas, extension, 'views' as never)).toBeNull();
  });

  it('returns null for a landed capability whose namespace the extension lacks', () => {
    const atlas = new FakeAtlas({ capabilities: ['views'] });
    // The fake carries the namespace once the capability is on; take it off to be an Atlas that lacks it.
    const { views: _views, ...bare } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    expect(need(atlas, bare as unknown as AtlasExtension, 'views' as never)).toBeNull();
  });

  it('returns the namespace object when the capability and the namespace both exist', () => {
    const atlas = new FakeAtlas({ capabilities: ['views'] });
    const extension = { ...atlas.connect(connectingPlugin('atlas-vtt-connect')), views: { marker: true } } as unknown as AtlasExtension;
    expect(need(atlas, extension, 'views' as never)).toEqual({ marker: true });
  });
});
