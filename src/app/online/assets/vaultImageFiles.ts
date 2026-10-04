/** The vault's images for the asset registry: sizes and times from Obsidian's file index, bytes with `readBinary`. */
import { normalizePath, TFile, type App } from 'obsidian';
import type { ImageFiles, ImageFileStat } from '../scene/sceneContracts';

export function vaultImageFiles(app: App): ImageFiles {
  const fileAt = (path: string): TFile | null => {
    const file = app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  };
  return {
    stat: (path: string): ImageFileStat | null => {
      const file = fileAt(path);
      return file ? { size: file.stat.size, mtime: file.stat.mtime } : null;
    },
    read: async (path: string): Promise<ArrayBuffer> => {
      const file = fileAt(path);
      if (!file) throw new Error('The image is no longer in the vault');
      return app.vault.readBinary(file);
    },
    onChange: (listener: (path: string) => void): (() => void) => {
      const { vault } = app;
      const refs = [
        vault.on('modify', (file) => listener(file.path)),
        vault.on('delete', (file) => listener(file.path)),
        vault.on('rename', (file, oldPath) => { listener(oldPath); listener(file.path); }),
      ];
      return () => { refs.forEach((ref) => vault.offref(ref)); };
    },
  };
}
