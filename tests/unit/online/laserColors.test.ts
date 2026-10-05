import { LASER_COLOR_SWATCHES } from '@atlas-vtt/shared/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeControl, encodeControl } from '../../../src/app/online/protocol';
import { swatchLaserColor } from '../../../src/app/online/tools/laserColors';
import { toolsWorld } from './toolsFixtures';

const SWATCHES = LASER_COLOR_SWATCHES.map((swatch) => swatch.value);

const laser = (overrides: object = {}): object => ({ v: 1, type: 'laser', sceneId: 'scene-1', points: [{ x: 1, y: 2 }], lifted: false, ...overrides });
const valid = (message: object): boolean => decodeControl(JSON.stringify(message)).kind === 'message';

describe('the color of a laser message', () => {
  it('is absent or a #rrggbb color, never anything else', () => {
    expect(valid(laser())).toBe(true);
    expect(valid(laser({ color: '#00A9ff' }))).toBe(true);
    for (const color of ['red', '#fff', '#12345g', '#1234567', '', 5, null, {}, [], 'x'.repeat(5000)]) expect(valid(laser({ color }))).toBe(false);
    const proto = '{"v":1,"type":"laser","sceneId":"s","points":[],"lifted":true,"color":{"__proto__":{}}}';
    expect(decodeControl(proto).kind).toBe('invalid');
  });

  it('is a swatch only when a player names it', () => {
    expect(swatchLaserColor('#FF0059')).toBe('#ff0059');
    expect(swatchLaserColor('#123456')).toBeNull();
    expect(swatchLaserColor('constructor')).toBeNull();
    expect(swatchLaserColor(undefined)).toBeNull();
  });
});

describe('LaserRelay colors', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("forwards a player's swatch to the players and the GM's view, and falls back to their place for anything else", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    const send = (color?: string): void => a.sendRaw(encodeControl({
      v: 1, type: 'laser', sceneId: w.sceneId(), points: [{ x: 1, y: 1 }], lifted: false, ...(color ? { color } : {}),
    }));
    send('#00A9FF');
    expect(w.lasersOf(b).at(-1)?.color).toBe('#00a9ff');
    expect(w.shown().at(-1)?.color).toBe('#00a9ff');
    send('#123456');
    expect(w.lasersOf(b).at(-1)?.color).toBe(SWATCHES[1]);
    send();
    expect(w.shown().at(-1)?.color).toBe(SWATCHES[1]);
    w.finish();
  });

  it("keeps a stroke's color when the player leaves mid-stroke", async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    const b = await w.join('B');
    a.session.sendLaser([{ x: 1, y: 1 }], false, undefined, SWATCHES[4]);
    w.removePlayer(a);
    expect(w.lasersOf(b).at(-1)).toMatchObject({ lifted: true, color: SWATCHES[4] });
    w.finish();
  });

  it("colors the GM's laser with Atlas's setting, and a changed setting applies to the next message", async () => {
    const w = toolsWorld();
    w.atlas.setSetting('laserPointer', { color: '#12ab9f', size: 3 });
    w.present();
    const a = await w.join('A');
    w.emitLocal({ kind: 'point', x: 1, y: 2 });
    expect(w.lasersOf(a).at(-1)).toMatchObject({ from: 'gm', color: '#12ab9f' });
    w.emitLocal({ kind: 'lift' });
    await vi.advanceTimersByTimeAsync(100);
    w.atlas.setSetting('laserPointer', { color: '#FF00FF', size: 3 });
    w.emitLocal({ kind: 'point', x: 3, y: 4 });
    await vi.advanceTimersByTimeAsync(100);
    expect(w.lasersOf(a).at(-1)).toMatchObject({ from: 'gm', color: '#FF00FF' });
    w.finish();
  });

  it("falls back to the GM's first swatch when the setting is not a color", async () => {
    const w = toolsWorld();
    w.atlas.setSetting('laserPointer', { color: 'nope', size: 3 });
    w.present();
    const a = await w.join('A');
    w.emitLocal({ kind: 'point', x: 1, y: 2 });
    expect(w.lasersOf(a).at(-1)?.color).toBe(SWATCHES[0]);
    w.finish();
  });
});
