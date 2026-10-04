import type { ResourceDefinition, ResourceValue } from './resourceTypes';
/** The share of a resource that is left: what remains of a draining one, what is not yet used of a filling one. */
export declare function remainingShare(definition: ResourceDefinition, value: ResourceValue): number;
/**
 * The colour a resource shows in, as `#rrggbb`. A resource that defeats its token when
 * spent warns as it runs low: its own colour, yellow below 70%, red below 30%. Every
 * other resource keeps its colour.
 */
export declare function resourceColor(definition: ResourceDefinition, value: ResourceValue): string;
/**
 * The colours a resource may have, around the colour wheel and ending in two neutrals. Each
 * reads on the dark track of a bar or wheel and apart from its neighbours. The warning
 * yellow and red above are left out, so a low resource never looks like another one.
 */
export declare const RESOURCE_COLORS: ReadonlyArray<{
    value: string;
    label: string;
}>;
