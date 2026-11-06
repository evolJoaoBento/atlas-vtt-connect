// online-client/ar/trackerWorker.mts
/** Finds the marker sheet in camera pictures off the page's thread, so the board keeps drawing while it looks. */
import { SheetTracker, type PictureData, type Tracked } from './sheetTracker.mts';
import type { Intrinsics } from './sheetPose.mts';

export interface TrackRequest { picture: PictureData; camera: Intrinsics }
export type TrackAnswer = { tracked: Tracked | null; error?: string };

const tracker = new SheetTracker();
const scope = self as unknown as { onmessage: ((event: MessageEvent<TrackRequest>) => void) | null; postMessage(answer: TrackAnswer): void };

scope.onmessage = (event) => {
  try {
    scope.postMessage({ tracked: tracker.track(event.data.picture, event.data.camera) });
  } catch (error) {
    scope.postMessage({ tracked: null, error: String(error) });
  }
};
