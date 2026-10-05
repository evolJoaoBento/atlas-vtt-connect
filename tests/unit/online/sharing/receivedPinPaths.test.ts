import { describe, expect, it } from 'vitest';
import { MAP_PAYLOAD_FORMAT, NOTE_REF_PREFIX, type FullMapPayload } from '../../../../src/app/online/sharing/model/mapPayload';
import { receivedMapInput } from '../../../../src/app/online/sharing/receive/receivedMap';

// Final review M10: a received map's pins and token notes link only notes pulled from that sender. A path the sender
// wrote in clear never resolves against the receiver's own vault, even where such a file exists.

const OWN = 'Notes/My secret.md';
const PULLED = 'Shared/Ana/Inn.md';
const NOTE = 'n'.repeat(22);

function full(notePath: string): FullMapPayload {
  return {
    format: MAP_PAYLOAD_FORMAT, mode: 'full', name: 'Inn', notes: [NOTE], images: [],
    map: {
      background: null, grid: null,
      objects: {
        tokens: { hero: { id: 'hero', kind: 'character', x: 0, y: 0, size: 1, name: 'Hero', notePath } },
        texts: {}, drawings: {}, fog: {},
        pins: { a: { id: 'a', kind: 'pin', x: 1, y: 1, notePath }, b: { id: 'b', kind: 'pin', x: 2, y: 2, notePath: `${NOTE_REF_PREFIX}${NOTE}` } },
      },
    },
  };
}

describe('received pin and token note paths', () => {
  it("never link the receiver's own note, only the sender's pulled ones", () => {
    const map = receivedMapInput(full(OWN), { images: new Map(), notes: new Map([[NOTE, PULLED]]), isFile: (path) => path === OWN || path === PULLED });
    expect(Object.values(map.pins ?? {}).map((pin) => pin.notePath)).toEqual([PULLED]);
    expect(map.objects.tokens.hero && 'notePath' in map.objects.tokens.hero ? map.objects.tokens.hero.notePath : undefined).toBeUndefined();
    expect(JSON.stringify(map)).not.toContain(OWN);
  });
});
