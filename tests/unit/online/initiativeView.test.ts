import { describe, expect, it } from 'vitest';
import { InitiativeView } from '../../../online-client/initiativeView.mts';
import type { PlayerInitiative, PlayerInitiativeEntry } from '../../../src/app/online/scene/sceneTypes';
import { playerScene, playerToken } from './sceneFixtures';

const entry = (tokenId: string, patch: Partial<PlayerInitiativeEntry> = {}): PlayerInitiativeEntry => ({
  id: tokenId, tokenId, initiative: 10, name: tokenId, hp: null, isActive: false, ...patch,
});

function setup(onFind?: (tokenId: string) => void) {
  const panel = document.createElement('div');
  document.body.replaceChildren(panel);
  const view = new InitiativeView({ panel, images: () => null, ...(onFind ? { onFind } : {}) });
  const show = (initiative: PlayerInitiative | null): void => {
    view.update(playerScene({ initiative, tokens: { orc: playerToken({ side: 'opponents' }), ana: playerToken({ side: 'players' }) } }));
  };
  return { panel, show };
}

describe("the initiative column, as Atlas's player window shows it", () => {
  it('hides without a fight to show', () => {
    const { panel, show } = setup();
    show(null);
    expect(panel.hidden).toBe(true);
    show({ round: 0, active: false, entries: [] });
    expect(panel.hidden).toBe(true);
  });

  it('lists a card per combatant in turn order, the turn in the accent, the round under them', () => {
    const { panel, show } = setup();
    show({ round: 3, active: true, entries: [entry('ana', { initiative: 18, isActive: true, hpShare: 0.5 }), entry('orc', { initiative: 12, name: null, sitsOut: true })] });
    expect(panel.hidden).toBe(false);
    const cards = [...panel.querySelectorAll('.initiative-card')];
    expect(cards.map((card) => card.querySelector('.initiative-value')?.textContent)).toEqual(['18', '12']);
    expect(cards[0]!.classList.contains('is-active')).toBe(true);
    expect(cards[0]!.getAttribute('aria-current')).toBe('true');
    expect(cards[0]!.querySelector('.initiative-name')?.textContent).toBe('ana');
    expect((cards[0]!.querySelector('.initiative-hp') as HTMLProgressElement).value).toBe(0.5);
    // Nameplates off: no name; sitting out: faded.
    expect(cards[1]!.querySelector('.initiative-name')).toBeNull();
    expect(cards[1]!.classList.contains('is-sitting-out')).toBe(true);
    expect(cards[1]!.querySelector('.initiative-hp')).toBeNull();
    expect(panel.querySelector('.initiative-round')?.textContent).toBe('Round 3');
  });

  it('lists a delayed combatant apart under "Delayed", after the order, and dashes a number not rolled', () => {
    const { panel, show } = setup();
    show({ round: 2, active: true, entries: [entry('ana', { initiative: 18, isActive: true }), entry('orc', { delayed: true, initiative: 12 }), entry('bo', { awaiting: true, initiative: 0 })] });
    const list = panel.querySelector('.initiative-list')!;
    expect([...list.children].map((child) => child.className)).toEqual(['initiative-card is-active', 'initiative-card', 'initiative-side']);
    const delayed = list.querySelector('.initiative-side')!;
    expect(delayed.getAttribute('aria-label')).toBe('Delayed');
    expect(delayed.querySelector('.initiative-side-label')?.textContent).toBe('Delayed');
    expect(delayed.querySelector('.initiative-name')?.textContent).toBe('orc');
    expect(delayed.querySelector('.is-active')).toBeNull();
    expect([...panel.querySelectorAll('.initiative-value')].map((value) => value.textContent)).toEqual(['18', '–', '12']);
  });

  it('greys a defeated combatant and marks it with a skull, and redraws when the token goes down or is healed', () => {
    const panel = document.createElement('div');
    document.body.replaceChildren(panel);
    const view = new InitiativeView({ panel, images: () => null });
    const initiative: PlayerInitiative = { round: 1, active: true, entries: [entry('ana', { isActive: true }), entry('orc')] };
    const show = (downed: boolean): void => view.update(playerScene({ initiative, tokens: { ana: playerToken({ side: 'players' }), orc: playerToken({ side: 'opponents', downed }) } }));
    show(false);
    expect(panel.querySelector('.is-defeated, .initiative-defeated')).toBeNull();
    show(true);
    const cards = [...panel.querySelectorAll('.initiative-card')];
    expect(cards.map((card) => card.classList.contains('is-defeated'))).toEqual([false, true]);
    const skull = cards[1]!.querySelector('.initiative-defeated')!;
    expect(skull.getAttribute('role')).toBe('img');
    expect(skull.getAttribute('aria-label')).toBe('Defeated');
    expect(skull.querySelector('svg')).not.toBeNull();
    expect(cards[0]!.querySelector('.initiative-defeated')).toBeNull();
    show(false);
    expect(panel.querySelector('.is-defeated')).toBeNull();
  });

  it('shows no Delayed group when nobody delayed', () => {
    const { panel, show } = setup();
    show({ round: 1, active: true, entries: [entry('ana', { isActive: true })] });
    expect(panel.querySelector('.initiative-side')).toBeNull();
  });

  it('marks no turn and shows no round between fights', () => {
    const { panel, show } = setup();
    show({ round: 1, active: false, entries: [entry('ana', { isActive: true })] });
    expect(panel.querySelector('.is-active')).toBeNull();
    expect(panel.querySelector('.initiative-round')).toBeNull();
  });

  it('by sides, lists the combatants under their side, the side whose turn it is marked, without values', () => {
    const { panel, show } = setup();
    show({ round: 2, active: true, entries: [entry('orc'), entry('ana')], sides: { first: 'players', active: 'opponents' } });
    const sides = [...panel.querySelectorAll('.initiative-side')];
    expect(sides.map((side) => side.querySelector('.initiative-side-label')?.textContent)).toEqual(['Players', 'Opponents']);
    expect(sides[1]!.classList.contains('is-active')).toBe(true);
    expect(panel.querySelector('.initiative-value')).toBeNull();
  });

  it('writes names as text, never markup', () => {
    const { panel, show } = setup();
    show({ round: 1, active: true, entries: [entry('ana', { name: '<img src=x onerror=alert(1)>' })] });
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.textContent).toContain('<img');
  });
});

