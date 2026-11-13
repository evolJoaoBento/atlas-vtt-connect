import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe("the vendored player board of Tabletop", () => {
  it('is the board of Tabletop 1.4.0 (the fusion 1 release), built from a clean tree', () => {
    const source = JSON.parse(readFileSync(path.resolve(__dirname, '../../../vendor/tabletop/SOURCE.json'), 'utf8')) as { name: string; version: string; dirty: boolean; commit: string };
    expect(source.name).toBe('atlas-vtt-tabletop');
    expect(source.version).toBe('1.4.0');
    expect(source.dirty).toBe(false);
    expect(source.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
