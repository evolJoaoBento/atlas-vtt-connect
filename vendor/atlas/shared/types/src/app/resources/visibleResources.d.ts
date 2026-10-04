import { type ResourceDefinition, type ResourceHolder, type ResourceShape, type ResourceViewer, type VisibleResource } from './resourceTypes';
/** The shape a resource takes on a token: its slot decides, never the resource. */
export declare function shapeOf(slot: number): ResourceShape;
/** The resources a viewer sees on a token, in socket order. The only place that filters them. */
export declare function visibleResources(token: ResourceHolder, definitions: readonly ResourceDefinition[], viewer: ResourceViewer): VisibleResource[];
