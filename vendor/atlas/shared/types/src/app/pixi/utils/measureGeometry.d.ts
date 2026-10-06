/**
 * Geometry and style of Atlas's measurements, shared by the measure tool and the token drag
 * ruler: the path's strokes, the point markers, circle and cone areas, and the distance label's
 * place, size and colours. Pure and PIXI-free; `utils/measureDrawing.ts` and `MeasureRenderer.ts`
 * draw them with Graphics. Lengths are world units unless they say screen pixels.
 */
import type { Point } from '../../grid/hexGeometry';
export type MeasureShape = 'line' | 'cone' | 'circle' | 'sphere';
/** Black, for the soft shadows under paths and points. */
export declare const MEASURE_SHADOW = 0;
/** A path is stroked three times: a soft shadow, the accent body and a bright core. */
export declare const MEASURE_PATH_STROKES: ReadonlyArray<{
    width: number;
    alpha: number;
    shadow: boolean;
}>;
/** A point marker: a shadow halo, an accent disc and a ring just inside it. */
export declare const MEASURE_POINT: {
    readonly radius: 8;
    readonly halo: 3;
    readonly haloAlpha: 0.3;
    readonly fillAlpha: 0.9;
    readonly ringInset: 1;
    readonly ringWidth: 2;
};
/** Circle and cone areas: a faint fill and an outline; circles add a thin highlight just inside. */
export declare const MEASURE_AREA: {
    readonly fillAlpha: 0.1;
    readonly strokeWidth: 3;
    readonly strokeAlpha: 0.8;
    readonly highlightWidth: 1.5;
    readonly highlightInset: 1;
};
/** The cone's default opening: 90 degrees, 45 on each side. A game system may set another (`MeasurementSettings.coneAngle`). */
export declare const CONE_ANGLE: number;
export declare const MEASURE_LABEL_FONT_SIZE = 16;
/** The label's pill per theme: its fill, then its hairline outline. */
export declare const MEASURE_LABEL_COLORS: {
    readonly fillAlpha: 0.95;
    readonly dark: {
        readonly fill: 2763306;
        readonly stroke: 16777215;
        readonly strokeAlpha: 0.4;
    };
    readonly light: {
        readonly fill: 14935011;
        readonly stroke: 0;
        readonly strokeAlpha: 0.3;
    };
};
/** The point halfway along the path's length, where its distance label goes. */
export declare function pathMidpoint(points: readonly Point[]): Point | null;
/** Font size in world units that keeps the label readable at any zoom. */
export declare function measureLabelFontSize(viewportScale: number): number;
/** Where the measure tool's label goes: the middle of the measurement, lifted a constant screen distance. */
export declare function measureLabelAnchor(start: Point, end: Point, viewportScale: number): Point;
export interface LabelBox {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
    strokeWidth: number;
}
/** The pill behind a label of `textWidth` × `textHeight` world units centred on `center`. */
export declare function measureLabelBox(textWidth: number, textHeight: number, center: Point, viewportScale: number): LabelBox;
export interface ConeGeometry {
    radius: number;
    /** The arc runs from `startAngle` to `endAngle`, in radians. */
    startAngle: number;
    endAngle: number;
    /** The ends of the cone's two straight edges. */
    left: Point;
    right: Point;
}
/** A cone from `start` towards `end`, opening `opening` radians. */
export declare function coneGeometry(start: Point, end: Point, opening?: number): ConeGeometry;
/**
 * `segments + 1` points along an arc, for surfaces that draw arcs as polylines.
 * Part of the shared drawing contract (`@atlas-vtt/shared/draw`); Atlas's own renderer draws arcs natively.
 */
export declare function arcPoints(center: Point, radius: number, startAngle: number, endAngle: number, segments: number): Point[];
