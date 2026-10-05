/** Sending: the People and Share with… commands, the file menu, and note item ids that follow the vault. */
import { TFile, type TAbstractFile } from 'obsidian';
import type { ScenesApi } from '@atlas-vtt/api-types';
import { followVaultChange, type VaultChange } from './model/mapShareRenames';
import { obsidianCatalogueSources, type CatalogueAtlas } from './model/catalogueSources';
import { SenderCatalogue } from './model/SenderCatalogue';
import type { SectionTrust } from './model/sectionTrust';
import type { ShareItems } from './model/ShareItems';
import type { PeopleBook } from './people/PeopleBook';
import { GM_PERSON_ID } from './people/peopleTypes';
import type { SharingScope } from './sharingScope';
import { shareSessionStore } from './shareSessionStore';
import { openPeopleModal } from './people/ui/PeopleModal';
import { openShareWithModal } from './ui/ShareWithModal';

export interface ShareCommandServices {
  people: PeopleBook;
  items: ShareItems;
  /** Atlas's scenes and rules, and the settings the catalogue reads. */
  atlas: CatalogueAtlas & { scenes: Pick<ScenesApi, 'list' | 'findByMap' | 'getData' | 'setData' | 'readMap'> };
  /** This Atlas's own table id, from Connect's settings; null before it first hosts. */
  ownTableId: () => string | null;
  /** What the metadata cache parsed, so a note's sections are used only for the text they came from. */
  sections: SectionTrust;
}

/** Notes and maps are what can be shared. */
export const shareable = (file: TAbstractFile | null): file is TFile =>
  file instanceof TFile && (file.extension === 'md' || file.extension === 'atlasmap');

/** Registers the sending commands; returns the catalogue of what this Atlas shares, which sessions answer from. */
export function registerShareCommands(plugin: SharingScope, { people, items, atlas, ownTableId, sections }: ShareCommandServices): SenderCatalogue {
  plugin.addCommand({
    id: 'people', name: 'People…',
    callback: () => openPeopleModal(plugin.app, people, ownTableId()),
  });
  void items.ready();
  const catalogue = new SenderCatalogue(obsidianCatalogueSources(plugin.app, atlas, sections), items, people);
  const selfAt = (tableId: string): string | undefined => {
    if (ownTableId() === tableId) return GM_PERSON_ID;
    const session = shareSessionStore.getState().session;
    return session?.tableId === tableId ? session.self : undefined;
  };
  const share = (file: TFile): void => openShareWithModal(plugin.app, file, { people, catalogue, scenes: atlas.scenes, selfAt, sections });
  plugin.addCommand({
    id: 'share-with', name: 'Share with…',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!shareable(file)) return false;
      if (!checking) share(file);
      return true;
    },
  });
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (!shareable(file)) return;
    menu.addItem((item) => item.setTitle('Share with…').setIcon('share-2').onClick(() => share(file)));
  }));
  // Note item ids and ticked map notes follow the vault, so a renamed note keeps its updates and its place on a map, and no path is ever sent.
  let following: Promise<void> = Promise.resolve();
  const follow = (change: VaultChange): void => {
    following = following.then(() => followVaultChange(atlas.scenes, change)).catch((error: unknown) => console.error('[Atlas VTT Connect] Could not update a map share after a vault change:', error));
  };
  plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => {
    items.renamed(oldPath, file.path);
    follow({ rename: [oldPath, file.path] });
  }));
  plugin.registerEvent(plugin.app.vault.on('delete', (file) => {
    items.deleted(file.path);
    follow({ removed: file.path });
  }));
  return catalogue;
}
