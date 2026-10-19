import { describe, expect, it, vi } from 'vitest';
import { scopeSelector, StatblockCards } from '../../../src/connect/statblockCards';
import type { SheetCard } from '../../../src/app/online/tools/sheetCards';

const card = (name: string): SheetCard => ({ html: name, css: '', rootClasses: '', bodyClasses: '', rolls: [] });

describe("drawing Atlas's cards for players", () => {
  it("names the wrappers that stand in for the GM's html and body", () => {
    expect(scopeSelector('body.theme-dark .atlas-sb-label')).toBe(':where([data-connect-body]).theme-dark .atlas-sb-label');
    expect(scopeSelector(':root')).toBe(':where([data-connect-html])');
    expect(scopeSelector('html body > .x, .tbody .bodyless')).toBe(':where([data-connect-html]) :where([data-connect-body]) > .x, .tbody .bodyless');
  });

  it('draws each note once, one at a time, and again when a change is heard while drawing', async () => {
    let finish: (() => void) | null = null;
    const draw = vi.fn((path: string) => new Promise<SheetCard | null>((resolve) => { finish = () => resolve(card(path)); }));
    const drawn = vi.fn();
    const cards = new StatblockCards(draw, drawn);
    expect(cards.get('A.md')).toBeUndefined();
    expect(cards.get('A.md')).toBeUndefined();
    expect(cards.get('B.md')).toBeUndefined();
    expect(draw).toHaveBeenCalledTimes(1);
    cards.forget('A.md');
    finish!();
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(2));
    // B is drawn, then A again: the change came while A was drawn.
    expect(draw.mock.calls.map(([path]) => path)).toEqual(['A.md', 'B.md']);
    finish!();
    await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(3));
    finish!();
    await vi.waitFor(() => expect(drawn).toHaveBeenCalledTimes(1));
    expect(cards.get('A.md')).toEqual(card('A.md'));
    expect(cards.get('B.md')).toEqual(card('B.md'));
    expect(draw).toHaveBeenCalledTimes(3);
  });

  it('keeps giving a card out of date until its new drawing is ready', async () => {
    let version = 1;
    const draw = vi.fn(async (path: string) => card(`${path} v${version}`));
    const cards = new StatblockCards(draw, () => undefined);
    cards.get('A.md');
    await vi.waitFor(() => expect(cards.get('A.md')).toEqual(card('A.md v1')));
    version = 2;
    cards.forget();
    expect(cards.get('A.md')).toEqual(card('A.md v1'));
    await vi.waitFor(() => expect(cards.get('A.md')).toEqual(card('A.md v2')));
    expect(draw).toHaveBeenCalledTimes(2);
  });
});