describe('finding a combatant on the map (Atlas 0.9.1)', () => {
  const fight: PlayerInitiative = { round: 1, active: true, entries: [entry('ana', { isActive: true }), entry('orc'), entry('ghost')] };

  it('brings the token of a clicked card into view, by click, Enter or Space', () => {
    const found: string[] = [];
    const { panel, show } = setup((tokenId) => found.push(tokenId));
    show(fight);
    const cards = [...panel.querySelectorAll<HTMLElement>('.initiative-card')];
    cards[0]!.click();
    cards[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    cards[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    cards[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(found).toEqual(['ana', 'orc', 'ana']);
    expect(cards[0]!.tabIndex).toBe(0);
  });

  it('leaves a combatant whose token players do not see, and every card without a handler, alone', () => {
    const found: string[] = [];
    const { panel, show } = setup((tokenId) => found.push(tokenId));
    show(fight);
    // `ghost` has no token in the scene: its card finds nothing.
    const ghost = [...panel.querySelectorAll<HTMLElement>('.initiative-card')][2]!;
    ghost.click();
    expect(found).toEqual([]);
    expect(ghost.classList.contains('is-findable')).toBe(false);
    const plain = setup();
    plain.show(fight);
    const card = plain.panel.querySelector<HTMLElement>('.initiative-card')!;
    expect(card.classList.contains('is-findable')).toBe(false);
    expect(() => card.click()).not.toThrow();
  });
});
