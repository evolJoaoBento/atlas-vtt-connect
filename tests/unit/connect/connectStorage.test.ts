import { describe, expect, it } from 'vitest';
import { connectStorage } from '../../../src/connect/connectStorage';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';

describe('connectStorage', () => {
  it('puts the sharing files under the extension folder Atlas gives', async () => {
    const atlas = new FakeAtlas({ capabilities: ['storage'] });
    const paths = await connectStorage(atlas, atlas.connect(connectingPlugin('atlas-vtt-connect')));
    const root = 'atlas-vtt/.atlas-data/extensions/atlas-vtt-connect/sharing';
    expect(paths).toEqual({ root, people: `${root}/people.json`, items: `${root}/items.json`, pulled: `${root}/pulled.json`, bases: `${root}/bases`, history: `${root}/history` });
  });

  it('is null on an Atlas without the storage capability', async () => {
    const atlas = new FakeAtlas({ capabilities: ['settings'] });
    expect(await connectStorage(atlas, atlas.connect(connectingPlugin('atlas-vtt-connect')))).toBeNull();
  });
});
