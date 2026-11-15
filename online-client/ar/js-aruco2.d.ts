// The parts of js-aruco2 (a CommonJS script without types) the page uses.
declare module 'js-aruco2' {
  export namespace AR {
    interface Point { x: number; y: number }
    class Marker {
      id: number;
      /** The marker's outer corners in the picture, in its own order (its top left first, then round clockwise). */
      corners: Point[];
      hammingDistance: number;
    }
    class Detector {
      constructor(config?: { dictionaryName?: string; maxHammingDistance?: number });
      detectImage(width: number, height: number, data: Uint8ClampedArray | Uint8Array): Marker[];
      /** The last picture searched, in grey (one byte a pixel, row by row). */
      grey: { width: number; height: number; data: ArrayLike<number> };
    }
    class Dictionary {
      constructor(name: string);
      /** Each code's bits, row by row, as a string of 0s and 1s. */
      codeList: string[];
      markSize: number;
      generateSVG(id: number): string;
    }
  }
}
