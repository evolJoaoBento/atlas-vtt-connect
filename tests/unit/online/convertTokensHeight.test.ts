import { describe, expect, it } from 'vitest';
import { atlasToken } from '../../../src/app/online/obsidian/convertTokens';
import { playerToken } from './sceneFixtures';

describe("the Obsidian player's tokens carry Atlas 0.15's height and speed", () => {
  it('gives the token the height and speed the GM sent, and none it did not', () => {
    const lifted = atlasToken('t1', { ...playerToken(), elevation: 15, speed: 30 }, '') as { elevation?: unknown; speed?: unknown };
    expect([lifted.elevation, lifted.speed]).toEqual([15, 30]);
    const floor = atlasToken('t1', playerToken(), '');
    expect(floor).not.toHaveProperty('elevation');
    expect(floor).not.toHaveProperty('speed');
  });
});
