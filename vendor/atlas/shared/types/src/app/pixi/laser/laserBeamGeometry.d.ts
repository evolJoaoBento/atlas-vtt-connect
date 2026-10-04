/** A point of the beam: where it is and how much of its life is left (1 fresh, 0 gone). */
export interface BeamPoint {
    x: number;
    y: number;
    life: number;
}
/**
 * Vertex data for one frame of the beam, reused between frames. The beam is a chain of
 * capsules, one per segment; each is a quad whose four vertices all carry the segment,
 * so the shader measures every pixel's distance to it.
 */
export interface LaserBeamBuffers {
    /** x, y of each quad corner. */
    positions: Float32Array;
    /** Per vertex: the segment's start x, y and end x, y. */
    segments: Float32Array;
    /** Per vertex: life at the start and end, radius at the start and end. */
    shapes: Float32Array;
    indices: Uint32Array;
}
export interface BeamBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
/** Most raw pointer samples a trail keeps. */
export declare const MAX_TRAIL_SAMPLES = 100;
/** The hovering pointer's dot is a little wider than the beam, so it reads as the laser's spot. */
export declare const DOT_SCALE = 1.25;
/** The hot filament's share of the body, as in the shader, for beams drawn as strokes. */
export declare const FILAMENT_SHARE = 0.25;
export declare const FILAMENT_COLOR = 16777215;
export interface BeamWidth {
    /** Half the beam's width including its glow, in world units. */
    halfWidth: number;
    /** Share of that half width the solid body takes. */
    bodyShare: number;
}
/** Longest straight step of the smoothed beam in world units, so the curve stays round at any zoom. */
export declare function beamSmoothingSpacing(halfWidth: number, zoom: number): number;
/** How wide the beam is for the size setting, which is in screen pixels at any zoom. */
export declare function beamWidth(size: number, zoom: number): BeamWidth;
/** The closest two trail points may be, in world units, for a laser of `size` at `zoom`. */
export declare function laserPointSpacing(size: number, zoom: number): number;
/** The beam's half width at `point`, narrowing as the point ages. */
export declare function beamRadius(point: BeamPoint, halfWidth: number): number;
export declare function createLaserBeamBuffers(): LaserBeamBuffers;
/**
 * Catmull-Rom curve through the pointer samples, so fast strokes stay round instead of
 * showing the straight segments between pointer events. `spacing` is the longest step
 * between output points; life is interpolated along with the position.
 */
export declare function smoothBeam(points: readonly BeamPoint[], spacing: number): BeamPoint[];
/**
 * Writes the beam into `buffers`: a capsule along every segment of `trail`, narrowing as
 * its points age, and a round dot at `dot` (the pointer while it is not drawing). Each
 * capsule depends only on its own two ends, so jitter and sharp turns cannot fold the
 * beam. Index slots left over from longer frames become empty triangles. Returns the
 * area the beam covers, or null when nothing is drawn.
 */
export declare function writeLaserBeam(buffers: LaserBeamBuffers, trail: readonly BeamPoint[], dot: BeamPoint | null, halfWidth: number): BeamBounds | null;
