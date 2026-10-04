/**
 * Icons stampable onto a map with the draw tool.
 *
 * Values are the inner markup of the matching 24×24 Lucide icon, so the
 * toolbar picker can show the same glyph via `lucide-react`.
 */
export declare const MAP_ICON_SVG: Record<string, string>;
/** Human-readable names, shared by the toolbar picker and the drawing context menu. */
export declare const MAP_ICON_LABELS: Record<string, string>;
export type MapIconName = keyof typeof MAP_ICON_SVG;
/** Icon footprint in world units — one standard square grid cell. */
export declare const MAP_ICON_SIZE = 70;
