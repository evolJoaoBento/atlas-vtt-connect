/**
 * Sharing between Obsidian clients, the sending side: the share commands, the part commands, the tag and property
 * display, Ask to pull and the session hooks. It lives as long as Connect is bound to an Atlas with `scenes` and
 * `bundles`; the returned disposer takes everything off again. Receiving (Shared with me, pulls, merges and push
 * prompts) registers in the same scope.
 */
import type { Disposer, RulesApi, ScenesApi, ViewsApi } from '@atlas-vtt/api-types';
import type { OnlineJoinService } from '../obsidian/OnlineJoinService';
import type { OnlineSessionService } from '../OnlineSessionService';
import type { PlayerViewRules } from '../scene/playerViewRules';
import { registerSharePropertyDisplay } from './display/registerSharePropertyDisplay';
import { registerTagDisplay } from './display/registerTagDisplay';
import type { MergeHistory } from './merge/MergeHistory';
import type { ShareItems } from './model/ShareItems';
import { registerPartCommands } from './parts/registerPartCommands';
import type { PeopleBook } from './people/PeopleBook';
import type { PulledItems } from './receive/PulledItems';
import { registerAskToPull } from './registerAskToPull';
import { registerReceiving } from './registerReceiving';
import { registerSessionHooks } from './registerSessionHooks';
import { registerShareCommands } from './registerShareCommands';
import type { SharingLifetime } from './sharingLifetime';
import { sharingScope, type ScopePlugin } from './sharingScope';
import { VaultChangeFanOut } from './vaultChanges';

/** The Atlas namespaces sharing needs. */
export interface SharingAtlas {
  scenes: ScenesApi;
  rules: Pick<RulesApi, 'forMap'>;
  /** Atlas's player view rules (`settings.get('playerView')`). */
  playerView: () => PlayerViewRules;
  /** Atlas's map views, where a received map open there is not replaced; absent on an Atlas without `views`. */
  views?: Pick<ViewsApi, 'list'>;
}

/** Whether a map file is open in a GM map view, loaded or among its scene tabs (remote views hold no vault map). */
export function mapOpenIn(views: Pick<ViewsApi, 'list'>): (mapPath: string) => boolean {
  return (mapPath) => views.list().some((view) => view.kind === 'map' && (view.mapPath === mapPath || view.tabs.some((tab) => tab.mapPath === mapPath)));
}

export interface SharingServices {
  atlas: SharingAtlas;
  joins: OnlineJoinService;
  people: PeopleBook;
  items: ShareItems;
  /** What this Atlas pulled, and the merge history of pulled notes. */
  pulled: PulledItems;
  history: MergeHistory;
  /** The hosting service; null when this Atlas cannot host, so only joined sessions share. */
  sessions: OnlineSessionService | null;
  /** Connect's settings that sharing reads: this Atlas's table and the note properties shared notes keep. */
  settings: { ownTableId: () => string | null; shareableProperties: () => readonly string[] };
  /** What sharing hears for the plugin's lifetime (`sharingLifetime`, made in `onload`). */
  lifetime: SharingLifetime;
}

export function registerSharing(plugin: ScopePlugin, services: SharingServices): Disposer {
  const { atlas, joins, people, items, pulled, history, sessions, settings, lifetime } = services;
  const scope = sharingScope(plugin);
  const { sections } = lifetime;
  // The share commands and the pulled files both follow the vault: one handler of the lifetime's changes for both.
  const vaultChanges = new VaultChangeFanOut();
  try {
    const catalogue = registerShareCommands(scope, {
      people, items, sections, vaultChanges, ownTableId: settings.ownTableId,
      atlas: { scenes: atlas.scenes, rules: atlas.rules, playerView: atlas.playerView, shareableProperties: settings.shareableProperties },
    });
    registerPartCommands(scope, people);
    registerTagDisplay(scope);
    registerSharePropertyDisplay(scope, people);
    registerAskToPull(scope, { items, people, sections, scenes: atlas.scenes });
    registerReceiving(scope, { pulled, people, history, scenes: atlas.scenes, vaultChanges, ...(atlas.views ? { isOpen: mapOpenIn(atlas.views) } : {}) });
    registerSessionHooks(scope, { joins, people, sessions, catalogue });
    scope.register(lifetime.vaultChanges.attach(vaultChanges.dispatch));
  } catch (error) {
    // Nothing of a half-made registration stays: the next binding would add it all again.
    scope.dispose();
    throw error;
  }
  return () => scope.dispose();
}
