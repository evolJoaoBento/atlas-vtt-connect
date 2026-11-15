/**
 * A note the receiver pulled, or allowed in, opens: in the tab that already shows it, else in a new tab. Only after one
 * pull the receiver asked for (Pull in Shared with me, Allow on a sent note); updates that arrive by themselves never
 * open anything, and the callers open notes only (a map goes to Atlas as a scene).
 */
import { TFile, type App, type WorkspaceLeaf } from 'obsidian';

export async function openPulledNote(app: App, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile) || file.extension !== 'md') return;
  let shown: WorkspaceLeaf | null = null;
  app.workspace.iterateAllLeaves((leaf) => {
    if (!shown && (leaf.view as { file?: TFile | null } | undefined)?.file?.path === file.path) shown = leaf;
  });
  try {
    if (shown) {
      app.workspace.setActiveLeaf(shown, { focus: true });
      return;
    }
    await app.workspace.getLeaf('tab').openFile(file);
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not open the pulled note:', error);
  }
}
