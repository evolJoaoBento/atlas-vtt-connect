import { describe, expect, it } from 'vitest';
import { pathTaken } from '../../../../src/app/online/sharing/receive/vaultFiles';
import { createInMemoryApp } from '../../../mocks/inMemoryVault';
import { freePath, isInside, safeFileName, sharedNoteFolder } from '../../../../src/app/online/sharing/receive/safePaths';

describe('safe paths for shared items', () => {
  it('keep every title a plain file name', () => {
    expect(safeFileName('Goblin cave')).toBe('Goblin cave');
    expect(safeFileName('../../.obsidian/plugins/x')).toBe('obsidian plugins x');
    expect(safeFileName('a/b\\c:d*e?"f<g>h|i#j^k[l]')).toBe('a b c d e f g h i j k l');
    expect(safeFileName('..')).toBe('Untitled');
    expect(safeFileName('   ')).toBe('Untitled');
    expect(safeFileName('CON')).toBe('CON_');
    expect(safeFileName('lpt1')).toBe('lpt1_');
    expect(safeFileName('tab\tand\u0000nul')).toBe('tab and nul');
    expect(safeFileName('x'.repeat(300))).toHaveLength(100);
    expect(safeFileName('name. ')).toBe('name');
  });

  it('rename reserved names with any extension, and the superscript and console forms', () => {
    expect(safeFileName('CON.backup')).toBe('CON_.backup');
    expect(safeFileName('nul.txt')).toBe('nul_.txt');
    expect(safeFileName('COM¹')).toBe('COM¹_');
    expect(safeFileName('LPT³.log')).toBe('LPT³_.log');
    expect(safeFileName('CONIN$')).toBe('CONIN$_');
    expect(safeFileName('console')).toBe('console');
  });

  it('never split a grapheme when cutting, and drop invisible characters', () => {
    const cut = safeFileName(`a${'😀'.repeat(60)}`);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut).not.toMatch(/[\ud800-\udbff]$/);
    expect(safeFileName('​')).toBe('Untitled');
    expect(safeFileName('gob‮lin')).toBe('goblin');
  });

  it('put each person in their own folder under Shared', () => {
    expect(sharedNoteFolder('Ana')).toBe('Shared/Ana');
    expect(sharedNoteFolder('../Ana')).toBe('Shared/Ana');
    expect(sharedNoteFolder('')).toBe('Shared/Someone');
  });

  it('know what is inside a folder and find free names', () => {
    expect(isInside('Shared/Ana/Cave.md', 'Shared/Ana')).toBe(true);
    expect(isInside('Shared/Ana/../Ben/Cave.md', 'Shared/Ana')).toBe(false);
    expect(isInside('Shared/Anabel/Cave.md', 'Shared/Ana')).toBe(false);
    expect(isInside('Shared/Ana', 'Shared/Ana')).toBe(false);
    const taken = new Set(['Shared/Ana/Cave.md', 'Shared/Ana/Cave (2).md']);
    expect(freePath('Shared/Ana', 'Cave', 'md', (path) => taken.has(path))).toBe('Shared/Ana/Cave (3).md');
    expect(freePath('', 'Cave', 'md', () => false)).toBe('Cave.md');
  });
});

describe('a free name beside files that differ only by case', () => {
  it('also looks in the vault root (M7)', () => {
    const { app } = createInMemoryApp({ files: { 'Cave.md': 'mine', 'Notes/Inn.md': 'mine' } });
    const none = { holds: (): boolean => false };
    expect(pathTaken(app, none, 'cave.md')).toBe(true);
    expect(pathTaken(app, none, 'notes/inn.md')).toBe(false);
    expect(pathTaken(app, none, 'Notes/inn.md')).toBe(true);
    expect(pathTaken(app, none, 'Other.md')).toBe(false);
  });
});
