/**
 * The presented scene as the GM's online panel and palette see it: its tab, its name
 * and its character tokens. While the scene is held (the GM shows another tab) or its
 * map is loading, the view's store holds another map, so no characters are offered.
 * Read through `useSyncExternalStore`: `read` returns the same object until something
 * it reads changes.
 */
import type { Character, TokenEntity, ViewsApi } from '@atlas-vtt/api-types';
import type { LiveScene, PresentedSceneSource } from '../atlas/presentedSource';

export interface PresentedCharacter {
  id: string;
  name: string;
}

export interface PresentedSceneSummary {
  /** The presented tab; null while nothing is presented. */
  tabId: string | null;
  /** The presented tab's name; null while nothing is presented. */
  name: string | null;
  /** The presented scene's character tokens; empty while it cannot be assigned from. */
  characters: readonly PresentedCharacter[];
}

export interface PresentedSceneSummaries {
  read(): PresentedSceneSummary;
  /**
   * Calls `onChange` when the presented scene, its tokens or its loading change. The API tells of no tab
   * renames, so a renamed tab shows with the next of those (`read` itself always reads the name afresh).
   */
  subscribe(onChange: () => void): () => void;
}

const NOTHING: PresentedSceneSummary = { tabId: null, name: null, characters: [] };

interface Cached {
  scene: LiveScene;
  assignable: boolean;
  tokens: Readonly<Record<string, TokenEntity>> | null;
  name: string | null;
  value: PresentedSceneSummary;
}

/** A character's name as the panel lists it, like the nameplate's fallback. */
export function characterName(token: Character): string {
  return token.name || token.statblockName || 'Unnamed character';
}

function charactersOf(tokens: Readonly<Record<string, TokenEntity>>): PresentedCharacter[] {
  return Object.values(tokens)
    .filter((token): token is Character => token.kind === 'character')
    .map((token) => ({ id: token.id, name: characterName(token) }));
}

function sameSummary(a: PresentedSceneSummary, b: PresentedSceneSummary): boolean {
  return a.tabId === b.tabId && a.name === b.name
    && a.characters.length === b.characters.length
    && a.characters.every((character, index) => character.id === b.characters[index]?.id && character.name === b.characters[index].name);
}

export function presentedSceneSummaries(presented: PresentedSceneSource, views: Pick<ViewsApi, 'list'>): PresentedSceneSummaries {
  let cached: Cached | null = null;
  const tabName = (scene: LiveScene): string | null => views.list()
    .find((view) => view.viewId === scene.info.viewId)?.tabs.find((tab) => tab.tabId === scene.info.tabId)?.name ?? null;

  const read = (): PresentedSceneSummary => {
    const scene = presented.current();
    if (!scene) return NOTHING;
    const snapshot = scene.snapshot();
    const assignable = !presented.isHeld() && snapshot?.loaded === true;
    const tokens = assignable && snapshot ? snapshot.objects.tokens : null;
    const name = tabName(scene);
    if (cached && cached.scene === scene && cached.assignable === assignable && cached.tokens === tokens && cached.name === name) {
      return cached.value;
    }
    const value: PresentedSceneSummary = { tabId: scene.info.tabId, name, characters: tokens ? charactersOf(tokens) : [] };
    // Token drags change the tokens every frame: keep the previous summary while nothing it shows changed.
    const result = cached && sameSummary(cached.value, value) ? cached.value : value;
    cached = { scene, assignable, tokens, name, value: result };
    return result;
  };

  const subscribe = (onChange: () => void): (() => void) => {
    const watch = (scene: LiveScene | null): (() => void) => (scene ? scene.subscribe(() => onChange()) : () => undefined);
    let stopScene = watch(presented.current());
    const changed = (): void => {
      stopScene();
      stopScene = watch(presented.current());
      onChange();
    };
    const stopPresented = presented.subscribe({ presented: changed, held: changed, cleared: changed });
    return () => {
      stopPresented();
      stopScene();
    };
  };

  return { read, subscribe };
}
