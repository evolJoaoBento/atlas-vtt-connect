import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONTROLLED_BY_LABEL } from '../../../src/app/online/gm-ui/controlledByMenu';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { anna, ben, gmUiHarness, type GmUiHarness } from './gmUiFixtures';

let harness: GmUiHarness;

beforeEach(() => { harness = gmUiHarness(); });
afterEach(() => {
  harness.gm();
  act(() => { resetOnlineSessionStore(); });
});

/** Right-clicks a token in the view: the labels of the extension items Atlas adds to its menu. */
const rightClickLabels = (tokenId: string, tokenKind: 'token' | 'character', viewId = harness.scene.view): string[] =>
  harness.ui.tokenMenu(viewId, tokenId, tokenKind).map((item) => item.label);

describe('"Controlled by" in the token context menu', () => {
  it('shows for a character token in the GM view while hosting', () => {
    harness.host([anna, ben]);
    expect(rightClickLabels('hero', 'character')).toContain(CONTROLLED_BY_LABEL);
  });

  it('does not show for a token that is not a character', () => {
    harness.host([anna, ben]);
    expect(rightClickLabels('crate', 'token')).not.toContain(CONTROLLED_BY_LABEL);
  });

  it('does not show without a hosted session', () => {
    expect(rightClickLabels('hero', 'character')).not.toContain(CONTROLLED_BY_LABEL);
  });

  it('does not show in a player view, which draws no extension items at all', () => {
    harness.host([anna, ben]);
    // a player window is not one of Atlas's listed map views: no slot draws in it
    expect(rightClickLabels('hero', 'character', 'player')).toEqual([]);
  });

  it('does not show once the session has ended', () => {
    harness.host([anna, ben]);
    act(() => { onlineSessionStore.setState({ status: 'idle', tokenControl: null }); });
    expect(rightClickLabels('hero', 'character')).toEqual([]);
  });
});
