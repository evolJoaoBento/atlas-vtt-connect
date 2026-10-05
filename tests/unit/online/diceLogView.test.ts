import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceLogView } from '../../../online-client/diceLogView.mts';
import type { DiceLogEntry } from '../../../src/app/online/tools/toolMessages';

const views: DiceLogView[] = [];

function setup() {
  document.body.innerHTML = [
    '<button id="dice-log-button" aria-expanded="false"></button>',
    '<aside id="dice-log" hidden><button id="dice-log-close"></button>',
    '<p id="dice-log-empty">No rolls yet</p><ol id="dice-log-list"></ol></aside>',
    '<button id="dice-toast" hidden></button>',
  ].join('');
  const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const view = new DiceLogView({
    panel: element('dice-log'), list: element('dice-log-list'), empty: element('dice-log-empty'),
    closeButton: element('dice-log-close'), toggleButton: element('dice-log-button'), toast: element('dice-toast'),
  });
  views.push(view);
  return { view, element };
}
const entry = (id: string, name = 'Anna'): DiceLogEntry => ({
  id, name, formula: '2d6+1', dice: [{ die: 'd6', value: 6 }, { die: 'd6', value: 1 }], modifier: 1, total: 8, at: 0,
});

describe('the join page dice log', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    // Views listen on the document: a view left open would take the next test's Escape.
    for (const view of views.splice(0)) view.dispose();
  });

  it('lists rolls newest first as text, never as markup', () => {
    const { view, element } = setup();
    expect(element('dice-log-empty').hidden).toBe(false);
    view.receive([entry('b', '<img src=x onerror=alert(1)>'), entry('a')], true);
    const items = element('dice-log-list').querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector('.dice-entry-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(element('dice-log-list').querySelector('img')).toBeNull();
    expect(items[1]?.querySelector('.dice-entry-total')?.textContent).toBe('8');
    expect([...items[1]!.querySelectorAll('.die-badge')].map((badge) => [badge.textContent, badge.className])).toEqual([
      ['d6: 6', 'die-badge is-max'], ['d6: 1', 'die-badge is-min'],
    ]);
    expect(element('dice-log-empty').hidden).toBe(true);
  });

  it("writes exploded and subtracted dice as Atlas's log does, marks a crit, and counts unlisted dice", () => {
    const { view, element } = setup();
    view.receive([{
      ...entry('a'), formula: '1d10', crit: 'low', unlisted: 2,
      dice: [{ die: 'd10', value: 1 }, { die: 'd10', value: 7, exploded: true, negative: true }],
    }], true);
    const item = element('dice-log-list').querySelector('li')!;
    expect(item.className).toBe('dice-entry is-crit-fail');
    expect([...item.querySelectorAll('.die-badge')].map((badge) => badge.textContent)).toEqual(['d10: 1!', '−d10: 7', '+2 more']);
  });

  it('throws its own new roll instead of toasting it, and toasts it when it could not be thrown', () => {
    document.body.innerHTML = '';
    const { element } = setup();
    const thrown: string[] = [];
    const view = new DiceLogView({
      panel: element('dice-log'), list: element('dice-log-list'), empty: element('dice-log-empty'),
      closeButton: element('dice-log-close'), toggleButton: element('dice-log-button'), toast: element('dice-toast'),
      onOwnRoll: (own) => { thrown.push(own.id); return true; },
    });
    views.push(view);
    view.receive([{ ...entry('a'), mine: true }], false);
    expect(thrown).toEqual(['a']);
    expect(element('dice-toast').hidden).toBe(true);
    view.log.toastRoll(entry('a'));
    expect(element('dice-toast').hidden).toBe(false);
  });

  it('toasts a new roll while closed, and opens the log from the toast', () => {
    const { view, element } = setup();
    view.receive([], true);
    view.receive([entry('a')], false);
    expect(element('dice-toast').hidden).toBe(false);
    expect(element('dice-toast').textContent).toContain('Anna');
    element('dice-toast').click();
    expect(element('dice-log').hidden).toBe(false);
    expect(element('dice-toast').hidden).toBe(true);
    expect(element('dice-log-button').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens from the Dice log button and closes with its close button or Escape', () => {
    const { element } = setup();
    element('dice-log-button').click();
    expect(element('dice-log').hidden).toBe(false);
    element('dice-log-close').click();
    expect(element('dice-log').hidden).toBe(true);
    element('dice-log-button').click();
    const heard: string[] = [];
    document.addEventListener('keydown', () => heard.push('page'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(element('dice-log').hidden).toBe(true);
    expect(heard).toEqual([]);
  });
});
