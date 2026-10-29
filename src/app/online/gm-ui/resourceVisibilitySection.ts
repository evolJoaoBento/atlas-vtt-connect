/**
 * What players see of each resource of a character token, as a section of Atlas's Edit Token dialog: one row per
 * resource the token has, with a choice for this token and one for every token of its statblock. A choice stays across
 * sessions, so the section is there whether a session runs or not, for a GM preparing a fight. It is the GM's own:
 * never in a remote view. Choices apply when the dialog saves.
 */
import { visibleResources } from '../scene/visibleResources';
import type { AtlasExtension, Character, ResourceDefinition } from '@atlas-vtt/api-types';
import { collectionShow, statblockKey, statblockLabel, RESOURCE_SHOWS, type ResourceShow, type ResourceVisibilityStore } from '../scene/resourceVisibility';
import type { EditTokenChoice, EditTokenSectionProvider } from './editTokenSection';

export const RESOURCE_SHOW_LABELS: Readonly<Record<ResourceShow, string>> = {
  both: 'Bar and numbers',
  bar: 'Bar only',
  numbers: 'Number only',
  hidden: 'Hidden',
};
export const PLAYERS_SEE_TITLE = 'Players see';
export const THIS_TOKEN_LABEL = 'This token';

/** The heading over a statblock's choices. */
export const everyTokenLabel = (statblock: string): string => `Every ${statblock}`;
/** The choice that leaves it to the collection, saying what that shows. */
export const collectionDefaultLabel = (definition: ResourceDefinition): string => `Map default (${collectionShow(definition) === 'hidden' ? 'hidden' : 'shown'})`;
/** A token's choice that leaves it to its statblock. */
export const sameAsStatblockLabel = (statblock: string): string => `Same as every ${statblock}`;

export interface ResourceVisibilityMenuDeps {
  views: Pick<AtlasExtension['views'], 'list' | 'snapshot'>;
  /** The resources of the collection holding the map at `mapPath`. */
  resources(mapPath: string): readonly ResourceDefinition[];
  store: ResourceVisibilityStore;
}

/** A choice's value: a show, or '' for the level below. */
const DEFAULT_VALUE = '';
const isShow = (value: string): value is ResourceShow => (RESOURCE_SHOWS as readonly string[]).includes(value);

function choice(id: string, label: string, current: ResourceShow | null, defaultLabel: string): EditTokenChoice {
  return {
    id, label, value: current ?? DEFAULT_VALUE,
    options: [{ value: DEFAULT_VALUE, label: defaultLabel }, ...RESOURCE_SHOWS.map((show) => ({ value: show, label: RESOURCE_SHOW_LABELS[show] }))],
  };
}

/** The Edit Token section provider: a row per resource the character token has, in a GM's map view. */
export function resourceVisibilitySection(deps: ResourceVisibilityMenuDeps): EditTokenSectionProvider {
  return (ctx) => {
    if (ctx.isPlayerView || ctx.kind !== 'map' || ctx.tokenKind !== 'character') return null;
    const mapPath = deps.views.list().find((view) => view.viewId === ctx.viewId)?.mapPath ?? null;
    const token = deps.views.snapshot(ctx.viewId)?.objects?.tokens?.[ctx.tokenId];
    if (mapPath === null || token?.kind !== 'character') return null;
    const character: Character = token;
    const statblock = statblockKey(character);
    const name = statblockLabel(character);
    const shared = statblock !== null && name !== null ? { key: statblock, name } : null;
    const { store } = deps;
    // The resources the token has a value for, in socket order, as the GM's own view lists them.
    const definitions = visibleResources(character, deps.resources(mapPath), 'dm').map(({ definition }) => definition);
    if (definitions.length === 0) return null;
    return {
      title: PLAYERS_SEE_TITLE,
      columns: shared ? [THIS_TOKEN_LABEL, everyTokenLabel(shared.name)] : [THIS_TOKEN_LABEL],
      rows: definitions.map((definition) => ({
        label: definition.name,
        choices: [
          choice(`token:${definition.key}`, `${definition.name}, ${THIS_TOKEN_LABEL.toLowerCase()}`, store.tokenShow(mapPath, ctx.tokenId, definition.key),
            shared ? sameAsStatblockLabel(shared.name) : collectionDefaultLabel(definition)),
          ...(shared ? [choice(`statblock:${definition.key}`, `${definition.name}, ${everyTokenLabel(shared.name).toLowerCase()}`, store.statblockShow(shared.key, definition.key), collectionDefaultLabel(definition))] : []),
        ],
      })),
      save: (values) => {
        for (const definition of definitions) {
          const key = definition.key;
          const own = values.get(`token:${key}`);
          if (own !== undefined && (own === DEFAULT_VALUE || isShow(own)) && (own || null) !== store.tokenShow(mapPath, ctx.tokenId, key)) {
            store.setTokenShow(mapPath, ctx.tokenId, key, isShow(own) ? own : null);
          }
          const every = values.get(`statblock:${key}`);
          if (shared && every !== undefined && (every === DEFAULT_VALUE || isShow(every)) && (every || null) !== store.statblockShow(shared.key, key)) {
            store.setStatblockShow(shared.key, key, isShow(every) ? every : null);
          }
        }
      },
    };
  };
}
