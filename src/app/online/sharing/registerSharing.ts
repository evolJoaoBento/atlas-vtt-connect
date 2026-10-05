/**
 * Sharing between Obsidian clients, the sending side: the share commands, the part commands, the tag and property
 * display, Ask to pull and the session hooks. It lives as long as Connect is bound to an Atlas with `scenes` and
 * `bundles`; the returned disposer takes everything off again. Receiving (Shared with me) registers beside it.
 */
import type { BundlesApi, Disposer, RulesApi, ScenesApi } from '@atlas-vtt/api-types';
import type { OnlineJoinService } from '../obsidian/OnlineJoinService';
import type { OnlineSessionService } from '../OnlineSessionService';
import type { PlayerViewRules } from '../scene/playerViewRules';
import { registerSharePropertyDisplay } from './display/registerSharePropertyDisplay';
import { registerTagDisplay } from './display/registerTagDisplay';
import { sectionTrustFor, type SectionTrust } from './model/sectionTrust';
import { SHARE_PROPERTY } from './model/shareRule';
import type { ShareItems } from './model/ShareItems';
import { registerPartCommands } from './parts/registerPartCommands';
import type { PeopleBook } from './people/PeopleBook';
import { registerAskToPull } from './registerAskToPull';
import { registerSessionHooks } from './registerSessionHooks';
import { registerShareCommands } from './registerShareCommands';
import { sharingScope, type ScopePlugin } from './sharingScope';

/** The Atlas namespaces sharing needs. */
export interface SharingAtlas {
  scenes: ScenesApi;
  bundles: Pick<BundlesApi, 'stripNoteProperties'>;
  rules: Pick<RulesApi, 'forMap'>;
  /** Atlas's player view rules (`settings.get('playerView')`). */
  playerView: () => PlayerViewRules;
}

export interface SharingServices {
  atlas: SharingAtlas;
  joins: OnlineJoinService;
  people: PeopleBook;
  items: ShareItems;
  /** The hosting service; null when this Atlas cannot host, so only joined sessions share. */
  sessions: OnlineSessionService | null;
  /** Connect's settings that sharing reads: this Atlas's table and the note properties shared notes keep. */
  settings: { ownTableId: () => string | null; shareableProperties: () => readonly string[] };
}

const trusts = new WeakMap<ScopePlugin, SectionTrust>();

/**
 * One record of what the metadata cache parsed, for everything that reads a note's sections. It lives with the plugin,
 * not the binding: a note changed while Atlas was away stays untrusted until Obsidian parses it again.
 */
function sectionTrustOf(plugin: ScopePlugin): SectionTrust {
  let trust = trusts.get(plugin);
  if (!trust) {
    trust = sectionTrustFor(plugin);
    trusts.set(plugin, trust);
  }
  return trust;
}

export function registerSharing(plugin: ScopePlugin, services: SharingServices): Disposer {
  const { atlas, joins, people, items, sessions, settings } = services;
  // Sharing never travels in bundles: Atlas strips the note property from exports and installs. Atlas remembers the
  // key, so it stays stripped while Connect is not loaded; the disposer would make it forget, so it is not called.
  atlas.bundles.stripNoteProperties([SHARE_PROPERTY]);
  const scope = sharingScope(plugin);
  const sections = sectionTrustOf(plugin);
  const catalogue = registerShareCommands(scope, {
    people, items, sections, ownTableId: settings.ownTableId,
    atlas: { scenes: atlas.scenes, rules: atlas.rules, playerView: atlas.playerView, shareableProperties: settings.shareableProperties },
  });
  registerPartCommands(scope, people);
  registerTagDisplay(scope);
  registerSharePropertyDisplay(scope, people);
  registerAskToPull(scope, { items, people, sections, scenes: atlas.scenes });
  registerSessionHooks(scope, { joins, people, sessions, catalogue });
  return () => scope.dispose();
}
