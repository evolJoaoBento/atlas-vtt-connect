import { normalizePath, TFile, type App } from 'obsidian';
import type { PulledItems } from './PulledItems';

/** The vault file at `path`; null when there is none, the path is empty, or it is a folder. */
export function fileAt(app: App, path: string): TFile | null {
  if (!path) return null;
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  return file instanceof TFile ? file : null;
}

/** The folder part of a vault path; empty for a file at the vault root. */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/**
 * Whether a new file may not take `path`: something is there, a pulled record owns it, or a
 * sibling differs from it only by case (Windows and macOS file systems treat those as one).
 */
export function pathTaken(app: App, pulled: Pick<PulledItems, 'holds'>, path: string): boolean {
  if (app.vault.getAbstractFileByPath(path) !== null || pulled.holds(path)) return true;
  const lower = path.toLowerCase();
  const folder = folderOf(path);
  // The vault root has no path of its own to look up.
  return ((folder === '' ? app.vault.getRoot() : app.vault.getFolderByPath(folder))?.children ?? []).some((child) => child.path.toLowerCase() === lower);
}
