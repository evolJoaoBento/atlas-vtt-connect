/**
 * Share tags in the editor (Live Preview and Source mode): each start tag shows as a label, the text it covers
 * is highlighted, end tags are not shown, and a line holding only end tags folds away. A tag the cursor or a
 * selection touches is shown as written so it can be edited (a click on a label puts the cursor there).
 *
 * A state field, not a view plugin: folding an end tag's line replaces a line break, which CodeMirror only
 * takes from a state field. The whole note is scanned (a part opened above the viewport colours what is
 * visible, so pairing needs the whole note, as the filter does): at once after an edit of a note up to
 * `LARGE_NOTE` long; in a longer one the ranges follow the edit and the scan waits until typing pauses.
 * A selection change only rebuilds the decorations, whose number follows the number of tags.
 */
import { StateEffect, StateField, type ChangeDesc, type EditorState, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type PluginValue, type ViewUpdate } from '@codemirror/view';
import type { BlockContext } from '../model/codeContext';
import { revealedAt, tagDisplayOf, type DisplayRange, type TagDisplay, type TagTone } from './tagDisplay';
import { highlightClass, tagLabelElement } from './tagElements';

/** Asks the editors to read the note's block context again (its sections changed). */
export const refreshShareTags = StateEffect.define<null>();

class TagLabelWidget extends WidgetType {
  constructor(readonly text: string, readonly tone: TagTone) {
    super();
  }

  eq(other: TagLabelWidget): boolean {
    return other.text === this.text && other.tone === this.tone;
  }

  toDOM(): HTMLElement {
    return tagLabelElement(this.text, this.tone);
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/** Notes longer than this are scanned once typing pauses (`RESCAN_DELAY` ms), not on every keystroke. */
export const LARGE_NOTE = 100_000;
const RESCAN_DELAY = 400;

/**
 * Hidden end tags as replacements: a line holding nothing else (and no cursor) folds away with the line break
 * before it, so the next line keeps its start (where list, quote and heading styling sit).
 */
function hiddenRanges(doc: Text, all: readonly DisplayRange[], shown: readonly DisplayRange[], selections: readonly DisplayRange[]): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = [];
  const byLine = new Map<number, DisplayRange[]>();
  for (const range of all) {
    const line = doc.lineAt(range.from).number;
    byLine.set(line, [...(byLine.get(line) ?? []), range]);
  }
  for (const [number, ranges] of byLine) {
    const line = doc.line(number);
    let rest = line.text;
    for (const range of [...ranges].reverse()) rest = rest.slice(0, range.from - line.from) + rest.slice(range.to - line.from);
    const cursorOnLine = selections.some((selection) => selection.from <= line.to && selection.to >= line.from);
    if (rest.trim() === '' && !cursorOnLine && doc.lines > 1) {
      out.push(number > 1 ? Decoration.replace({}).range(line.from - 1, line.to) : Decoration.replace({}).range(line.from, line.to + 1));
      continue;
    }
    for (const range of ranges) if (shown.includes(range)) out.push(Decoration.replace({}).range(range.from, range.to));
  }
  return out;
}

/** The decorations for `display` with the current selection. */
export function shareTagDecorations(state: EditorState, display: TagDisplay): DecorationSet {
  const selections = state.selection.ranges.map(({ from, to }) => ({ from, to }));
  const shown = revealedAt(display, selections);
  const ranges: Array<Range<Decoration>> = [
    ...display.highlights.map((range) => Decoration.mark({ class: highlightClass(range.tone, range.depth) }).range(range.from, range.to)),
    ...shown.labels.map((label) => Decoration.replace({ widget: new TagLabelWidget(label.text, label.tone) }).range(label.from, label.to)),
    ...hiddenRanges(state.doc, display.hidden, shown.hidden, selections),
  ];
  return Decoration.set(ranges, true);
}

interface ShareTagState {
  display: TagDisplay;
  decorations: DecorationSet;
  /** The display was moved through edits, not scanned: a scan is due. */
  stale: boolean;
}

/** `display` moved through `changes`; ranges an edit removed are dropped. */
export function mappedDisplay(display: TagDisplay, changes: ChangeDesc): TagDisplay {
  const map = <T extends DisplayRange>(range: T): T => ({ ...range, from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) });
  return {
    labels: display.labels.map(map).filter((range) => range.to > range.from),
    highlights: display.highlights.map(map).filter((range) => range.to >= range.from),
    hidden: display.hidden.map(map).filter((range) => range.to > range.from),
  };
}

/** The editor extension; `blocksFor` gives the note's block context (Obsidian's sections, else inline only). */
export function shareTagEditorExtension(blocksFor: (state: EditorState) => BlockContext): Extension {
  const compute = (state: EditorState): ShareTagState => {
    const text = state.doc.toString();
    // The block context costs a pass over the note: only read it when there may be tags.
    const display = tagDisplayOf(text, text.includes('%%') ? blocksFor(state) : 'inline-only');
    return { display, decorations: shareTagDecorations(state, display), stale: false };
  };
  const field = StateField.define<ShareTagState>({
    create: compute,
    update(value, tr) {
      if (tr.effects.some((effect) => effect.is(refreshShareTags))) return compute(tr.state);
      if (tr.docChanged && tr.state.doc.length <= LARGE_NOTE) return compute(tr.state);
      if (tr.docChanged) {
        const display = mappedDisplay(value.display, tr.changes);
        return { display, decorations: shareTagDecorations(tr.state, display), stale: true };
      }
      if (tr.selection) return { ...value, decorations: shareTagDecorations(tr.state, value.display) };
      return value;
    },
    provide: (decorations) => EditorView.decorations.from(decorations, (value) => value.decorations),
  });
  return [field, ViewPlugin.define((view) => new Rescan(view, field))];
}

/** Scans a long note again once its edits pause. */
class Rescan implements PluginValue {
  private timer: number | null = null;

  constructor(private readonly view: EditorView, private readonly field: StateField<ShareTagState>) {}

  update(update: ViewUpdate): void {
    if (!update.docChanged || !update.state.field(this.field).stale) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.view.state.field(this.field).stale) this.view.dispatch({ effects: refreshShareTags.of(null) });
    }, RESCAN_DELAY);
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }
}
