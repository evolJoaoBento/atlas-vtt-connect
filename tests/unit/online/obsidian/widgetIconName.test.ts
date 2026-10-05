import { describe, expect, it } from 'vitest';
import { atlasWidgets, widgetIconName } from '../../../../src/app/online/obsidian/convertPanels';

describe('received widget icon names', () => {
  it('map the legacy names as Atlas does and pass every other name through for Atlas to resolve when it draws', () => {
    expect(['timer', 'book', 'hand'].map(widgetIconName)).toEqual(['hourglass', 'spellbook', 'strength']);
    expect(widgetIconName('skull')).toBe('skull');
    expect(widgetIconName('no-such-icon')).toBe('no-such-icon');
    expect(widgetIconName('__proto__')).toBe('__proto__');
    const { widgetSettings } = atlasWidgets([{ id: 'w', type: 'counter', label: 'Doom', icon: 'book', value: 2 } as never]);
    expect(widgetSettings.widgets.w?.icon).toBe('spellbook');
  });
});
