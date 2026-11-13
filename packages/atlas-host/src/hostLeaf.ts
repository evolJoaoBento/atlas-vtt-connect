/**
 * Opens an Atlas tab that stays behind the tab in front. Stock Atlas takes the front whenever its view is set on a leaf,
 * whatever `active: false` says; the leaf stays hidden only when the front leaf is made active again after the new leaf
 * exists and before the view is set (Atlas 0.15.0, gate G6: 8 of 8 hidden with that order, 0 of 10 without).
 */
import type { App, TFile, WorkspaceLeaf, WorkspaceSplit } from 'obsidian';

export const ATLAS_VIEW_TYPE = 'atlas-vtt';

/**
 * The background leaf, loading `file` in Atlas. It goes in a tab group of the main window: the front's own when the
 * front is there, else the main window's most recent one, because Atlas moves a leaf out of a popout or a sidebar
 * with a notice. The front leaf stays the active one.
 */
export async function openBackgroundLeaf(app: App, file: TFile, front: WorkspaceLeaf): Promise<WorkspaceLeaf> {
  const { workspace } = app;
  const inMain = front.getRoot() === workspace.rootSplit;
  const group = (inMain ? front.parent : workspace.getMostRecentLeaf(workspace.rootSplit)?.parent) as (WorkspaceSplit & { children?: unknown[] }) | null | undefined;
  const leaf = group ? workspace.createLeafInParent(group, group.children?.length ?? 0) : workspace.getLeaf('tab');
  workspace.setActiveLeaf(front, { focus: true });
  await leaf.setViewState({ type: ATLAS_VIEW_TYPE, state: { file: file.path } });
  return leaf;
}
