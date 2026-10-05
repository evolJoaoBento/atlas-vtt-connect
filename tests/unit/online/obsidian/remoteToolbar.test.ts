import { describe, expect, it } from 'vitest';
import { FIT_MAP_ITEM, FIT_MAP_LABEL, FOLLOW_GM_ITEM, FOLLOW_GM_LABEL } from '../../../../src/app/online/obsidian/remote/remoteToolbar';
import { playerScene } from '../sceneFixtures';
import { remoteSceneSetup } from './remoteSceneFixtures';

describe('the remote view toolbar', () => {
  it('adds Follow GM and Fit map to remote views only, Follow GM active while the view follows', async () => {
    const t = await remoteSceneSetup();
    t.atlas.views.open('gm');
    expect(t.atlas.ui!.drawToolbar('gm').map((item) => item.id)).not.toContain(FOLLOW_GM_ITEM);
    const drawn = t.atlas.ui!.drawToolbar(t.view.viewId);
    expect(drawn.map(({ id, label, icon }) => ({ id, label, icon }))).toEqual([
      { id: FOLLOW_GM_ITEM, label: FOLLOW_GM_LABEL, icon: 'locate-fixed' },
      { id: FIT_MAP_ITEM, label: FIT_MAP_LABEL, icon: 'maximize' },
    ]);
    expect(drawn.find((item) => item.id === FOLLOW_GM_ITEM)?.active).toBe(true);
    const invalidated = t.atlas.ui!.version();
    t.handle.moveCamera(true);
    expect(t.atlas.ui!.version()).toBeGreaterThan(invalidated);
    expect(t.atlas.ui!.drawToolbar(t.view.viewId).find((item) => item.id === FOLLOW_GM_ITEM)?.active).toBe(false);
  });

  it("does nothing in another extension's remote view", async () => {
    const t = await remoteSceneSetup();
    t.sink().scene(playerScene());
    t.atlas.views.openRemote('other');
    const asked = t.handle.count('setCamera');
    t.atlas.ui!.clickToolbar(FIT_MAP_ITEM, 'other');
    t.atlas.ui!.clickToolbar(FOLLOW_GM_ITEM, 'other');
    expect(t.handle.count('setCamera')).toBe(asked);
    expect(t.atlas.ui!.drawToolbar('other').find((item) => item.id === FOLLOW_GM_ITEM)?.active).toBe(false);
  });

  it('adds nothing on an Atlas without UI slots', async () => {
    const t = await remoteSceneSetup({ capabilities: ['views', 'lasers', 'settings', 'remote-view'] });
    expect(t.attached).toBe(true);
    expect(t.atlas.ui).toBeUndefined();
  });
});
