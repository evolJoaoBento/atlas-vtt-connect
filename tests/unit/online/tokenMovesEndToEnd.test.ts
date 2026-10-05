import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlWorld } from './controlFixtures';

describe('token moves end to end', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("brings a player's drop to the GM's store and back to every player as a patch; others are refused", async () => {
    const w = controlWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    w.control.set('hero', a.playerId, true);
    w.control.set('orc', a.playerId, true);

    a.move('hero', 300, 150);
    await w.tick();
    for (const player of [a, b]) {
      expect(player.session.scene).toEqual(w.broadcaster.currentProjection());
      expect(player.session.scene?.tokens.hero).toMatchObject({ x: 315, y: 175 });
    }
    expect(b.received.filter((message) => message.type === 'scene-patch').length).toBeGreaterThan(0);

    // Unassigned, hidden, and a token another player controls.
    a.move('ally', 300, 150);
    a.move('orc', 300, 150);
    b.move('hero', 600, 150);
    expect(a.refusals()).toEqual(['ally', 'orc']);
    expect(b.refusals()).toEqual(['hero']);
    expect(w.token('hero')).toMatchObject({ x: 315, y: 175 });
    // Nothing about the hidden orc reached anyone but its id, which A sent itself.
    expect(JSON.stringify(b.received)).not.toContain('"orc"');
    w.finish();
  });
});
