/**
 * The split party as the GM's UI reads it (`onlineSessionStore`): whether it is supported, who is assigned where and how
 * many scenes are in use. Written from the scene hub's changes, never from `projected` (every 50 ms tick while live),
 * and only when something differs by value: every store change makes Atlas read its slots again (`registerGmUi`).
 */
import type { PresentationApi } from '@atlas-vtt/api-types';
import { onlineSessionStore, type OnlineSessionState } from './onlineSessionStore';
import type { SceneHub } from './scene/SceneHub';
import { tabKeyOf } from './split/tabKey';

type SplitState = Pick<OnlineSessionState, 'split' | 'assignments' | 'assignedCount' | 'scenesInUse'>;

function splitStateOf(hub: SceneHub): SplitState {
  const assignments = hub.assignedTabs();
  return {
    split: hub.splitSupported() ? 'on' : 'unsupported',
    assignments,
    assignedCount: Object.keys(assignments).length,
    scenesInUse: hub.scenesInUse(),
  };
}

function sameSplitState(a: SplitState, b: SplitState): boolean {
  if (a.split !== b.split || a.assignedCount !== b.assignedCount || a.scenesInUse !== b.scenesInUse) return false;
  const ids = Object.keys(a.assignments);
  return ids.length === Object.keys(b.assignments).length
    && ids.every((id) => b.assignments[id] !== undefined && tabKeyOf(a.assignments[id]!) === tabKeyOf(b.assignments[id]));
}

/** Keeps the store's split party in line with `hub` from now on; returns the disposer. */
export function syncSplitState(hub: SceneHub): () => void {
  const write = (): void => {
    const next = splitStateOf(hub);
    if (!sameSplitState(next, onlineSessionStore.getState())) onlineSessionStore.setState(next);
  };
  write();
  return hub.onSlotChange((change) => { if (change.kind !== 'projected') write(); });
}

/** "Bring all players back to the presented scene" applies: hosting, someone assigned, and a scene presented (D9). */
export function canBringEveryoneBack(presentation: Pick<PresentationApi, 'current'>): boolean {
  const state = onlineSessionStore.getState();
  return state.status === 'hosting' && state.split === 'on' && state.assignedCount > 0 && presentation.current() !== null;
}
