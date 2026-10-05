import { describe, expect, it } from 'vitest';
import { offeredNotes } from '../../../../src/app/online/sharing/model/linkedNotes';
import { mapFile } from './mapFileFixture';

// Final review M4: any truthy `isHidden` or `gmOnly` hides, as the projection reads it, so a hand-edited 1 holds the note back too.

describe('linked notes behind hidden tokens and GM-only pins', () => {
  it('counts a truthy isHidden or gmOnly as hidden, not only true', () => {
    const map = mapFile({
      objects: {
        tokens: { a: { id: 'a', kind: 'character', x: 0, y: 0, size: 1, name: 'A', notePath: 'Notes/A.md', isHidden: 1 } },
        pins: { p: { id: 'p', kind: 'pin', x: 0, y: 0, notePath: 'Notes/P.md', gmOnly: 'yes' }, q: { id: 'q', kind: 'pin', x: 0, y: 0, notePath: 'Notes/Q.md' } },
      },
    });
    expect(offeredNotes(map, 'player-safe').map((note) => note.path)).toEqual(['Notes/Q.md']);
    expect(offeredNotes(map, 'full').map((note) => note.path).sort()).toEqual(['Notes/A.md', 'Notes/P.md', 'Notes/Q.md']);
  });
});
