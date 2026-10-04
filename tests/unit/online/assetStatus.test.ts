import { describe, expect, it } from 'vitest';
import { clearImagesText, keepImagesText, progressText } from '../../../src/app/online/preview/assetStatus';

const MB = 1024 * 1024;

describe('asset status texts', () => {
  it('shows the loading bar only while images are outstanding, in MB with one decimal', () => {
    expect(progressText({ outstanding: 0, receivedBytes: 0, totalBytes: 0 })).toBeNull();
    expect(progressText({ outstanding: 2, receivedBytes: 0, totalBytes: 0 })).toBe('Loading images…');
    expect(progressText({ outstanding: 2, receivedBytes: 3.2 * MB, totalBytes: 5.1 * MB })).toBe('Loading images… 3.2 of 5.1 MB');
    expect(progressText({ outstanding: 1, receivedBytes: 1000, totalBytes: 150_000 })).toBe('Loading images… 0.0 of 0.1 MB');
  });

  it('names the switch and the clear button', () => {
    expect(keepImagesText({ keep: true, available: true, usedBytes: 0 })).toBe('Keep images on this device');
    expect(keepImagesText({ keep: false, available: true, usedBytes: 0 })).toBe('Keep images on this device');
    expect(keepImagesText({ keep: true, available: false, usedBytes: 0 })).toBe("Can't save on this device");
    expect(clearImagesText(0)).toBe('Clear saved images');
    expect(clearImagesText(12.34 * MB)).toBe('Clear saved images (12.3 MB)');
  });
});
