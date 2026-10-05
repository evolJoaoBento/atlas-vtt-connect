import { describe, expect, it } from 'vitest';
import { loadDiceDisplay, saveDiceDisplay } from '../../../src/app/online/page/diceDisplayStore';
import { loadLaserColor } from '../../../src/app/online/page/laserColorStore';
import { pageKey, readKept } from '../../../src/app/online/page/pageStorage';

function memory(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    get length() { return data.size; },
  } as unknown as Storage;
}

describe('what the join page keeps in the browser', () => {
  it('uses atlas-vtt-connect keys', () => {
    const storage = memory();
    saveDiceDisplay('fast', () => storage);
    expect(storage.getItem('atlas-vtt-connect:dice-display')).toBe('fast');
    expect(pageKey('name')).toBe('atlas-vtt-connect:name');
  });

  it("reads the fork's old key once and copies it to the new one, which then wins", () => {
    const storage = memory({ 'atlas-online:dice-display': 'card', 'atlas-online:laser-color': '#00a9ff' });
    expect(loadDiceDisplay(() => storage)).toBe('card');
    expect(storage.getItem('atlas-vtt-connect:dice-display')).toBe('card');
    expect(loadLaserColor(() => storage)).toBe('#00a9ff');
    saveDiceDisplay('full', () => storage);
    expect(loadDiceDisplay(() => storage)).toBe('full');
    expect(readKept(storage, 'nothing')).toBeNull();
  });

  it('still answers when the copy cannot be written', () => {
    const storage = memory({ 'atlas-online:name': 'Rin' });
    storage.setItem = () => { throw new Error('full'); };
    expect(readKept(storage, 'name')).toBe('Rin');
  });
});
