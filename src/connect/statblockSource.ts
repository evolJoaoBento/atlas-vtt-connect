/**
 * The stat block a token links, read as Atlas reads it (`resolveLinkedCreature` in Atlas): the Fantasy Statblocks
 * bestiary entry of the note (`window.FantasyStatblocks`, once its bestiary is resolved), else the note's own
 * frontmatter, else the bestiary creature of the token's statblock name. What comes back is the creature as is; the
 * player's sheet whitelists it (`tools/sheets.ts`).
 */
import { TFile, type App, type EventRef } from 'obsidian';
import type { Character } from '@atlas-vtt/api-types';
import type { StatblockSource } from '../app/online/atlas/toolParts';

interface FantasyStatblocksApi {
  isResolved?(): boolean;
  getBestiaryCreatures?(): unknown;
  hasCreature?(name: string): boolean;
  getCreatureFromBestiary?(name: string): unknown;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null;

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

export function obsidianStatblocks(app: App): StatblockSource {
  const byPath = (path: string): unknown => {
    const statblocks = api();
    if (!resolved(statblocks)) return null;
    const creatures = statblocks.getBestiaryCreatures?.();
    if (!Array.isArray(creatures)) return null;
    return creatures.find((creature) => isObject(creature) && creature.path === path) ?? null;
  };
  const byFrontmatter = (path: string): unknown => {
    const file = app.vault.getAbstractFileByPath(notePath(path));
    if (!(file instanceof TFile)) return null;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Rec | undefined;
    if (!frontmatter || (frontmatter.statblock !== true && !Array.isArray(frontmatter.stats) && frontmatter['atlas-template'] === undefined)) return null;
    return { name: file.basename, ...frontmatter };
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
      return (path ? byPath(path) ?? byFrontmatter(path) : null) ?? (name ? byName(name) : null);
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
      const refs: EventRef[] = [
        app.metadataCache.on('changed', () => changed()),
        ...['fantasy-statblocks:bestiary:resolved', 'fantasy-statblocks:bestiary:updated'].map((name) => app.workspace.on(name as never, (() => changed()) as never)),
      ];
      return () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
        app.metadataCache.offref(refs[0]!);
        for (const ref of refs.slice(1)) app.workspace.offref(ref);
      };
    },
  };
}
