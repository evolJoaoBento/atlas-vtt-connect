import type { DiceRollResult } from '@atlas-vtt/shared/rules';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiceLogView } from '../../../online-client/diceLogView.mts';
import { cleanDieTagName, dieTagOf, dieTagText, isDieColour } from '../../../src/app/online/tools/diceTags';
import { fitDiceLog } from '../../../src/app/online/tools/DiceHost';
import { diceLogResult } from '../../../src/app/online/obsidian/onlineDice';
import { decodeControl, encodeControl, MAX_CONTROL_MESSAGE_BYTES } from '../../../src/app/online/protocol';
import { diceLogEntry, type DiceLogEntry } from '../../../src/app/online/tools/toolMessages';
import { toolsWorld } from './toolsFixtures';

const tagged = (overrides: Partial<DiceRollResult['rolls'][number]> = {}): DiceRollResult => ({
  id: 'roll_1', timestamp: 5, formula: '2d6', modifiers: 0, total: 9, crit: null,
  rolls: [{ die: 'd6', value: 4, max: 6, color: '#ff6a00', colorName: 'Fire', ...overrides }, { die: 'd6', value: 5, max: 6 }],
});
const entry = (dice: DiceLogEntry['dice'], id = 'r1'): DiceLogEntry => ({ id, name: 'Anna', formula: '2d6', dice, modifier: 0, total: 9, at: 0 });
const logMessage = (entries: unknown[]): string => JSON.stringify({ v: 1, type: 'dice-log', entries, replay: false });

describe('die tags as Atlas validates them', () => {
  it('takes #rrggbb colours only', () => {
    expect(['#ff6a00', '#FF6A00', '#000000'].every(isDieColour)).toBe(true);
    expect(['red', '#fff', '#ff6a0', '#ff6a000', 'ff6a00', '#gggggg', 7, null].some(isDieColour)).toBe(false);
  });

  it('takes plain names of 1 to 32 code points, trimmed, in any script', () => {
    expect(cleanDieTagName('  Fire ')).toBe('Fire');
    expect(cleanDieTagName('Light Green')).toBe('Light Green');
    expect(cleanDieTagName('Feu — “doré” 🔥')).toBe('Feu — “doré” 🔥');
    expect(cleanDieTagName('火')).toBe('火');
    expect(cleanDieTagName('x'.repeat(32))).toBe('x'.repeat(32));
    expect(cleanDieTagName('🔥'.repeat(32))).toBe('🔥'.repeat(32));
    for (const bad of ['', '   ', 'x'.repeat(33), '🔥'.repeat(33), '<b>', 'a>b', '[link]', '`code`', 'a\nb', 'a\tb', 'a‮b', 'a​b', 4, undefined]) {
      expect(cleanDieTagName(bad)).toBeUndefined();
    }
  });

  it('keeps what is well-formed of a tag and drops the rest', () => {
    expect(dieTagOf({ color: '#ff6a00', colorName: 'Fire' })).toEqual({ color: '#ff6a00', colorName: 'Fire' });
    expect(dieTagOf({ color: 'red', colorName: 'Fire' })).toEqual({ colorName: 'Fire' });
    expect(dieTagOf({ color: '#ff6a00', colorName: '<b>' })).toEqual({ color: '#ff6a00' });
    expect(dieTagOf({})).toEqual({});
    expect(dieTagText({ color: '#ff6a00', colorName: 'Fire' })).toBe('Fire');
    expect(dieTagText({ color: '#ff6a00' })).toBe('#ff6a00');
    expect(dieTagText({})).toBeNull();
  });
});

