import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../../../src');
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sources(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("Atlas's measures are the only place a spell or a template is kept", () => {
  const files = sources(SRC).map((file) => ({ file: path.relative(SRC, file).split(path.sep).join('/'), text: readFileSync(file, 'utf8') }));

  it('the GM keeps no list of its own: no TemplateHost, no per-scene maps of templates or spells', () => {
    for (const { file, text } of files) {
      expect(text, file).not.toMatch(/\bTemplateHost\b/);
      expect(text, file).not.toMatch(/\bspellsByScene\b|\bbyScene\b/);
      expect(text, file).not.toMatch(/\bcastGm\b|\baddGm\b|\bspellsFor\b|\blistFor\b/);
    }
  });

  it('no list of templates or spells is on the wire: players get measures in the scene', () => {
    for (const { file, text } of files) expect(text, file).not.toMatch(/'map-(templates|spells)'/);
  });
});
