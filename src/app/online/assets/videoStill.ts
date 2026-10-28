/**
 * A still of an animated map (a `.webm` or `.mp4` background), for players who are sent the map as an image: its
 * first frame, as a PNG, taken in the GM's window (as Atlas's own online play takes the still of an animated map).
 * The video is read from its URL, never into memory whole, so a long map video costs only its first frame.
 */

/** How long the first frame may take to arrive before the map goes without a still. */
const FRAME_TIMEOUT_MS = 10_000;

/** What `videoStill` uses of a document: its `video` and `canvas` elements. */
interface StillDocument {
  createElement(tag: 'video'): HTMLVideoElement;
  createElement(tag: 'canvas'): HTMLCanvasElement;
}

/** The first frame of the video at `url` as a PNG; throws when the video cannot be played or has no frame to show. */
export async function videoStill(doc: StillDocument, url: string, timeoutMs = FRAME_TIMEOUT_MS): Promise<ArrayBuffer> {
  const video = doc.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The map video has no first frame')), timeoutMs);
      const done = (error: Error | null): void => {
        window.clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      video.addEventListener('loadeddata', () => done(null), { once: true });
      video.addEventListener('error', () => done(new Error('The map video could not be played')), { once: true });
      video.src = url;
    });
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!(width > 0) || !(height > 0)) throw new Error('The map video has no picture');
    const canvas = doc.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The map video could not be drawn');
    context.drawImage(video, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob || blob.size === 0) throw new Error('The map video could not be saved as a still');
    return await blob.arrayBuffer();
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
