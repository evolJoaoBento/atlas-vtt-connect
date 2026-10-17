/** Picks a vault image to show online players (`handouts`): Obsidian's fuzzy picker over the vault's images. */
import { FuzzySuggestModal, type App, type TFile } from 'obsidian';

/** The image types players' pages can show (`ASSET_LIMITS`' formats). */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg']);

export class HandoutModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly pick: (file: TFile) => void) {
    super(app);
    this.setPlaceholder('Pick an image to show your players');
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => IMAGE_EXTENSIONS.has(file.extension.toLowerCase()));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.pick(file);
  }
}
