import type { CollectionGridDefaults, ConditionDefinition, DiceRules, InitiativeRules, MapRules, ResourceDefinition, RulesApi } from '@atlas-vtt/api-types';
import { DEFAULT_CONE_ANGLE, resolveMeasurementSettings } from '@atlas-vtt/shared/grid';
import { DEFAULT_DICE_RULES, DEFAULT_INITIATIVE_RULES } from '@atlas-vtt/shared/rules';

/** One collection as its settings screen saves it; unset parts are Atlas's defaults. */
export interface FakeCollection {
  /** The maps the collection holds. */
  maps: readonly string[];
  gridDefaults?: CollectionGridDefaults;
  /** The cone angle Atlas works out from the collection's game system when it has no grid defaults (e.g. 53.13 for D&D 5e). */
  systemConeAngle?: number;
  resources?: readonly ResourceDefinition[];
  conditions?: readonly ConditionDefinition[];
  initiative?: InitiativeRules;
  dice?: DiceRules;
}

const deepFreeze = <T>(value: T): T => {
  if (typeof value === 'object' && value !== null) for (const member of Object.values(value)) deepFreeze(member);
  return Object.freeze(value);
};

/** The collections' rules; saving one fires 'rules-changed' with its id, the index loading fires it with null. */
export class FakeRules {
  private readonly collections = new Map<string, FakeCollection>();

  constructor(private readonly changed: (collectionId: string | null) => void) {}

  /** The GM saves a collection's settings. */
  saveCollection(id: string, collection: FakeCollection): void {
    this.collections.set(id, structuredClone(collection));
    this.changed(id);
  }

  /** The asset index finished loading: any collection may differ. */
  indexLoaded(): void {
    this.changed(null);
  }

  api(): RulesApi {
    return Object.freeze({ forMap: (mapPath: string | null): MapRules => this.forMap(mapPath) });
  }

  /** A deep-frozen copy: the stored collection stays the fake's own. */
  private forMap(mapPath: string | null): MapRules {
    const entry = mapPath === null ? undefined : [...this.collections].find(([, collection]) => collection.maps.includes(mapPath));
    const [collectionId, collection] = entry ?? [null, undefined];
    const gridDefaults = collection?.gridDefaults ?? null;
    return deepFreeze(structuredClone({
      collectionId,
      gridDefaults,
      measurement: { ...resolveMeasurementSettings(gridDefaults ?? undefined, null), coneAngle: gridDefaults?.coneAngle ?? collection?.systemConeAngle ?? DEFAULT_CONE_ANGLE },
      resources: collection?.resources ?? [],
      conditions: collection?.conditions ?? [],
      initiative: collection?.initiative ?? DEFAULT_INITIATIVE_RULES,
      dice: collection?.dice ?? DEFAULT_DICE_RULES,
    }));
  }
}
