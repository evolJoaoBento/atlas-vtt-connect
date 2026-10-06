import { describe, expect, it } from 'vitest';
import { HUB_PATHS, hubTabsOn, onHubPath, pathPresenter, pathTabs } from './hubPath';
import { emptySceneState, sceneView } from './presentedFixtures';

describe.each(HUB_PATHS)('the guarded suites run $atlas', ({ tabs }) => {
  onHubPath(tabs);

  it('build the hub of that path: scene tabs and a snapshot naming its tab only with scene-tabs', () => {
    expect(hubTabsOn()).toBe(tabs);
    const presenting = pathPresenter();
    const scene = sceneView(presenting, emptySceneState());
    const sceneTabs = pathTabs(presenting);
    expect(sceneTabs !== null).toBe(tabs);
    expect(presenting.extension.views.snapshot(scene.view)?.tabId ?? null).toBe(tabs ? scene.tavern : null);
    expect(sceneTabs?.liveTab() ?? null).toEqual(tabs ? { viewId: scene.view, tabId: scene.tavern } : null);
    sceneTabs?.dispose();
  });
});
