import { describe, expect, it } from 'vitest';
import { isLightProfile, isPlayerLightMask, lightProfileOf } from '../../../src/app/online/lighting/lightMask';
import { isTokenEdit } from '../../../src/app/online/control/tokenEdits';

describe('dynamic light wire validation', () => {
  it('accepts only the known D&D light profiles in token edits', () => {
    expect(isLightProfile('torch')).toBe(true);
    expect(isLightProfile('fireball')).toBe(false);
    expect(isTokenEdit({ light: 'continual-flame' })).toBe(true);
    expect(isTokenEdit({ light: 'fireball' })).toBe(false);
    expect(lightProfileOf({ bright: 20, dim: 40, animation: 'torch' })).toBe('torch');
    expect(lightProfileOf({ bright: 20, dim: 40, animation: 'magic', color: '#fff3a3' })).toBe('light');
    expect(lightProfileOf({ bright: 120, dim: 240, animation: 'magic' })).toBeUndefined();
  });

  it('bounds the GM-rendered mask and rejects invalid image payloads', () => {
    expect(isPlayerLightMask({ width: 512, height: 512, png: `data:image/png;base64,${'A'.repeat(100)}` })).toBe(true);
    expect(isPlayerLightMask({ width: 513, height: 10, png: 'data:image/png;base64,AAAA' })).toBe(false);
    expect(isPlayerLightMask({ width: 10, height: 10, png: '<svg/>' })).toBe(false);
  });
});
