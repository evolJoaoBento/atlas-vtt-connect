// online-client/ar/trackerWorker.mts
/** Finds our markers in camera pictures off the page's thread, so the board keeps drawing while it looks. */
import { SheetTracker, type Detected, type PictureData } from './sheetTracker.mts';
import type { Intrinsics } from './sheetPose.mts';

export interface TrackRequest { picture: PictureData; camera: Intrinsics }
export type TrackAnswer = { markers: Detected[]; error?: string };

const tracker = new SheetTracker();
const scope = self as unknown as { onmessage: ((event: MessageEvent<TrackRequest>) => void) | null; postMessage(answer: TrackAnswer): void };

scope.onmessage = (event) => {
  try {
    scope.postMessage({ markers: tracker.detect(event.data.picture, event.data.camera) });
  } catch (error) {
    scope.postMessage({ markers: [], error: String(error) });
  }
};
