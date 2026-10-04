import { describe, expect, it } from 'vitest';
import type { Character } from '@atlas-vtt/api-types';
import { presentedSceneSummaries } from '../../../src/app/online/ui/presentedSceneSummary';
import { emptySceneState, presenter, sceneView } from './presentedFixtures';

describe('presented scene summary', () => {
  it('keeps the same summary while a token drag changes nothing it shows', () => {
    const presented = presenter();
    const hero: Character = { id: 'hero', kind: 'character', name: 'Hero', x: 0, y: 0, imagePath: '' };
    const state = emptySceneState();
    const { view, store, tavern } = sceneView(presented, { ...state, objects: { ...state.objects, tokens: { hero } } });
    presented.present(view, tavern);
    const { read } = presentedSceneSummaries(presented, presented.extension.views);

    const before = read();
    expect(before.characters).toEqual([{ id: 'hero', name: 'Hero' }]);
    expect(before.name).toBe('Tavern');

    store.setState({ objects: { ...state.objects, tokens: { hero: { ...hero, x: 40 } } } });
    expect(read()).toBe(before);

    store.setState({ objects: { ...state.objects, tokens: { hero: { ...hero, name: 'Heroine' } } } });
    expect(read().characters).toEqual([{ id: 'hero', name: 'Heroine' }]);
  });

  it('offers no characters while the scene is held, and tells its listeners each change', () => {
    const presented = presenter();
    const hero: Character = { id: 'hero', kind: 'character', name: 'Hero', x: 0, y: 0, imagePath: '' };
    const state = emptySceneState();
    const { view, store, tabs, tavern, dungeon } = sceneView(presented, { ...state, objects: { ...state.objects, tokens: { hero } } });
    const summaries = presentedSceneSummaries(presented, presented.extension.views);
    let changes = 0;
    const stop = summaries.subscribe(() => { changes++; });
    presented.present(view, tavern);
    store.setState({ objects: { ...state.objects, tokens: { hero: { ...hero, x: 40 } } } });
    tabs.getState().setActiveTab(dungeon);
    expect(summaries.read()).toMatchObject({ tabId: tavern, characters: [] });
    expect(changes).toBe(3);
    stop();
    presented.clear();
    expect(changes).toBe(3);
    expect(summaries.read()).toEqual({ tabId: null, name: null, characters: [] });
  });
});
