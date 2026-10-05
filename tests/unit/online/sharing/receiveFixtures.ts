import type { ScenesApi } from '@atlas-vtt/api-types';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';
import type { InMemoryApp } from '../../../mocks/inMemoryVault';

/** Atlas's scenes over `vault`, as Connect's binding gets them: the fake (to plan failures and read the index) and Connect's `scenes`. */
export function scenesOver(vault: InMemoryApp): { atlas: FakeAtlas; scenes: ScenesApi } {
  const atlas = new FakeAtlas({ capabilities: ['scenes'], vault });
  return { atlas, scenes: atlas.connect(connectingPlugin('atlas-vtt-connect')).scenes };
}

/** The map file's state, as the fork's tests read it. */
export const mapState = (text: string | undefined): Record<string, any> => (JSON.parse(text ?? 'null') as { state: Record<string, any> }).state;
