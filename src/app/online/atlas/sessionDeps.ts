/** The `Deps` of `OnlineSessionService` that come from Atlas: the presented scene, the collections' rules, Atlas's settings. */
import type { AtlasExtension } from '@atlas-vtt/api-types';
import type { Deps } from '../OnlineSessionService';
import { presentedSource } from './presentedSource';

type SessionAtlas = Pick<AtlasExtension, 'presentation' | 'views' | 'rules' | 'settings' | 'on'>;

export type AtlasSessionDeps = Pick<Deps,
  'presented' | 'views' | 'collectionGrid' | 'coneAngle' | 'resources' | 'initiativeRules' | 'watchResources' | 'diceRules' | 'playerViewSettings' | 'gmLaserColor'
>;

/** Connect's own settings are not among these: the service takes them itself. */
export function sessionDeps(atlas: SessionAtlas): AtlasSessionDeps {
  return {
    presented: presentedSource(atlas),
    views: atlas.views,
    collectionGrid: (p) => atlas.rules.forMap(p).gridDefaults,
    coneAngle: (p) => atlas.rules.forMap(p).measurement.coneAngle,
    resources: (p) => atlas.rules.forMap(p).resources,
    initiativeRules: (p) => atlas.rules.forMap(p).initiative,
    watchResources: (cb) => atlas.on('rules-changed', () => cb()),
    diceRules: (p) => atlas.rules.forMap(p).dice,
    playerViewSettings: {
      getLocalPlayerViewSettings: () => atlas.settings.get('playerView'),
      onChange: (cb) => atlas.on('settings-changed', (key) => { if (key === 'playerView') cb(); }),
    },
    gmLaserColor: () => atlas.settings.get('laserPointer').color,
  };
}
