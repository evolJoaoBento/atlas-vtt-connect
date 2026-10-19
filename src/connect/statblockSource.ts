/**
 * The stat block a token links, read as Atlas reads it (`resolveLinkedCreature` in Atlas): a note made with an Atlas
 * template (`atlas-template`) with that template, else the Fantasy Statblocks bestiary entry of the note
 * (`window.FantasyStatblocks`, once its bestiary is resolved), else the note's own frontmatter, else the bestiary
 * creature of the token's statblock name. What comes back is the creature as is; the player's sheet whitelists it
 * (`tools/sheets.ts`, `tools/templateSheets.ts`).
 *
 * Atlas keeps its templates as `.atlastemplate` files (JSON) anywhere in the vault, the lowest path winning where two
 * share an id (`TemplateLibrary`). They are read once, and again when one changes.
 */
import { TFile, type App, type EventRef } from 'obsidian';
import type { Character } from '@atlas-vtt/api-types';
import type { StatblockSource } from '../app/online/atlas/toolParts';
import { templateId, type TemplatedStatblock } from '../app/online/tools/templateSheets';

interface FantasyStatblocksApi {
  isResolved?(): boolean;
  getBestiaryCreatures?(): unknown;
  hasCreature?(name: string): boolean;
  getCreatureFromBestiary?(name: string): unknown;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null;

const TEMPLATE_EXTENSION = 'atlastemplate';
const TEMPLATE_KEY = 'atlas-template';

function api(): FantasyStatblocksApi | null {
  const found = (window as unknown as { FantasyStatblocks?: unknown }).FantasyStatblocks;
  return isObject(found) ? found : null;
}

function resolved(statblocks: FantasyStatblocksApi | null): statblocks is FantasyStatblocksApi {
  try {
    return statblocks?.isResolved?.() === true;
  } catch {
    return false;
  }
}

/** The path of the note, without a heading (`note.md#Goblin`). */
const notePath = (path: string): string => path.split('#')[0] ?? path;

/** The vault's Atlas templates by id; read on first use and after any template file changes, then `loaded` is called. */
class TemplateFiles {
  /** By id; undefined where the file claiming it is no template this file reads. */
  private byId = new Map<string, unknown>();
  private state: 'unread' | 'reading' | 'read' = 'unread';
  /** A change heard while reading: read again once done. */
  private stale = false;
  private everRead = false;

  constructor(private readonly app: App, private readonly loaded: () => void) {}

  /**
   * The template with `id`: null when no file claims it, undefined until the vault's templates were first read or
   * where the file claiming it cannot be read as a template (never "missing": that would show every field).
   */
  get(id: string): unknown {
    if (this.state === 'unread') this.reload();
    if (!this.everRead) return undefined;
    return this.byId.has(id) ? this.byId.get(id) : null;
  }

  reload(): void {
    if (this.state === 'reading') {
      this.stale = true;
      return;
    }
    this.state = 'reading';
    void this.read().then((byId) => {
      this.byId = byId;
    }, (error: unknown) => {
      console.warn('[Atlas VTT Connect] Could not read the Atlas statblock templates:', error);
    }).finally(() => {
      this.state = 'read';
      this.everRead = true;
      if (this.stale) {
        this.stale = false;
        this.reload();
      } else this.loaded();
    });
  }

  private async read(): Promise<Map<string, unknown>> {
    const files = this.app.vault.getFiles().filter((file) => file.extension === TEMPLATE_EXTENSION)
      // The lowest path wins, by code units as Atlas compares them.
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const byId = new Map<string, unknown>();
    for (const file of files) {
      try {
        const template: unknown = JSON.parse(await this.app.vault.cachedRead(file));
        const id = templateId(template);
        const claimed = isObject(template) && typeof template.id === 'string' ? template.id.trim() : '';
        if (id && !byId.has(id)) byId.set(id, template);
        else if (claimed && !byId.has(claimed)) byId.set(claimed, undefined);
      } catch {
        // Not a template Atlas would read either.
      }
    }
    return byId;
  }
}

export function obsidianStatblocks(app: App): StatblockSource {
  const listeners = new Set<() => void>();
  const templates = new TemplateFiles(app, () => listeners.forEach((listener) => listener()));
  const frontmatterOf = (path: string): { file: TFile; frontmatter: Rec } | null => {
    const file = app.vault.getAbstractFileByPath(notePath(path));
    if (!(file instanceof TFile)) return null;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Rec | undefined;
    return frontmatter ? { file, frontmatter } : null;
  };
  const byTemplate = (path: string): TemplatedStatblock | null => {
    const note = frontmatterOf(path);
    const id = note?.frontmatter[TEMPLATE_KEY];
    if (!note || typeof id !== 'string' || !id.trim()) return null;
    return { atlasTemplate: id.trim(), template: templates.get(id.trim()), fields: { name: note.file.basename, ...note.frontmatter } };
  };
  const byPath = (path: string): unknown => {
    const statblocks = api();
    if (!resolved(statblocks)) return null;
    const creatures = statblocks.getBestiaryCreatures?.();
    if (!Array.isArray(creatures)) return null;
    return creatures.find((creature) => isObject(creature) && creature.path === path) ?? null;
  };
  const byFrontmatter = (path: string): unknown => {
    const note = frontmatterOf(path);
    if (!note || (note.frontmatter.statblock !== true && !Array.isArray(note.frontmatter.stats))) return null;
    return { name: note.file.basename, ...note.frontmatter };
  };
  const byName = (name: string): unknown => {
    const statblocks = api();
    if (!resolved(statblocks) || statblocks.hasCreature?.(name) !== true) return null;
    return statblocks.getCreatureFromBestiary?.(name) ?? null;
  };
  return {
    read(token: Character): unknown {
      const path = typeof token.statblockPath === 'string' ? token.statblockPath : '';
      const name = typeof token.statblockName === 'string' ? token.statblockName.trim() : '';
      // A templated note before its bestiary entry: Fantasy Statblocks indexes it too, without the template.
      return (path ? byTemplate(path) ?? byPath(path) ?? byFrontmatter(path) : null) ?? (name ? byName(name) : null);
    },
    onChange(listener: () => void): () => void {
      // Once a second at most: a note being typed in changes the cache on every keystroke.
      let timer: number | null = null;
      const changed = (): void => {
        if (timer !== null) return;
        timer = window.setTimeout(() => {
          timer = null;
          listener();
        }, 1000);
      };
      listeners.add(changed);
      const templateChanged = (file: unknown): void => {
        if (file instanceof TFile && file.extension === TEMPLATE_EXTENSION) templates.reload();
      };
      const vaultRefs: EventRef[] = [
        app.vault.on('create', templateChanged),
        app.vault.on('modify', templateChanged),
        app.vault.on('delete', templateChanged),
        app.vault.on('rename', (file, oldPath) => (oldPath.endsWith(`.${TEMPLATE_EXTENSION}`) ? templates.reload() : templateChanged(file))),
      ];
      const refs: EventRef[] = [
        app.metadataCache.on('changed', () => changed()),
        ...['fantasy-statblocks:bestiary:resolved', 'fantasy-statblocks:bestiary:updated'].map((name) => app.workspace.on(name as never, (() => changed()) as never)),
      ];
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        listeners.delete(changed);
        for (const ref of vaultRefs) app.vault.offref(ref);
        app.metadataCache.offref(refs[0]!);
        for (const ref of refs.slice(1)) app.workspace.offref(ref);
      };
    },
  };
}
