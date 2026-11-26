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
    const cards = [...panel.querySelectorAll('.atlas-initiative-card')];
    // Atlas 0.18: art only, no number on a card.
    expect(cards.map((card) => card.querySelector('.initiative-value'))).toEqual([null, null]);
    expect(cards[0]!.classList.contains('atlas-initiative-card--active')).toBe(true);
    expect(cards[0]!.getAttribute('aria-current')).toBe('true');
    expect(cards[0]!.querySelector('.atlas-initiative-card__name')?.textContent).toBe('ana');
    // Nameplates off: no name; sitting out: faded.
    expect(cards[1]!.querySelector('.atlas-initiative-card__name')).toBeNull();
    expect(cards[1]!.classList.contains('atlas-initiative-card--sitting-out')).toBe(true);
    expect(panel.querySelector('.atlas-initiative-panel__round')?.textContent).toBe('Round 3');
  });

  it('lists a delayed combatant apart under "Delayed", after the order, and shows no number or dash', () => {
    const { panel, show } = setup();
    show({ round: 2, active: true, entries: [entry('ana', { initiative: 18, isActive: true }), entry('orc', { delayed: true, initiative: 12 }), entry('bo', { awaiting: true, initiative: 0 })] });
    const list = panel.querySelector('.atlas-initiative-panel__list')!;
    expect([...list.children].map((child) => child.className)).toEqual(['atlas-initiative-card atlas-initiative-card--tile atlas-initiative-card--active atlas-initiative-card--ally', 'atlas-initiative-card atlas-initiative-card--tile', 'atlas-initiative-side atlas-initiative-side--delayed']);
    const delayed = list.querySelector('.atlas-initiative-side')!;
    expect(delayed.getAttribute('aria-label')).toBe('Delayed');
    expect(delayed.querySelector('.atlas-initiative-side__label')?.textContent).toBe('Delayed');
    expect(delayed.querySelector('.atlas-initiative-card__name')?.textContent).toBe('orc');
    expect(delayed.querySelector('.atlas-initiative-card--active')).toBeNull();
    expect(delayed.querySelector('.atlas-initiative-card--delayed')).not.toBeNull();
    expect(panel.querySelector('.initiative-value')).toBeNull();
    expect(panel.textContent).not.toContain('–');
  });

  it('greys a defeated combatant and marks it with a skull, and redraws when the token goes down or is healed', () => {
    const panel = document.createElement('div');
    document.body.replaceChildren(panel);
    const view = new InitiativeView({ panel, images: () => null });
    const initiative: PlayerInitiative = { round: 1, active: true, entries: [entry('ana', { isActive: true }), entry('orc')] };
    const show = (downed: boolean): void => view.update(playerScene({ initiative, tokens: { ana: playerToken({ side: 'players' }), orc: playerToken({ side: 'opponents', downed }) } }));
    show(false);
    expect(panel.querySelector('.atlas-initiative-card--defeated, .atlas-initiative-card__defeated-overlay')).toBeNull();
    show(true);
    const cards = [...panel.querySelectorAll('.atlas-initiative-card')];
    expect(cards.map((card) => card.classList.contains('atlas-initiative-card--defeated'))).toEqual([false, true]);
    const skull = cards[1]!.querySelector('.atlas-initiative-card__defeated-overlay')!;
    expect(skull.getAttribute('role')).toBe('img');
    expect(skull.getAttribute('aria-label')).toBe('Defeated');
    expect(skull.querySelector('svg')).not.toBeNull();
    expect(cards[0]!.querySelector('.atlas-initiative-card__defeated-overlay')).toBeNull();
    show(false);
    expect(panel.querySelector('.atlas-initiative-card--defeated')).toBeNull();
  });

  it("shows the token's conditions and look-alike number on its card, and redraws when they change", () => {
    const panel = document.createElement('div');
    document.body.replaceChildren(panel);
    const view = new InitiativeView({ panel, images: () => null });
    const initiative: PlayerInitiative = { round: 1, active: true, entries: [entry('ana', { isActive: true }), entry('orc')] };
    const show = (conditions: Array<{ id: string; value: number | null; name?: string; color?: string }>, instance?: number): void => view.update(playerScene({
      initiative, tokens: { ana: playerToken({ side: 'players' }), orc: playerToken({ side: 'opponents', conditions, ...(instance !== undefined ? { instance } : {}) }) },
    }));
    show([]);
    expect(panel.querySelector('.atlas-initiative-card__conditions')).toBeNull();
    show([{ id: 'poisoned', value: null, name: 'Poisoned', color: '#16a34a' }, { id: 'exhaustion', value: 2, name: 'Exhaustion' }], 3);
    const card = [...panel.querySelectorAll('.atlas-initiative-card')][1]!;
    expect([...card.querySelectorAll('.atlas-initiative-card__condition')].map((chip) => [chip.querySelector('.atlas-condition-badge')?.firstChild?.textContent, chip.getAttribute('aria-label')])).toEqual([['P', 'Poisoned'], ['E', 'Exhaustion 2']]);
    expect(card.querySelector('.atlas-condition-badge__value')?.textContent).toBe('2');
    expect((card.querySelector('.atlas-condition-badge') as HTMLElement).style.getPropertyValue('--atlas-condition-color')).toBe('#16a34a');
    expect(card.classList.contains('atlas-initiative-card--conditions')).toBe(true);
    expect(card.querySelector('.atlas-initiative-card__marks .atlas-initiative-card__instance-badge')?.textContent).toBe('3');
    const many = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, value: null }));
    show(many);
    expect(panel.querySelectorAll('.atlas-initiative-card')[1]!.querySelector('.atlas-initiative-card__condition-more')?.textContent).toBe('+2');
    expect(panel.querySelectorAll('.atlas-initiative-card')[1]!.querySelectorAll('.atlas-initiative-card__condition')).toHaveLength(3);
  });

  it('draws a card with art as Atlas does: the picture fills it, red rises in it, a token without a ring is cropped closer', () => {
    const panel = document.createElement('div');
    document.body.replaceChildren(panel);
    const picture = { image: { src: 'data:image/png;base64,AAAA' }, width: 64, height: 64, release: () => undefined };
    const view = new InitiativeView({ panel, images: (id) => (id === 'art' ? picture as never : null) });
    view.update(playerScene({
      initiative: { round: 1, active: true, entries: [entry('ana', { isActive: true, hpShare: 0.25 }), entry('orc', { hpShare: 1 })] },
      tokens: { ana: playerToken({ side: 'players', image: 'art', ring: '#2266ff' }), orc: playerToken({ side: 'opponents', image: 'art', ring: null }) },
    }));
    const [ana, orc] = [...panel.querySelectorAll<HTMLElement>('.atlas-initiative-card')];
    expect(ana!.querySelector('.atlas-initiative-card__art img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(ana!.querySelector('.atlas-initiative-card__art img')?.getAttribute('alt')).toBe('ana');
    // Players see art only: the name is the picture's text, not drawn over it.
    expect(ana!.querySelector('.atlas-initiative-card__name')).toBeNull();
    expect((ana!.querySelector('.atlas-initiative-wound') as HTMLElement).style.getPropertyValue('--atlas-wound')).toBe('0.75');
    expect((orc!.querySelector('.atlas-initiative-wound') as HTMLElement).style.getPropertyValue('--atlas-wound')).toBe('0');
    expect(ana!.style.getPropertyValue('--atlas-turn-color')).toBe('#2266ff');
    expect(ana!.classList.contains('atlas-initiative-card--ally')).toBe(true);
    expect(orc!.classList.contains('atlas-initiative-card--ally')).toBe(false);
    expect(ana!.querySelector('.atlas-initiative-card__art--framed')).toBeNull();
    expect(orc!.querySelector('.atlas-initiative-card__art--framed')).not.toBeNull();
  });

  it("is the panel of Atlas's players' list, docked as a row across the top", () => {
    const { panel, show } = setup();
    expect(panel.classList.contains('atlas-player-initiative--top') && panel.classList.contains('atlas-initiative-panel--row')).toBe(true);
    show({ round: 1, active: true, entries: [entry('ana', { isActive: true })] });
    expect([...panel.children].map((child) => child.className)).toEqual([
      'atlas-initiative-panel__surface', 'atlas-initiative-panel__list', 'atlas-initiative-panel__top-shade', 'atlas-initiative-panel__round',
    ]);
  });

  it('shows a card without art by its name, else by a stand-in', () => {
    const { panel, show } = setup();
    show({ round: 1, active: true, entries: [entry('ana'), entry('orc', { name: null })] });
    const [ana, orc] = [...panel.querySelectorAll('.atlas-initiative-card')];
    expect(ana!.querySelector('.atlas-initiative-card__name')?.textContent).toBe('ana');
    expect(ana!.querySelector('.atlas-initiative-card__avatar')).toBeNull();
    expect(orc!.querySelector('.atlas-initiative-card__avatar svg')).not.toBeNull();
  });

  it('shows no Delayed group when nobody delayed', () => {
    const { panel, show } = setup();
    show({ round: 1, active: true, entries: [entry('ana', { isActive: true })] });
    expect(panel.querySelector('.atlas-initiative-side')).toBeNull();
  });

  it('marks no turn and shows no round between fights', () => {
    const { panel, show } = setup();
    show({ round: 1, active: false, entries: [entry('ana', { isActive: true })] });
    expect(panel.querySelector('.atlas-initiative-card--active, .atlas-initiative-side--active')).toBeNull();
    expect(panel.querySelector('.atlas-initiative-panel__round')).toBeNull();
  });

  it('by sides, lists the combatants under their side, the side whose turn it is marked, without values', () => {
    const { panel, show } = setup();
    show({ round: 2, active: true, entries: [entry('orc'), entry('ana')], sides: { first: 'players', active: 'opponents' } });
    const sides = [...panel.querySelectorAll('.atlas-initiative-side')];
    expect(sides.map((side) => side.querySelector('.atlas-initiative-side__label')?.textContent)).toEqual(['Players', 'Opponents']);
    expect(sides[1]!.classList.contains('atlas-initiative-side--active')).toBe(true);
    expect(panel.querySelector('.initiative-value')).toBeNull();
  });

  it('writes names as text, never markup', () => {
    const { panel, show } = setup();
    show({ round: 1, active: true, entries: [entry('ana', { name: '<img src=x onerror=alert(1)>' })] });
    expect(panel.querySelector('img')).toBeNull();
    expect(panel.querySelector('.atlas-initiative-card__name')?.innerHTML).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(panel.textContent).toContain('<img');
  });
});

describe('finding a combatant on the map (Atlas 0.9.1)', () => {
  const fight: PlayerInitiative = { round: 1, active: true, entries: [entry('ana', { isActive: true }), entry('orc'), entry('ghost')] };

  it('brings the token of a clicked card into view, by click, Enter or Space', () => {
    const found: string[] = [];
    const { panel, show } = setup((tokenId) => found.push(tokenId));
    show(fight);
    const cards = [...panel.querySelectorAll<HTMLElement>('.atlas-initiative-card')];
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
    const ghost = [...panel.querySelectorAll<HTMLElement>('.atlas-initiative-card')][2]!;
    ghost.click();
    expect(found).toEqual([]);
    expect(ghost.classList.contains('is-findable')).toBe(false);
    const plain = setup();
    plain.show(fight);
    const card = plain.panel.querySelector<HTMLElement>('.atlas-initiative-card')!;
    expect(card.classList.contains('is-findable')).toBe(false);
    expect(() => card.click()).not.toThrow();
  });
});
