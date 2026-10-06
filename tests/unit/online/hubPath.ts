/**
 * The two ways the scene hub runs (review I4): on an Atlas before scene tabs (`tabs: null`, the presented scene
 * attributed by the presentation) and on one with them (API 1.17.0: `TabScenes`, attribution by `SceneSnapshot.tabId`).
 * A guarded suite runs once per path (`describe.each(HUB_PATHS)` and `onHubPath`); its fixtures ask `pathPresenter`
 * and `pathTabs` which Atlas to build. Without a split the two must send the same, apart from spec Goal 2's hold changes.
 */
import { afterEach, beforeEach } from 'vitest';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { createTabScenes, type TabScenes } from '../../../src/app/online/atlas/tabScenes';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { presenter, type Presenter } from './presentedFixtures';

export const HUB_PATHS = [
  { atlas: 'before scene-tabs', tabs: false },
  { atlas: 'with scene-tabs', tabs: true },
] as const;

/** The capabilities `presenter()` gives its Atlas by default. */
const PRESENTER_CAPABILITIES: AtlasCapability[] = ['views', 'presentation', 'rules', 'settings', 'storage', 'dice', 'lasers', 'tokens'];

let tabsOn = false;

/** The enclosing suite's tests run on this path; outside one, fixtures build the older path. */
export function onHubPath(tabs: boolean): void {
  beforeEach(() => { tabsOn = tabs; });
  afterEach(() => { tabsOn = false; });
}

/** Whether the current test runs with scene tabs. */
export function hubTabsOn(): boolean {
  return tabsOn;
}

/** `capabilities` with `scene-tabs` added on the scene-tabs path. */
export function pathCapabilities(capabilities: readonly AtlasCapability[]): AtlasCapability[] {
  return tabsOn ? [...capabilities, 'scene-tabs'] : [...capabilities];
}

/** A presenter over an Atlas of the current path. */
export function pathPresenter(capabilities: readonly AtlasCapability[] = PRESENTER_CAPABILITIES): Presenter {
  return presenter(new FakeAtlas({ capabilities: pathCapabilities(capabilities) }));
}

/** The hub's tabs on the current path: `TabScenes` over the presenter's extension, or none. */
export function pathTabs(presenting: Pick<Presenter, 'extension'>): TabScenes | null {
  return tabsOn ? createTabScenes(presenting.extension) : null;
}
