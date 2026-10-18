import { afterEach, describe, expect, it, vi } from 'vitest';
import { MapView, NOTE_WAIT_MS } from '../../../online-client/mapView.mts';
import { renderNoteMarkdown } from '../../../online-client/noteMarkdown.mts';
import { NOTE_CUT_TEXT, NOTE_UNAVAILABLE_TEXT } from '../../../online-client/noteView.mts';
import { fakeFrames, RecordingSurface } from './recordingSurface';
import { playerScene } from './sceneFixtures';

function rendered(markdown: string): HTMLElement {
  const into = document.createElement('div');
  renderNoteMarkdown(markdown, into);
  return into;
}

describe("a pin's note as the player reads it", () => {
  it('never reads anything in it as HTML', () => {
    const into = rendered('<script>alert(1)</script>\n<img src=x onerror="alert(2)">\n**<b>bold</b>**\n[click](javascript:alert(3))');
    expect(into.querySelector('script, img, b, a, iframe')).toBeNull();
    expect(into.textContent).toContain('<script>alert(1)</script>');
    expect(into.innerHTML).not.toContain('javascript:');
  });

  it('draws headings, paragraphs, lists, tasks, quotes, callouts, code, rules and tables', () => {
    const into = rendered([
      '# Cellar', '', 'Cold and **dark**, with *mould* and ~~rats~~ ==moss==.', 'Second line with `code`.', '',
      '- one', '- [x] done', '1. first', '', '> [!warning] Careful', '> The floor creaks.', '', '---', '',
      '```', 'raw *text*', '```', '', '| Item | Cost |', '| --- | --- |', '| Rope | 1 gp |',
    ].join('\n'));
    expect(into.querySelector('h3')?.textContent).toBe('Cellar');
    const paragraph = into.querySelector('p')!;
    expect(paragraph.querySelector('strong')?.textContent).toBe('dark');
    expect(paragraph.querySelector('em')?.textContent).toBe('mould');
    expect(paragraph.querySelector('del')?.textContent).toBe('rats');
    expect(paragraph.querySelector('mark')?.textContent).toBe('moss');
    expect(paragraph.querySelector('br')).not.toBeNull();
    expect(paragraph.querySelector('code')?.textContent).toBe('code');
    expect([...into.querySelectorAll('ul li')].map((li) => li.textContent)).toEqual(['one', '☑ done']);
    expect(into.querySelector('ol li')?.textContent).toBe('first');
    const callout = into.querySelector<HTMLElement>('blockquote.note-callout')!;
    expect(callout.dataset.callout).toBe('warning');
    expect(callout.querySelector('.note-callout-title')?.textContent).toBe('Careful');
    expect(callout.textContent).toContain('The floor creaks.');
    expect(into.querySelector('hr')).not.toBeNull();
    expect(into.querySelector('pre code')?.textContent).toBe('raw *text*');
    expect([...into.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['Rope', '1 gp']);
  });

  it('keeps only the text of links: an alias, else the note and its heading', () => {
    const into = rendered('See [[People/Guard|the guard]], [[Tavern#Cellar]] and [the map](https://x.test).');
    expect(into.textContent).toBe('See the guard, Tavern › Cellar and the map.');
    expect(into.querySelector('a')).toBeNull();
  });
});

const views: MapView[] = [];

function setup(answer = vi.fn(() => true)) {
  document.body.innerHTML = [
    '<section><canvas id="map"></canvas>',
    '<div id="view-buttons" hidden><button id="follow-gm" type="button"></button><button id="fit-map" type="button"></button></div>',
    '<p id="move-notice" hidden></p>',
    '<aside id="note-panel" hidden><h2 id="note-title"></h2><button id="note-close" type="button"></button><div id="note-body"></div></aside>',
    '</section>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const canvas = element<HTMLCanvasElement>('map');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}) });
  const view = new MapView({
    canvas, surface: new RecordingSurface(), images: () => null, frames: fakeFrames(), isHidden: () => false,
    viewButtons: element('view-buttons'), followButton: element('follow-gm'), fitButton: element('fit-map'),
    sendMove: () => true, sendLaser: () => true, notice: element('move-notice'),
    note: { panel: element('note-panel'), title: element('note-title'), body: element('note-body'), closeButton: element('note-close') },
    requestNote: answer,
  });
  views.push(view);
  // A pin at world (500, 400): the middle of `playerScene`'s map, the middle of the canvas.
  view.setScene({ ...playerScene({ tokens: {} }), pins: [{ id: 'pin-0', x: 500, y: 400, label: null, title: 'Cellar' }] });
  const click = (x: number, y: number): void => {
    for (const type of ['pointerdown', 'click']) canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
  };
  return { view, click, panel: element('note-panel'), title: element('note-title'), body: element('note-body'), answer };
}

describe('opening a readable pin', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const view of views.splice(0)) view.dispose();
  });

  it('asks the GM for its note on a click with Move, shows it loading, then shows the note', () => {
    const t = setup();
    t.click(400, 300);
    expect(t.answer).toHaveBeenCalledWith('pin-0');
    expect(t.panel.hidden).toBe(false);
    expect(t.title.textContent).toBe('Cellar');
    expect(t.body.textContent).toBe('Loading…');
    // An answer for another pin, or another scene, is not this one's.
    t.view.receiveNote({ sceneId: 'elsewhere', pinId: 'pin-0', note: { title: 'No', body: 'no' } });
    expect(t.body.textContent).toBe('Loading…');
    t.view.receiveNote({ sceneId: playerScene().sceneId, pinId: 'pin-0', note: { title: 'The Cellar', body: 'Cold.', cut: true } });
    expect(t.title.textContent).toBe('The Cellar');
    expect(t.body.textContent).toBe(`Cold.${NOTE_CUT_TEXT}`);
  });

  it('says the note could not be opened when the GM answers none, or never answers', () => {
    vi.useFakeTimers();
    const t = setup();
    t.click(400, 300);
    t.view.receiveNote({ sceneId: playerScene().sceneId, pinId: 'pin-0', note: null });
    expect(t.body.textContent).toBe(NOTE_UNAVAILABLE_TEXT);
    t.click(400, 300);
    vi.advanceTimersByTime(NOTE_WAIT_MS);
    expect(t.body.textContent).toBe(NOTE_UNAVAILABLE_TEXT);
  });

  it('opens nothing beside a pin, or when the request cannot go, and closes with Escape', () => {
    const t = setup(vi.fn(() => false));
    t.click(400, 300);
    expect(t.panel.hidden).toBe(true);
    const sent = setup();
    sent.click(50, 50);
    expect(sent.answer).not.toHaveBeenCalled();
    sent.click(400, 300);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(sent.panel.hidden).toBe(true);
  });
});
