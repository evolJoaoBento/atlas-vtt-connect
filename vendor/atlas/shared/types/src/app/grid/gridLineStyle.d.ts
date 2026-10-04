import type { Point } from './hexGeometry';
/** The subset of the PIXI Graphics path API the grid drawers use; any recorder with the same shape works. */
export interface GridPath {
    moveTo(x: number, y: number): GridPath;
    lineTo(x: number, y: number): GridPath;
    poly(points: number[], close?: boolean): GridPath;
}
export type GridLineType = 'solid' | 'dashed' | 'dotted';
export interface GridBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
/** Arm length of the markers drawn at grid vertices for the "dotted" style. */
export declare function gridMarkerArmLength(cellSize: number): number;
/**
 * Draws a segment as two centered dashes (or one when the segment is short),
 * so every cell edge shows the same dash rhythm regardless of its length.
 */
export declare function drawDashedSegment(graphics: GridPath, x1: number, y1: number, x2: number, y2: number): void;
/** Draws a cell edge in the solid or dashed style. Dotted grids draw vertex markers instead of edges. */
export declare function drawStyledSegment(graphics: GridPath, x1: number, y1: number, x2: number, y2: number, lineType: GridLineType): void;
/**
 * Adds a single filled marker polygon at a grid vertex: one arm per incident
 * edge direction, joined at the centre. Drawing the marker as one shape (rather
 * than overlapping strokes) keeps the centre crisp at any opacity.
 * The caller fills the accumulated path afterwards.
 */
export declare function drawVertexMarker(graphics: GridPath, cx: number, cy: number, armDirections: Point[], armLength: number, thickness: number): void;
