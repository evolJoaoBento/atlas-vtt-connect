import type { App, WorkspaceLeaf } from 'obsidian';

/**
 * Brings the tab of an Atlas map view to the front, so the panel opened in it is seen. The API names views by
 * `viewId`, which an Atlas view carries as a property; a leaf whose view has none is not one.
 */
export function revealView(app: App, viewId: string): void {
  let found: WorkspaceLeaf | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if ((leaf.view as { viewId?: unknown }).viewId === viewId) found = leaf;
  });
  if (found) void app.workspace.revealLeaf(found);
}
