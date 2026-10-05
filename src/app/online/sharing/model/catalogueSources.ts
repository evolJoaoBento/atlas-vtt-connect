/** The catalogue's view of this vault: notes with `atlas-share`, shared scenes (through Atlas's `scenes`), map files and images. */
import { TFile, type App } from 'obsidian';
import type { RulesApi, ScenesApi } from '@atlas-vtt/api-types';
import { vaultImageFiles } from '../../assets/vaultImageFiles';
import { pickPlayerViewRules, type PlayerViewRules } from '../../scene/playerViewRules';
import { readSharedMap } from './buildMapPayload';
import type { NoteSource, SharedMapEntry } from './catalogueAccess';
import { mapShareOf } from './mapShare';
import { trustedSections, type SectionTrust } from './sectionTrust';
import type { CatalogueSources } from './SenderCatalogue';
import { parseShareRule, SHARE_PROPERTY } from './shareRule';

/** What the catalogue asks of Atlas and of Connect's settings. */
export interface CatalogueAtlas {
  scenes: Pick<ScenesApi, 'list' | 'getData' | 'readMap'>;
  rules: Pick<RulesApi, 'forMap'>;
  /** Atlas's player view rules (`settings.get('playerView')`), which the player window and online players follow. */
  playerView: () => PlayerViewRules;
  /** Note properties shared notes keep (Connect's settings). */
  shareableProperties: () => readonly string[];
}

export function obsidianCatalogueSources(app: App, atlas: CatalogueAtlas, trust: SectionTrust): CatalogueSources {
  const noteOf = (file: TFile): NoteSource => ({
    path: file.path, title: file.basename, rule: parseShareRule(app.metadataCache.getFileCache(file)?.frontmatter?.[SHARE_PROPERTY]),
  });
  return {
    notes: () => app.vault.getMarkdownFiles()
      .filter((file) => app.metadataCache.getFileCache(file)?.frontmatter?.[SHARE_PROPERTY] !== undefined)
      .map(noteOf),
    note: (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      return file instanceof TFile && file.extension === 'md' ? noteOf(file) : null;
    },
    readNote: async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return { text: await app.vault.adapter.read(path), sections: null };
      // Sections only when parsed from this very text (`SectionTrust`); the filter checks their positions too.
      const text = await app.vault.cachedRead(file);
      return { text, sections: trustedSections(app, trust, file, text) };
    },
    maps: async () => {
      const shared: SharedMapEntry[] = [];
      for (const scene of await atlas.scenes.list()) {
        const share = scene.mapPath ? await mapShareOf(atlas.scenes, scene.id) : null;
        if (share && scene.mapPath) shared.push({ name: scene.name, mapPath: scene.mapPath, share });
      }
      return shared;
    },
    readMap: (mapPath) => readSharedMap(atlas.scenes, mapPath),
    images: vaultImageFiles(app),
    isFile: (path) => path.length < 1024 && app.vault.getAbstractFileByPath(path) instanceof TFile,
    resolveLink: (linkpath, from) => {
      const file = app.metadataCache.getFirstLinkpathDest(linkpath, from);
      return file && file.extension === 'md' ? file.path : null;
    },
    shareable: () => atlas.shareableProperties(),
    rules: () => pickPlayerViewRules(atlas.playerView()),
    collectionGrid: (mapPath) => atlas.rules.forMap(mapPath).gridDefaults,
    coneAngle: (mapPath) => atlas.rules.forMap(mapPath).measurement.coneAngle,
    initiativeRules: (mapPath) => atlas.rules.forMap(mapPath).initiative,
  };
}
