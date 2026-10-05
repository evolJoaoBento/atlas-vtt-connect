import { rollFormula } from '@atlas-vtt/shared/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { MIDDLE_ROLL, toolsWorld } from './toolsFixtures';

describe('player tools end to end', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("rolls a player's mixed roll on the GM's side, into the GM's dice log and every player's", async () => {
    const w = toolsWorld();
    w.present();
    const logs: Array<{ entries: readonly DiceLogEntry[]; replay: boolean }> = [];
    const a = await w.join('A', { onDiceLog: (entries, replay) => logs.push({ entries, replay }) });
    const b = await w.join('B');
    expect(logs).toEqual([{ entries: [], replay: true }]);
    expect(a.session.sendDiceRoll({ d6: 2, d8: 3 }, 1)).toBe(true);
    // 2 × 4 + 3 × 5 + 1: the second die's count is not a modifier.
    expect(w.logged).toHaveLength(1);
    expect(w.logged[0]).toMatchObject({ formula: '2d6+3d8+1', rolledBy: 'A', modifiers: 1, total: 24 });
    const entry = { name: 'A', formula: '2d6+3d8+1', modifier: 1, total: 24 };
    expect(logs.at(-1)).toMatchObject({ replay: false, entries: [entry] });
    expect(w.logs(b).at(-1)).toMatchObject({ replay: false, entries: [entry] });
    expect(w.logs(b).at(-1)?.entries[0]?.dice).toEqual([
      { die: 'd6', value: 4 }, { die: 'd6', value: 4 }, { die: 'd8', value: 5 }, { die: 'd8', value: 5 }, { die: 'd8', value: 5 },
    ]);
    w.finish();
  });

  it('replays the latest rolls to a rejoining player, newest first', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    a.session.sendDiceRoll({ d20: 1 }, 0);
    vi.advanceTimersByTime(10);
    w.publish(rollFormula('d4', MIDDLE_ROLL));
    // A new tab of the same player takes the link over and is admitted again.
    const again = await w.join('A');
    const replay = w.logs(again).find((log) => log.replay);
    expect(replay?.entries.map((logged) => [logged.name, logged.formula])).toEqual([['GM', 'd4'], ['A', 'd20']]);
    w.finish();
  });

  it('sends no laser without a scene, and nothing once the player is removed', async () => {
    const w = toolsWorld();
    const a = await w.join('A');
    expect(a.session.sendLaser([{ x: 1, y: 1 }], false)).toBe(false);
    w.gm.kick(a.playerId);
    expect(a.session.sendDiceRoll({ d6: 1 }, 0)).toBe(false);
    w.finish();
  });
});
