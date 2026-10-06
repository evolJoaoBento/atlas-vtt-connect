/**
 * The GM's online UI over `FakeAtlas`: Connect's UI registered the way `startConnect` does, with a service whose
 * calls are recorded, and a map view with the Tavern and Dungeon tabs. Tests read what Atlas would draw from
 * `atlas.ui` (the fake's slots) and drive the panel through its mounted container.
 */
import { act } from '@testing-library/react';
import { vi } from 'vitest';
import type { AtlasCapability, Character, TokenEntity } from '@atlas-vtt/api-types';
import { TokenControl } from '../../../src/app/online/control/TokenControl';
import type { SessionPlayer } from '../../../src/app/online/GmSession';
import { registerGmUi, type GmUi } from '../../../src/app/online/gm-ui/registerGmUi';
import { onlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { FakeAtlas } from '../../fake/FakeAtlas';
import type { FakeUi } from '../../fake/fakeUi';
import { emptySceneState, presenter, sceneView, type Presenter, type SceneView } from './presentedFixtures';

export const hero: Character = { id: 'hero', kind: 'character', name: 'Hero', x: 0, y: 0, imagePath: '' };
export const goblin: Character = { id: 'goblin', kind: 'character', name: '', statblockName: 'Goblin', x: 0, y: 0, imagePath: '' };
export const crate: TokenEntity = { id: 'crate', kind: 'token', x: 0, y: 0, imagePath: '' } as TokenEntity;

export const anna: SessionPlayer = { playerId: 'p1', name: 'Anna', status: 'admitted' };
export const ben: SessionPlayer = { playerId: 'p2', name: 'Ben', status: 'admitted' };
export const cy: SessionPlayer = { playerId: 'p3', name: 'Cy', status: 'pending' };
export const dan: SessionPlayer = { playerId: 'p4', name: 'Dan', status: 'gone' };

type StubbedCall = 'start' | 'stop' | 'allow' | 'deny' | 'kick' | 'link' | 'linkPlaceholder' | 'assign' | 'unassign' | 'everyoneBack' | 'wouldExceedCap';

/** The service as the panel and the palette call it; `wouldExceedCap` answers false unless a test says otherwise. */
export function serviceStub(): Record<StubbedCall, ReturnType<typeof vi.fn>> {
  return {
    start: vi.fn(() => Promise.resolve()), stop: vi.fn(), allow: vi.fn(), deny: vi.fn(), kick: vi.fn(), link: vi.fn(), linkPlaceholder: vi.fn(),
    assign: vi.fn(), unassign: vi.fn(), everyoneBack: vi.fn(), wouldExceedCap: vi.fn(() => false),
  };
}

export interface GmUiHarness extends Presenter {
  readonly ui: FakeUi;
  readonly scene: SceneView;
  readonly service: ReturnType<typeof serviceStub>;
  readonly gm: GmUi;
  readonly joinSession: ReturnType<typeof vi.fn>;
  /** Hosting with these players; the returned control is the session's. */
  host(players?: SessionPlayer[]): TokenControl;
  /** Opens the panel in the scene's view, rendered. */
  openPanel(): Promise<HTMLElement>;
}

/**
 * Atlas with the `ui` capability, a map view (active) holding `tokens`, and Connect's GM UI registered in it.
 * `capabilities`: more of them (`scene-tabs` for the split party).
 */
export function gmUiHarness(options: { tokens?: Record<string, TokenEntity>; join?: boolean; capabilities?: AtlasCapability[] } = {}): GmUiHarness {
  const atlas = new FakeAtlas({ capabilities: ['views', 'presentation', 'rules', 'settings', 'storage', 'tokens', 'ui', ...(options.capabilities ?? [])] });
  const presenting = presenter(atlas);
  const state = emptySceneState();
  const scene = sceneView(presenting, { ...state, objects: { ...state.objects, tokens: options.tokens ?? { hero, goblin, crate } } });
  atlas.views.setActive(scene.view);
  const service = serviceStub();
  const joinSession = vi.fn();
  const gm = registerGmUi(presenting.extension, service as never, { presented: presenting, ...(options.join ? { joinSession } : {}) });
  const ui = atlas.ui!;
  return {
    ...presenting, ui, scene, service, gm, joinSession,
    host(players = []) {
      const control = new TokenControl();
      act(() => { onlineSessionStore.setState({ status: 'hosting', joinUrl: 'https://example.org/join/#abc', players, tokenControl: control, error: null }); });
      return control;
    },
    async openPanel() {
      await act(async () => { ui.openPanel('online', scene.view); });
      return ui.panelContainer('online', scene.view)!;
    },
  };
}
