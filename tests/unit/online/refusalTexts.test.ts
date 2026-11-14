import { describe, expect, it } from 'vitest';
import { FULL_TEXT, LIMIT_TEXT, NOT_HELD_TEXT } from '../../../src/app/online/page/pageScreen';
import { MOVE_REFUSED_TEXT, refusedText } from '../../../src/app/online/view/TokenMoves';

describe('what a player is told when the GM turns something down', () => {
  it('says why: Atlas is on another map, they have as many as they may, or the map holds no more', () => {
    expect(refusedText('not-held')).toBe(NOT_HELD_TEXT);
    expect(refusedText('limit')).toBe(LIMIT_TEXT);
    expect(refusedText('full')).toBe(FULL_TEXT);
    expect(refusedText()).toBe(MOVE_REFUSED_TEXT);
    expect(new Set([NOT_HELD_TEXT, LIMIT_TEXT, FULL_TEXT, MOVE_REFUSED_TEXT]).size).toBe(4);
  });
});
