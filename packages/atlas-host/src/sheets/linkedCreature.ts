/**
 * The stat block a token links, read as Atlas reads it (`resolveLinkedCreature` in Atlas's `creatures/linkedCreature.ts`):
 * a note made with an Atlas template (`atlas-template`) with that template, else the Fantasy Statblocks bestiary entry of
 * the note (`window.FantasyStatblocks`, once its bestiary is resolved), else the note's own frontmatter, else the
 * bestiary creature of the token's statblock name. What comes back is the creature as is; the sheet whitelists it
 * (`sheets.ts`, `templateSheets.ts`). Shared by Connect (which adds Atlas's card of the note) and Tabletop.
 *
 * `read` works from Obsidian's caches alone, as Connect's player sheets read it; `readNote` waits for the vault's
 * templates and also reads a note's ```statblock fence, as Tabletop's board did: the fence's fields with the
 * frontmatter laid over them, where the note has a fence or a frontmatter that says it is a stat block.
 *
 * Atlas keeps its templates as `.atlastemplate` files (JSON) anywhere in the vault, the lowest path winning where two
 * share an id (`TemplateLibrary`). They are read once, and again when one changes (`watchTemplates`).
 */
import { parseYaml, TFile, type App, type EventRef } from 'obsidian';
import { templateId, type TemplatedStatblock } from './templateSheets';

interface FantasyStatblocksApi {
  isResolved?(): boolean;
  getBestiaryCreatures?(): unknown;
  hasCreature?(name: string): boolean;
  getCreatureFromBestiary?(name: string): unknown;
}

/** What a token says of the stat block it links (Atlas's `Character` has both). */
export interface StatblockLink {
  statblockPath?: unknown;
  statblockName?: unknown;
}

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null;
const isRecord = (value: unknown): value is Rec => isObject(value) && !Array.isArray(value);

export const TEMPLATE_EXTENSION = 'atlastemplate';
const TEMPLATE_KEY = 'atlas-template';

function api(): FantasyStatblocksApi | null {
  const found = (window as unknown as { FantasyStatblocks?: unknown }).FantasyStatblocks;
  return isObject(found) ? found : null;
}

/** What the resolved bestiary gives; null while it is not resolved, and where the plugin throws. */
function fromBestiary(read: (statblocks: FantasyStatblocksApi) => unknown): unknown {
  const statblocks = api();
  try {
    if (statblocks?.isResolved?.() !== true) return null;
    return read(statblocks) ?? null;
  } catch {
    return null;
  }
}

/** The path of the note, without a heading (`note.md#Goblin`). */
export const notePath = (path: string): string => path.split('#')[0] ?? path;

/** The vault's Atlas templates by id; read on first use and after any template file changes, then `loaded` is called. */
export class TemplateFiles {
  /** By id; undefined where the file claiming it is no template this file reads. */
  private byId = new Map<string, unknown>();
  private state: 'unread' | 'reading' | 'read' = 'unread';
  /** A change heard while reading: read again once done. */
  private stale = false;
  private everRead = false;
  private waiting: Array<() => void> = [];

  constructor(private readonly app: App, private readonly loaded: () => void, private readonly label = 'Atlas host') {}

  /**
   * The template with `id`: null when no file claims it, undefined until the vault's templates were first read or
   * where the file claiming it cannot be read as a template (never "missing": that would show every field).
   */
  get(id: string): unknown {
    if (this.state === 'unread') this.reload();
    if (!this.everRead) return undefined;
    return this.byId.has(id) ? this.byId.get(id) : null;
  }

