import { describe, expect, it } from 'vitest';
import { lightingIsStandard } from '../../../src/connect/stockAtlas';

describe('which Atlas lights scenes as standard', () => {
  it('is 0.9.1 and later, pre-releases of 0.9.1 included; never on a guess', () => {
    for (const version of ['0.9.1', '0.9.1-beta.0', '0.9.2-beta.0', '0.10.0', '1.0.0']) expect(lightingIsStandard(version)).toBe(true);
    for (const version of ['0.9.0', '0.8.1-beta.0', '0.8.0', '', 'next', undefined, 91]) expect(lightingIsStandard(version)).toBe(false);
  });
});
