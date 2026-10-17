/**
 * What players see of each resource of a character token, in its context menu: one submenu per resource the token
 * has, with a choice for this token and one for every token of its statblock. A choice stays across sessions, so the
 * menu is there whether a session runs or not, for a GM preparing a fight. It is the GM's own: never in a remote view.
 *
 * Each choice leaves the menu open (`keepOpen`), so both levels can be set in a row.
 */
import { visibleResources } from '@atlas-vtt/shared/rules';
import type { AtlasExtension, Character, MenuItem, ResourceDefinition, TokenMenuContext } from '@atlas-vtt/api-types';
import { collectionShow, statblockKey, statblockLabel, type ResourceShow, type ResourceVisibilityStore } from '../scene/resourceVisibility';

export const RESOURCE_SHOW_LABELS: Readonly<Record<ResourceShow, string>> = {
  both: 'Bar and numbers',
  bar: 'Bar only',
  numbers: 'Numbers only',
  hidden: 'Hidden',
};
const CHOICES: readonly ResourceShow[] = ['both', 'bar', 'numbers', 'hidden'];
export const THIS_TOKEN_LABEL = 'This token';

/** "HP for players": the submenu of one resource. */
export const resourceMenuLabel = (name: string): string => `${name} for players`;
/** The heading over a statblock's choices. */
export const everyTokenLabel = (statblock: string): string => `Every ${statblock}`;
/** The choice that leaves it to the collection, saying what that shows. */
export const collectionDefaultLabel = (definition: ResourceDefinition): string => `Map default (${RESOURCE_SHOW_LABELS[collectionShow(definition)].toLowerCase()})`;
/** A token's choice that leaves it to its statblock. */
export const sameAsStatblockLabel = (statblock: string): string => `Same as every ${statblock}`;

export interface ResourceVisibilityMenuDeps {
  views: Pick<AtlasExtension['views'], 'list' | 'snapshot'>;
  /** The resources of the collection holding the map at `mapPath`. */
  resources(mapPath: string): readonly ResourceDefinition[];
  store: ResourceVisibilityStore;
}

function choiceRows(current: ResourceShow | null, defaultLabel: string, set: (show: ResourceShow | null) => void): MenuItem[] {
  return [
    { label: defaultLabel, checked: current === null, keepOpen: true, onClick: () => set(null) },
    ...CHOICES.map((show): MenuItem => ({ label: RESOURCE_SHOW_LABELS[show], checked: current === show, keepOpen: true, onClick: () => set(show) })),
  ];
}

/** The token menu provider: a submenu per resource the character token has, in a GM's map view. */
export function resourceVisibilityProvider(deps: ResourceVisibilityMenuDeps): (ctx: TokenMenuContext) => MenuItem[] {
  return (ctx) => {
    if (ctx.isPlayerView || ctx.kind !== 'map' || ctx.tokenKind !== 'character') return [];
    const mapPath = deps.views.list().find((view) => view.viewId === ctx.viewId)?.mapPath ?? null;
    const token = deps.views.snapshot(ctx.viewId)?.objects?.tokens?.[ctx.tokenId];
    if (mapPath === null || token?.kind !== 'character') return [];
    const character: Character = token;
    const statblock = statblockKey(character);
    const name = statblockLabel(character);
    const { store } = deps;
    // The resources the token has a value for, in socket order, as the GM's own view lists them.
    return visibleResources(character, deps.resources(mapPath), 'dm').map(({ definition }): MenuItem => {
      const key = definition.key;
      const fallback = statblock !== null && name !== null ? sameAsStatblockLabel(name) : collectionDefaultLabel(definition);
      const rows: MenuItem[] = [
        { label: THIS_TOKEN_LABEL, disabled: true },
        ...choiceRows(store.tokenShow(mapPath, ctx.tokenId, key), fallback, (show) => store.setTokenShow(mapPath, ctx.tokenId, key, show)),
      ];
      if (statblock !== null && name !== null) {
        rows.push(
          { label: everyTokenLabel(name), disabled: true },
          ...choiceRows(store.statblockShow(statblock, key), collectionDefaultLabel(definition), (show) => store.setStatblockShow(statblock, key, show)),
        );
      }
      return { label: resourceMenuLabel(definition.name), icon: 'eye', submenu: rows };
    });
  };
}
