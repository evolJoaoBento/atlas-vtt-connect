/**
 * Shared token ring geometry.
 *
 * `tokenSize` is the token sprite diameter (content area). The ring should sit just
 * outside that by the grid stroke inset on both sides so 1x tokens hug one full cell.
 */
export declare function getTokenRingOuterDiameter(tokenSize: number, strokeWidth?: number, ringScale?: number): number;
export declare function getTokenRingCenterRadius(tokenSize: number, strokeWidth?: number, ringScale?: number): number;
