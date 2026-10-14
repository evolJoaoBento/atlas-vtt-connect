/** The few Atlas types the ported wall code reads (Atlas VTT 0.8.0 `types/wallTypes.ts`, `types/visionTypes.ts`, `vision/visibility.ts`). */
export interface Point {
  x: number;
  y: number;
}

export interface MapBounds {
  width: number;
  height: number;
}

export type WallType = 'solid' | 'door' | 'secret-door';

/** What a wall can stop: the sight of tokens, or light. */
export type WallChannel = 'sight' | 'light';

export interface WallSegment {
  id: string;
  kind: 'wall';
  type: WallType;
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  direction?: 'left' | 'right' | undefined;
  closed?: boolean;
  locked?: boolean;
  blocks?: WallChannel | undefined;
  limited?: boolean | undefined;
  chainId?: string;
}
