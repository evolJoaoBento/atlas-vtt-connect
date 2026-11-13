import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const check = (shared?: string) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-shared.mjs'), ...(shared ? ['--dir', shared] : [])], { encoding: 'utf8' });
const copy = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'atlas-shared-'));
  cpSync(path.join(ROOT, 'packages/atlas-shared'), dir, { recursive: true });
  return dir;
};
const firstStub = (dir: string): string => {
  const source = JSON.parse(readFileSync(path.join(dir, 'SOURCE.json'), 'utf8')) as { stubs: Record<string, string> };
  return path.join(dir, Object.keys(source.stubs)[0]!);
};

describe('check-shared', () => {
  it('passes on the committed tree', () => {
    const run = check();
    expect(run.stdout + run.stderr).toContain('packages/atlas-shared matches Atlas 0.15.0');
    expect(run.status).toBe(0);
  });

  it('fails when a copied file changed by one byte', () => {
    const dir = copy();
    const file = path.join(dir, 'src/app/grid/gridDistance.ts');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Grid distance', 'Grid distancE'));
    const run = check(dir);
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).toContain('changed: src/app/grid/gridDistance.ts');
  });

  it('fails when a stub holds code', () => {
    const dir = copy();
    const stub = firstStub(dir);
    expect(statSync(stub).isFile()).toBe(true);
    writeFileSync(stub, `${readFileSync(stub, 'utf8')}\nexport const leaked = 1;\n`);
    const run = check(dir);
    expect(run.status).toBe(1);
    expect(run.stdout + run.stderr).toContain('stub has code');
  });

  it('copies only what the list names', () => {
    const app = path.join(ROOT, 'packages/atlas-shared/src/app');
    expect(readdirSync(app).sort()).toEqual(['grid', 'measure', 'resources', 'statblocks', 'types'].sort());
  });
});
