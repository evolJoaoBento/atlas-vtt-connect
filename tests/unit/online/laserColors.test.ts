import { describe, expect, it } from 'vitest';
import { decodeControl } from '../../../src/app/online/protocol';
import { swatchLaserColor } from '../../../src/app/online/tools/laserColors';

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
