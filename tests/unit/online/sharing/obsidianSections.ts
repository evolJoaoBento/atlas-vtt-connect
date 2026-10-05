/**
 * Section fixtures standing in for Obsidian's parser, which tests cannot run: `metadataCache.getFileCache(file)
 * .sections` gives a note's top-level blocks as `{ type, position: { start, end } }`, each position a 0-based
 * line, a column and an offset from the start of the file, a block running from the start of its first line to
 * the end of its last. Types as Obsidian names them: yaml, paragraph, heading, list, blockquote, callout, code,
 * math, html, table, thematicBreak, footnoteDefinition.
 *
 * `sectionsOf` builds exactly the sections a test spells out (the repros: each states the blocks Obsidian
 * gives for that note). `simpleSections` approximates Obsidian for the plain notes most tests use. Tests that
 * rest on either are cases for the manual test in real Obsidian (tags-report.md).
 */
import type { NoteSection } from '../../../../src/app/online/sharing/model/noteSections';

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) starts.push(at + 1);
  return starts;
}

/** One section of `type` over lines `startLine`..`endLine` of `source`. */
export function section(source: string, type: string, startLine: number, endLine: number): NoteSection {
  const starts = lineStarts(source);
  const lines = source.split('\n');
  const endCol = (lines[endLine] ?? '').length;
  return {
    type,
    position: {
      start: { line: startLine, col: 0, offset: starts[startLine] ?? 0 },
      end: { line: endLine, col: endCol, offset: (starts[endLine] ?? 0) + endCol },
    },
  };
}

/** The sections a test spells out: `[type, startLine, endLine]` each. */
export function sectionsOf(source: string, blocks: ReadonlyArray<readonly [string, number, number]>): NoteSection[] {
  return blocks.map(([type, start, end]) => section(source, type, start, end));
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const blank = (line: string | undefined): boolean => (line ?? '').trim() === '';

/** Obsidian's sections, approximately, for plain test notes: yaml, fences, $$ math, html, headings, lists, quotes, callouts, indented code, paragraphs. */
export function simpleSections(source: string): NoteSection[] {
  const lines = source.split('\n');
  const blocks: Array<[string, number, number]> = [];
  let index = 0;
  if (lines[0]?.replace(/^﻿/, '') === '---') {
    const close = lines.findIndex((line, at) => at > 0 && line === '---');
    if (close > 0) {
      blocks.push(['yaml', 0, close]);
      index = close + 1;
    }
  }
  let afterBlank = true;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (blank(line)) { index++; afterBlank = true; continue; }
    const start = index;
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1] ?? '```';
      index++;
      while (index < lines.length && !new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`).test(lines[index] ?? '')) index++;
      blocks.push(['code', start, Math.min(index, lines.length - 1)]);
      index++;
    } else if (/^\$\$/.test(line.trim())) {
      index++;
      while (index < lines.length && !/^\$\$/.test((lines[index] ?? '').trim())) index++;
      blocks.push(['math', start, Math.min(index, lines.length - 1)]);
      index++;
    } else if (/^ {0,3}<[A-Za-z!/]/.test(line)) {
      while (index + 1 < lines.length && !blank(lines[index + 1])) index++;
      blocks.push(['html', start, index]);
      index++;
    } else if (afterBlank && /^( {4}|\t)/.test(line)) {
      while (index + 1 < lines.length && (blank(lines[index + 1]) || /^( {4}|\t)/.test(lines[index + 1] ?? ''))) index++;
      while (blank(lines[index])) index--;
      blocks.push(['code', start, index]);
      index++;
    } else if (/^ {0,3}#{1,6}(\s|$)/.test(line)) {
      blocks.push(['heading', start, start]);
      index++;
    } else if (LIST.test(line)) {
      for (;;) {
        const next = lines[index + 1];
        if (next === undefined) break;
        if (!blank(next)) { index++; continue; }
        const after = lines.slice(index + 1).find((candidate) => !blank(candidate));
        if (after !== undefined && (LIST.test(after) || /^[ \t]/.test(after))) { index++; continue; }
        break;
      }
      while (blank(lines[index])) index--;
      blocks.push(['list', start, index]);
      index++;
    } else if (/^ {0,3}>/.test(line)) {
      while (index + 1 < lines.length && !blank(lines[index + 1])) index++;
      blocks.push([/^ {0,3}>\s*\[!/.test(line) ? 'callout' : 'blockquote', start, index]);
      index++;
    } else {
      // A fence, heading, quote or bullet item interrupts a paragraph.
      const interrupts = (next: string): boolean => FENCE.test(next) || /^ {0,3}(?:#{1,6}\s|>|[-*+][ \t])/.test(next);
      while (index + 1 < lines.length && !blank(lines[index + 1]) && !interrupts(lines[index + 1] ?? '')) index++;
      blocks.push(['paragraph', start, index]);
      index++;
    }
    afterBlank = false;
  }
  return sectionsOf(source, blocks);
}
