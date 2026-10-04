/**
 * Drops the assignments of tokens deleted from the presented scene. A token is deleted
 * when it was in the presented view's snapshot and is gone from it while the same map stays loaded:
 * holding the scene, loading a map, presenting another scene or clearing removes
 * nothing, so assignments come back with their scene.
 */
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { LiveScene, PresentedSceneSource } from '../atlas/presentedSource';
import type { TokenControl } from './TokenControl';

type Tokens = SceneSnapshot['objects']['tokens'];

/** The loaded map's tokens; null while a map loads (or none is loaded), when the store holds no scene of its own. */
function loadedTokens(snapshot: SceneSnapshot | null): Tokens | null {
  return snapshot?.loaded ? snapshot.objects.tokens : null;
}

export function watchDeletedTokens(presented: PresentedSceneSource, control: TokenControl): () => void {
  let stopStore: (() => void) | null = null;
  const detach = (): void => {
    stopStore?.();
    stopStore = null;
  };
  const attach = (scene: LiveScene): void => {
    detach();
    let previous = loadedTokens(scene.snapshot());
    stopStore = scene.subscribe((snapshot) => {
      const tokens = loadedTokens(snapshot);
      if (tokens === previous) return;
      const before = previous;
      previous = tokens;
      if (!tokens || !before) return;
      const gone = control.assignedTokens().filter((id) => Object.hasOwn(before, id) && !Object.hasOwn(tokens, id));
      if (gone.length > 0) control.dropTokens(gone);
    });
  };
  const stopListening = presented.subscribe({
    presented: (scene) => attach(scene),
    held: () => detach(),
    cleared: () => detach(),
  });
  const current = presented.current();
  if (current && !presented.isHeld()) attach(current);
  return () => {
    stopListening();
    detach();
  };
}
