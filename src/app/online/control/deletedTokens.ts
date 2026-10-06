/**
 * Drops the assignments of tokens deleted from the scene the GM's view shows. A token is deleted when it was in that
 * scene's snapshot and is gone from it while the same scene stays loaded (`SlotProjection.watchLive`, compared only
 * within one `sceneId`): parking, loading a map, switching tabs, presenting another scene or clearing removes nothing,
 * so assignments come back with their scene.
 */
import type { SceneSnapshot } from '@atlas-vtt/api-types';
import type { SlotProjection } from '../scene/slotViews';
import type { TokenControl } from './TokenControl';

type Tokens = SceneSnapshot['objects']['tokens'];

type ShownScenes = Pick<SlotProjection, 'shownSlot' | 'shownSnapshot' | 'onSlotChange' | 'watchLive'>;

export function watchDeletedTokens(projection: ShownScenes, control: TokenControl): () => void {
  /** The shown scene's tokens when last seen loaded; null while none is shown. */
  let previous: { sceneId: string; tokens: Tokens } | null = null;
  /** A scene starts being shown: what it holds now is what a deletion is told from. */
  const baseline = (): void => {
    const shown = projection.shownSlot();
    if (shown?.sceneId === previous?.sceneId) return;
    const tokens = shown ? projection.shownSnapshot(shown.sceneId)?.objects.tokens : undefined;
    previous = shown && tokens ? { sceneId: shown.sceneId, tokens } : null;
  };
  baseline();
  const stopSlots = projection.onSlotChange(() => baseline());
  const stopLive = projection.watchLive((sceneId, snapshot) => {
    const tokens = snapshot?.loaded ? snapshot.objects.tokens : null;
    const before = previous;
    previous = tokens ? { sceneId, tokens } : null;
    if (!tokens || !before || before.sceneId !== sceneId || before.tokens === tokens) return;
    const gone = control.assignedTokens().filter((id) => Object.hasOwn(before.tokens, id) && !Object.hasOwn(tokens, id));
    if (gone.length > 0) control.dropTokens(gone);
  });
  return () => {
    stopSlots();
    stopLive();
  };
}
