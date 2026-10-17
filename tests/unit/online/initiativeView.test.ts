import { describe, expect, it } from 'vitest';
import { InitiativeView } from '../../../online-client/initiativeView.mts';
import type { PlayerInitiative, PlayerInitiativeEntry } from '../../../src/app/online/scene/sceneTypes';
import { playerScene, playerToken } from './sceneFixtures';

const entry = (tokenId: string, patch: Partial<PlayerInitiativeEntry> = {}): PlayerInitiativeEntry => ({
  id: tokenId, tokenId, initiative: 10, name: tokenId, hp: null, isActive: false, ...patch,
});

function setup() {
  const panel = document.createElement('div');
  document.body.replaceChildren(panel);
  const view = new InitiativeView({ panel, images: () => null });
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
