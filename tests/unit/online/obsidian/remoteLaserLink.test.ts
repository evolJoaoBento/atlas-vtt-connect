import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RemoteLaserLink } from '../../../../src/app/online/obsidian/remote/RemoteLaserLink';
import { LASER_INTERVAL_MS } from '../../../../src/app/online/tools/LaserBatcher';
import { LASER_PALETTE } from '../../../../src/app/online/tools/laserColors';
import { connectingPlugin, FakeAtlas } from '../../../fake/FakeAtlas';

function setup(color: () => string) {
  const atlas = new FakeAtlas({ capabilities: ['views', 'lasers'] });
  atlas.views.openRemote('r1');
  const { lasers } = atlas.connect(connectingPlugin('atlas-vtt-connect'));
  const send = vi.fn((): boolean => true);
  const link = new RemoteLaserLink({ lasers, viewId: 'r1', send, color, clock: () => 0 });
  return { atlas, send, link, point: (x: number, y: number) => atlas.lasers.emitLocal('r1', { kind: 'point', x, y }) };
}

describe('RemoteLaserLink', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("sends Atlas's laser in batches and lets it go, in the player's colour", () => {
    const t = setup(() => LASER_PALETTE[1]!);
    t.point(1, 1);
    expect(t.send).toHaveBeenLastCalledWith([{ x: 1, y: 1 }], false, [0], LASER_PALETTE[1]);
    t.atlas.lasers.emitLocal('r1', { kind: 'lift' });
    vi.advanceTimersByTime(LASER_INTERVAL_MS + 1);
    expect(t.send).toHaveBeenLastCalledWith([], true, [], LASER_PALETTE[1]);
    t.link.dispose();
  });

  it('sends no colour that is not a swatch, so the GM gives one', () => {
    const t = setup(() => 'rebeccapurple');
    t.point(1, 1);
    expect(t.send).toHaveBeenLastCalledWith([{ x: 1, y: 1 }], false, [0], undefined);
    t.link.dispose();
  });

  it('sends a swatch in the palette spelling, whatever its case', () => {
    const t = setup(() => LASER_PALETTE[1]!.toUpperCase());
    t.point(1, 1);
    expect(t.send).toHaveBeenLastCalledWith([{ x: 1, y: 1 }], false, [0], LASER_PALETTE[1]);
    t.link.dispose();
  });

  it('stops listening once disposed', () => {
    const t = setup(() => LASER_PALETTE[0]!);
    t.link.dispose();
    t.point(1, 1);
    expect(t.send).not.toHaveBeenCalled();
    expect(t.atlas.lasers.listening('r1')).toBe(0);
  });
});
