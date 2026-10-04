/**
 * Shared rendering functions for fog operations on Canvas 2D.
 *
 * Used by both FogCanvasCompositor (full-canvas preview) and
 * FogOperationCanvas (per-operation sprite rendering).
 */
import type { FogBounds, FogOperation, FogBrushStroke, FogLassoFill, FogRectangleFill } from '../../types/fogTypes';
export declare const FOG_COLOR = "rgba(0, 0, 0, 1)";
/** Render a brush stroke as interpolated filled circles. */
export declare function renderBrush(ctx: CanvasRenderingContext2D, op: FogBrushStroke, bounds: FogBounds, scale: number, offsetX: number, offsetY: number): void;
/** Render a filled lasso polygon. */
export declare function renderLasso(ctx: CanvasRenderingContext2D, op: FogLassoFill, bounds: FogBounds, scale: number, offsetX: number, offsetY: number): void;
/** Render a filled rectangle. */
export declare function renderRectangle(ctx: CanvasRenderingContext2D, op: FogRectangleFill, bounds: FogBounds, scale: number, offsetX: number, offsetY: number): void;
/** Dispatch to the correct renderer based on operation type. */
export declare function renderOperation(ctx: CanvasRenderingContext2D, op: FogOperation, bounds: FogBounds, scale: number, offsetX: number, offsetY: number): void;
/** Calculate the world-space bounding box of a single operation. */
export declare function calculateOperationBounds(op: FogOperation): FogBounds;