  /** Settles once the vault's templates were read for the first time. */
  whenRead(): Promise<void> {
    if (this.state === 'unread') this.reload();
    if (this.everRead) return Promise.resolve();
    return new Promise((resolve) => this.waiting.push(resolve));
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
      console.warn(`[${this.label}] Could not read the Atlas statblock templates:`, error);
    }).finally(() => {
      this.state = 'read';
      this.everRead = true;
      const waiting = this.waiting;
      this.waiting = [];
      for (const resolve of waiting) resolve();
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

export interface LinkedCreatureOptions {
  /** Called once the vault's templates were read, and after each reading again. */
  onTemplatesRead?(): void;
  /** Names the plugin in the console. */
  label?: string;
}

export interface LinkedCreatures {
  readonly templates: TemplateFiles;
  /** The stat block `token` links, from Obsidian's caches; a templated note's template is undefined until read. */
  read(token: StatblockLink): unknown;
  /** The stat block `token` links, once the vault's templates are read, a note's ```statblock fence read too. */
  readNote(token: StatblockLink): Promise<unknown>;
  /** The note at `path` with its template, where it names one (`atlas-template`). */
  templated(path: string): TemplatedStatblock | null;
  /** A statblock note's own fields: its ```statblock fence's, with its frontmatter laid over them; null for none. */
  noteFields(path: string): Promise<Rec | null>;
  /** Reads the templates again whenever a template file changes; returns the stop. */
  watchTemplates(): () => void;
}

const linkOf = (token: StatblockLink): { path: string; name: string } => ({
  path: typeof token.statblockPath === 'string' ? token.statblockPath : '',
  name: typeof token.statblockName === 'string' ? token.statblockName.trim() : '',
});

export function linkedCreatures(app: App, options: LinkedCreatureOptions = {}): LinkedCreatures {
  const templates = new TemplateFiles(app, () => options.onTemplatesRead?.(), options.label);
  const frontmatterOf = (path: string): { file: TFile; frontmatter: Rec } | null => {
    const file = app.vault.getAbstractFileByPath(notePath(path));
    if (!(file instanceof TFile)) return null;
    const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter as Rec | undefined;
    return frontmatter ? { file, frontmatter } : null;
  };
  const templated = (path: string): TemplatedStatblock | null => {
    const note = frontmatterOf(path);
    const id = note?.frontmatter[TEMPLATE_KEY];
    if (!note || typeof id !== 'string' || !id.trim()) return null;
    return { atlasTemplate: id.trim(), template: templates.get(id.trim()), fields: { name: note.file.basename, ...note.frontmatter } };
  };
  const byPath = (path: string): unknown => fromBestiary((statblocks) => {
    const creatures = statblocks.getBestiaryCreatures?.();
    return Array.isArray(creatures) ? creatures.find((creature) => isObject(creature) && creature.path === path) : null;
  });
  const byFrontmatter = (path: string): unknown => {
    const note = frontmatterOf(path);
    if (!note || (note.frontmatter.statblock !== true && !Array.isArray(note.frontmatter.stats))) return null;
    return { name: note.file.basename, ...note.frontmatter };
  };
  const byName = (name: string): unknown => fromBestiary((statblocks) => (statblocks.hasCreature?.(name) === true ? statblocks.getCreatureFromBestiary?.(name) : null));
  /** A note's ```statblock fence, its frontmatter and its name; null when it is no note. */
  const noteOf = async (path: string): Promise<{ name: string; front?: Rec; block?: Rec } | null> => {
    const file = app.vault.getAbstractFileByPath(notePath(path));
    if (!(file instanceof TFile)) return null;
    const front = app.metadataCache.getFileCache(file)?.frontmatter as Rec | undefined;
    let block: Rec | undefined;
    const match = /```statblock[^\n]*\n([\s\S]*?)```/.exec(await app.vault.cachedRead(file));
    if (match) {
      try {
        const parsed: unknown = parseYaml(match[1] ?? '');
        if (isRecord(parsed)) block = parsed;
      } catch {
        // A fence that is not YAML holds no fields.
      }
    }
    return { name: file.basename, ...(front ? { front } : {}), ...(block ? { block } : {}) };
  };
  const byNote = async (path: string): Promise<unknown> => {
    const note = await noteOf(path);
    // A note is a stat block with a fence, or frontmatter that says so (`statblock: true`, or stats).
    if (!note || !(note.block || note.front?.statblock === true || Array.isArray(note.front?.stats))) return null;
    return { name: note.name, ...note.block, ...note.front };
  };
  return {
    templates,
    read(token) {
      const { path, name } = linkOf(token);
      // A templated note before its bestiary entry: Fantasy Statblocks indexes it too, without the template.
      return (path ? templated(path) ?? byPath(path) ?? byFrontmatter(path) : null) ?? (name ? byName(name) : null);
    },
    async readNote(token) {
      const { path, name } = linkOf(token);
      if (path && frontmatterOf(path)?.frontmatter[TEMPLATE_KEY] !== undefined) await templates.whenRead();
      return (path ? templated(path) ?? byPath(path) ?? await byNote(path) : null) ?? (name ? byName(name) : null);
    },
    templated,
    async noteFields(path) {
      const note = await noteOf(path);
      return note && (note.front || note.block) ? { ...note.block, ...note.front } : null;
    },
    watchTemplates() {
      const changed = (file: unknown): void => {
        if (file instanceof TFile && file.extension === TEMPLATE_EXTENSION) templates.reload();
      };
      const refs: EventRef[] = [
        app.vault.on('create', changed),
        app.vault.on('modify', changed),
        app.vault.on('delete', changed),
        app.vault.on('rename', (file, oldPath) => (oldPath.endsWith(`.${TEMPLATE_EXTENSION}`) ? templates.reload() : changed(file))),
      ];
      return () => {
        for (const ref of refs) app.vault.offref(ref);
      };
    },
  };
}
