/**
 * A note's text with its share tags shown as labels and highlights (the Share with… preview), from the same
 * display ranges as the editor. End tags are not shown; a line holding only end tags is left out.
 */
import React, { useMemo } from 'react';
import { tagDisplayOf, type DisplayRange, type TagDisplay, type TagTone } from './tagDisplay';
import { highlightClass, labelClass } from './tagElements';

export type TaggedPiece =
  | { kind: 'text'; text: string; highlights: Array<{ tone: TagTone; depth: number }> }
  | { kind: 'label'; text: string; tone: TagTone };

/** Hidden ranges; the last on a line that holds nothing else is widened over the line break. */
function foldedHidden(text: string, hidden: readonly DisplayRange[]): DisplayRange[] {
  return hidden.map((range, index) => {
    const newline = text.indexOf('\n', range.to);
    const next = hidden[index + 1];
    if (newline < 0 || (next && next.from < newline)) return range;
    const lineStart = text.lastIndexOf('\n', range.from - 1) + 1;
    const onLine = hidden.filter((other) => other.from >= lineStart && other.to <= newline);
    let rest = text.slice(lineStart, newline);
    for (const other of [...onLine].reverse()) rest = rest.slice(0, other.from - lineStart) + rest.slice(other.to - lineStart);
    return rest.trim() === '' ? { from: range.from, to: newline + 1 } : range;
  });
}

/** `text` cut into plain stretches (with the highlights over them, outermost first) and labels. */
export function taggedPieces(text: string, display: TagDisplay): TaggedPiece[] {
  const hidden = foldedHidden(text, display.hidden);
  const cuts = new Set([0, text.length]);
  for (const range of [...display.labels, ...display.highlights, ...hidden]) {
    cuts.add(range.from);
    cuts.add(range.to);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const pieces: TaggedPiece[] = [];
  for (let index = 0; index + 1 < points.length; index++) {
    const from = points[index] ?? 0;
    const to = points[index + 1] ?? 0;
    const label = display.labels.find((candidate) => candidate.from <= from && to <= candidate.to);
    if (label) {
      if (label.from === from) pieces.push({ kind: 'label', text: label.text, tone: label.tone });
      continue;
    }
    if (hidden.some((range) => range.from <= from && to <= range.to)) continue;
    const highlights = display.highlights.filter((range) => range.from <= from && to <= range.to)
      .sort((a, b) => a.depth - b.depth).map(({ tone, depth }) => ({ tone, depth }));
    pieces.push({ kind: 'text', text: text.slice(from, to), highlights });
  }
  return pieces;
}

function renderText(piece: Extract<TaggedPiece, { kind: 'text' }>, key: number): React.ReactNode {
  const content = piece.highlights.reduceRight<React.ReactNode>(
    (inner, highlight) => <span className={highlightClass(highlight.tone, highlight.depth)}>{inner}</span>,
    piece.text,
  );
  return <React.Fragment key={key}>{content}</React.Fragment>;
}

/** The text with labels and highlights. */
export function TaggedText({ text }: { text: string }): React.ReactElement {
  const pieces = useMemo(() => taggedPieces(text, tagDisplayOf(text, 'inline-only')), [text]);
  return (
    <>
      {pieces.map((piece, index) => (piece.kind === 'label'
        ? <span key={index} className={labelClass(piece.tone)}>{piece.text}</span>
        : renderText(piece, index)))}
    </>
  );
}
