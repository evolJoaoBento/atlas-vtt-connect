import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const PROBE = path.resolve(ROOT, 'tests/unit/online/__coverage_probe__.ts');
const PROBE_SOURCE = [
  "import { OBJECT_COVERAGE, TEXT_FIELD_COVERAGE, TOKEN_FIELD_COVERAGE, type Coverage, type KeysOfUnion } from './coverage';",
  "import type { Character, SceneSnapshot, TextElement, Token } from '@atlas-vtt/api-types';",
  "", // keeps the probe's line numbers
  'export const complete: Record<keyof TextElement, Coverage> = TEXT_FIELD_COVERAGE;',
  'type GlowingText = TextElement & { glow: string };',
  'export const newField: Record<keyof GlowingText, Coverage> = TEXT_FIELD_COVERAGE;',
  "type MoreObjects = SceneSnapshot['objects'] & { portals: Record<string, unknown> };",
  'export const newKind: Record<keyof MoreObjects, Coverage> = OBJECT_COVERAGE;',
  'type AuraToken = Token | (Character & { aura: string });',
  'export const newCharacterField: Record<KeysOfUnion<AuraToken>, Coverage> = TOKEN_FIELD_COVERAGE;',
].join('\n');

interface Finding { line: number; code: number; message: string }

/** Type-checks the probe with the repository's compiler options; returns the probe's own diagnostics. */
function probeDiagnostics(): Finding[] {
  const config = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const host = ts.createCompilerHost(options, true);
  const isProbe = (fileName: string): boolean => path.resolve(fileName) === PROBE;
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (fileName) => isProbe(fileName) || fileExists(fileName);
  host.readFile = (fileName) => (isProbe(fileName) ? PROBE_SOURCE : readFile(fileName));
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => (isProbe(fileName)
    ? ts.createSourceFile(fileName, PROBE_SOURCE, languageVersion, true)
    : getSourceFile(fileName, languageVersion, onError, shouldCreate));
  const program = ts.createProgram([PROBE], { ...options, noEmit: true }, host);
  const file = program.getSourceFile(PROBE);
  if (!file) throw new Error('probe not compiled');
  return ts.getPreEmitDiagnostics(program, file).map((diagnostic) => ({
    line: file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
  }));
}

describe('coverage tables', () => {
  it('fail to compile until a new Atlas field or object kind is recorded', () => {
    const findings = probeDiagnostics();
    // Line 3 (the complete table) compiles; lines 5, 7 and 9 each miss exactly the new key.
    expect(findings.map(({ line, code }) => ({ line, code }))).toEqual([{ line: 5, code: 2741 }, { line: 7, code: 2741 }, { line: 9, code: 2741 }]);
    expect(findings[0]?.message).toContain("'glow'");
    expect(findings[1]?.message).toContain("'portals'");
    expect(findings[2]?.message).toContain("'aura'");
  }, 120_000);
});
