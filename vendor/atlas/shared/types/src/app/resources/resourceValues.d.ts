import type { ResourceDefinition, ResourceHolder, ResourceValue } from './resourceTypes';
export declare function clampValue(value: ResourceValue): ResourceValue;
export declare function withCurrent(value: ResourceValue, current: number): ResourceValue;
/** A fresh value: full when the resource drains (a static value is that number), empty when it fills. */
export declare function startingValue(definition: ResourceDefinition, max: number): ResourceValue;
/** Used up: 0 when draining, full when filling. A value without a maximum is never spent. */
export declare function isSpent(definition: ResourceDefinition, value: ResourceValue): boolean;
export declare function isDefeated(token: ResourceHolder, definitions: readonly ResourceDefinition[]): boolean;
/** Whether the token holds a resource that defeats it when spent. */
export declare function isKillable(token: ResourceHolder, definitions: readonly ResourceDefinition[]): boolean;
/** The token update that sets one resource; a hand-set maximum is remembered in `overriddenMax`. */
export declare function resourceUpdate(token: ResourceHolder, key: string, next: ResourceValue, maxEdited: boolean): {
    resources: Record<string, ResourceValue>;
    overriddenMax?: string[];
};
/** The token's resources with every one that defeats it spent. */
export declare function defeatedResources(token: ResourceHolder, definitions: readonly ResourceDefinition[]): Record<string, ResourceValue> | undefined;
/** The token's resources with every defined one back at its start: full when draining, empty when filling. */
export declare function restedResources(token: ResourceHolder, definitions: readonly ResourceDefinition[]): Record<string, ResourceValue> | undefined;
/** The Reset entry of a token's menu: worded as it always was where the collection has no resource beyond those two bars. */
export declare function resetLabel(definitions: readonly ResourceDefinition[]): string;