describe('tagged dice on the wire', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('carries the tags of a roll into its log entry, and writes an untagged die exactly as before', () => {
    const logged = diceLogEntry(tagged(), 'GM');
    expect(logged?.dice).toEqual([{ die: 'd6', value: 4, color: '#ff6a00', colorName: 'Fire' }, { die: 'd6', value: 5 }]);
    const plain = tagged();
    delete plain.rolls[0]!.color;
    delete plain.rolls[0]!.colorName;
    expect(JSON.stringify(diceLogEntry(plain, 'GM')?.dice)).toBe('[{"die":"d6","value":4},{"die":"d6","value":5}]');
  });

  it('drops a bad tag at the source and keeps the roll', () => {
    const logged = diceLogEntry(tagged({ color: 'red', colorName: '<script>' }), 'GM');
    expect(logged?.dice[0]).toEqual({ die: 'd6', value: 4 });
    expect(logged?.total).toBe(9);
  });

  it('round-trips tags, and a page drops a bad tag from a message without refusing the roll', () => {
    const good = entry([{ die: 'd6', value: 4, color: '#ff6a00', colorName: 'Fire' }]);
    expect(decodeControl(encodeControl({ v: 1, type: 'dice-log', entries: [good], replay: false }))).toEqual({
      kind: 'message', message: { v: 1, type: 'dice-log', entries: [good], replay: false },
    });
    const decoded = decodeControl(logMessage([{ ...good, dice: [
      { die: 'd6', value: 4, color: 'red', colorName: 'Fire' },
      { die: 'd6', value: 2, color: '#00ff00', colorName: 12 },
      { die: 'd6', value: 3, color: ['#ff0000'], colorName: '<b>x</b>', negative: true },
    ] }]));
    expect(decoded.kind).toBe('message');
    const dice = decoded.kind === 'message' && decoded.message.type === 'dice-log' ? decoded.message.entries[0]?.dice : null;
    expect(dice).toEqual([{ die: 'd6', value: 4, colorName: 'Fire' }, { die: 'd6', value: 2, color: '#00ff00' }, { die: 'd6', value: 3, negative: true }]);
  });

  it('still refuses a die that is bad in its own fields', () => {
    expect(decodeControl(logMessage([entry([{ die: 'd6', value: 9, color: '#ff6a00' }])])).kind).toBe('invalid');
  });

  it('gives the remote view the tags, through setDiceLog and for the roll it throws', () => {
    const logged = diceLogEntry(tagged(), 'GM')!;
    expect(diceLogResult(logged).rolls).toEqual([
      { die: 'd6', value: 4, max: 6, color: '#ff6a00', colorName: 'Fire' }, { die: 'd6', value: 5, max: 6 },
    ]);
  });

  it('sends a roll the GM logs with its tags, live and in the replay', async () => {
    const w = toolsWorld();
    w.present();
    const a = await w.join('A');
    w.publish(tagged());
    const live = w.logs(a).at(-1);
    expect(live?.entries[0]?.dice).toEqual([{ die: 'd6', value: 4, color: '#ff6a00', colorName: 'Fire' }, { die: 'd6', value: 5 }]);
    const b = await w.join('B');
    expect(w.logs(b)[0]?.entries[0]?.dice[0]).toMatchObject({ color: '#ff6a00', colorName: 'Fire' });
    w.finish();
  });

  it('keeps a replay of fully tagged logs inside one message by leaving out the oldest rolls', () => {
    const wide = (id: string): DiceLogEntry => entry(
      Array.from({ length: 100 }, () => ({ die: 'd6', value: 3, color: '#ff6a00', colorName: '🔥'.repeat(32) })), id,
    );
    const entries = Array.from({ length: 50 }, (_, i) => wide(`r${i}`));
    const fitting = fitDiceLog(entries);
    expect(fitting.length).toBeGreaterThan(0);
    expect(fitting.length).toBeLessThan(50);
    expect(fitting[0]?.id).toBe('r0');
    expect(new TextEncoder().encode(encodeControl({ v: 1, type: 'dice-log', entries: fitting, replay: true })).length).toBeLessThanOrEqual(MAX_CONTROL_MESSAGE_BYTES);
    expect(fitDiceLog(entries.slice(0, 2))).toHaveLength(2);
    expect(fitDiceLog([])).toEqual([]);
  });
});

describe('tags in the join page and Canvas tab dice log', () => {
  const views: DiceLogView[] = [];
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    vi.useRealTimers();
    for (const view of views.splice(0)) view.dispose();
  });

  function setup(): { view: DiceLogView; list: HTMLElement; toast: HTMLElement } {
    document.body.innerHTML = '<button id="b"></button><aside id="p" hidden><button id="c"></button><p id="e"></p><ol id="l"></ol></aside><button id="t" hidden></button>';
    const element = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
    const view = new DiceLogView({ panel: element('p'), list: element('l'), empty: element('e'), closeButton: element('c'), toggleButton: element('b'), toast: element('t') });
    views.push(view);
    return { view, list: element('l'), toast: element('t') };
  }

  it('writes a tagged die as "d6: 4 · ● Fire", the name as text and the dot decorative', () => {
    const { view, list } = setup();
    view.receive([entry([{ die: 'd6', value: 4, color: '#ff6a00', colorName: 'Fire' }, { die: 'd6', value: 5 }])], true);
    const [first, second] = list.querySelectorAll('.die-badge');
    expect(first?.textContent).toBe('d6: 4 · ● Fire');
    expect(first?.querySelector('.die-tag-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect((first?.querySelector('.die-tag-dot') as HTMLElement).style.getPropertyValue('--die-tag-colour')).toBe('#ff6a00');
    expect(second?.textContent).toBe('d6: 5');
    expect(second?.querySelector('.die-tag')).toBeNull();
  });

  it('shows the colour code when the tag has no name, and nothing for a tag that is not well-formed', () => {
    const { view, list } = setup();
    view.receive([entry([
      { die: 'd6', value: 4, color: '#00aaff' },
      { die: 'd6', value: 2, color: 'red', colorName: '<img src=x onerror=alert(1)>' },
      { die: 'd6', value: 3, colorName: 'Ice' },
    ])], true);
    const badges = [...list.querySelectorAll('.die-badge')];
    expect(badges.map((badge) => badge.textContent)).toEqual(['d6: 4 · ● #00aaff', 'd6: 2', 'd6: 3 · Ice']);
    expect(list.querySelector('img')).toBeNull();
    expect(badges[2]?.querySelector('.die-tag-dot')).toBeNull();
  });

  it('shows the same in the toast', () => {
    const { view, toast } = setup();
    view.receive([entry([{ die: 'd6', value: 4, color: '#ff6a00', colorName: 'Fire' }])], false);
    expect(toast.querySelector('.die-badge')?.textContent).toBe('d6: 4 · ● Fire');
  });
});
