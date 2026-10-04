import { type ResourceDefinition } from './resourceTypes';
/** A resource with the socket it takes on a token. */
export interface SlottedResource {
    definition: ResourceDefinition;
    slot: number;
}
/** Whether `slot` names one of a token's sockets. */
export declare function isSocket(slot: unknown): slot is number;
/**
 * Each resource with its socket, in socket order. A stored socket holds (the first to claim
 * it); a resource without one, or whose socket is taken, gets the first free socket in list
 * order, so presets and lists stored without sockets read as their order. What finds no
 * socket is left out: a token has `MAX_RESOURCES` of them.
 */
export declare function slottedResources(definitions: readonly ResourceDefinition[]): SlottedResource[];
