/**
 * The game system presets a stock Atlas VTT's collections may be set from, as far as Connect reads them: the initiative
 * rules a collection follows while it stores none of its own (Atlas's `collectionInitiativeRules` with `systemPresetsOf`,
 * which Atlas 0.21's players' list reads too, so players see sides on a preset's map before the fight).
 *
 * - Atlas's built-in presets that set initiative rules (`gameSystems/presets/*.ts` in Atlas 0.21): Cairn and OSE by
 *   sides, Cyberpunk RED, D&D 5e and Pathfinder 2e in turn order. The others (Call of Cthulhu, Daggerheart, Draw Steel,
 *   Shadowdark) set none and read as the default.
 * - The user's presets: one JSON file each in `atlas-vtt/system-presets` or a folder below (`presetFiles.ts`), the
 *   record's `id`, `name` and `rules` at the top; the first file of an id (by path) holds it. Read once and again when a
 *   file there changes.
 */
import type { App, EventRef, TAbstractFile } from 'obsidian';

export const SYSTEM_PRESET_FOLDER = 'atlas-vtt/system-presets';
const BUILT_IN_ID_PREFIX = 'builtin:';

/** Atlas 0.21's built-in presets' initiative rules, by preset id. */
const BUILT_IN_INITIATIVE: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  'builtin:cairn': { mode: 'sides', roll: '1d20', firstSide: 'players' },
  'builtin:cyberpunkred': { mode: 'turn-order', roll: '1d10', firstSide: 'players' },
  'builtin:dnd5e': { mode: 'turn-order', roll: '1d20', firstSide: 'players', modifier: { field: 'initiative' }, modifierFallback: { field: 'stats.1', abilityScore: true } },
  'builtin:pathfinder2e': { mode: 'turn-order', roll: '1d20', firstSide: 'players', modifier: { field: 'initiative' } },
  'builtin:ose': { mode: 'sides', roll: '1d20', firstSide: 'players', sideRoll: '1d6' },
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The id and initiative rules (as stored) of the preset a file's text holds; null for one that is not a user's preset. */
export function readUserPreset(text: string): { id: string; initiative: unknown } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw) || typeof raw.id !== 'string' || raw.id.trim() === '' || raw.id.startsWith(BUILT_IN_ID_PREFIX)) return null;
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null;
  return { id: raw.id, initiative: isObject(raw.rules) ? raw.rules.initiative : undefined };
}

/** The initiative rules of every preset of the files, by id: the first file (by path) of an id holds it. */
export function userPresetInitiative(files: ReadonlyArray<{ path: string; text: string }>): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  for (const { text } of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const preset = readUserPreset(text);
    if (preset && !byId.has(preset.id)) byId.set(preset.id, preset.initiative);
  }
  return byId;
}

const inFolder = (path: string): boolean => path.startsWith(`${SYSTEM_PRESET_FOLDER}/`);

/** The vault's presets, read at once and again whenever a file in the presets folder changes. */
export class StockPresets {
  private user = new Map<string, unknown>();
  private readonly refs: EventRef[] = [];
  private reading: Promise<void> | null = null;
  private again = false;

  constructor(private readonly app: App) {
    const vault = app.vault as Partial<App['vault']> | undefined;
    if (typeof vault?.on === 'function') {
      const heard = (file: TAbstractFile, old?: string): void => { if (inFolder(file.path) || (old !== undefined && inFolder(old))) this.read(); };
      this.refs.push(
        app.vault.on('create', (file) => heard(file)),
        app.vault.on('modify', (file) => heard(file)),
        app.vault.on('delete', (file) => heard(file)),
        app.vault.on('rename', (file, old) => heard(file, old)),
      );
    }
    this.read();
  }

  /** The initiative rules (as stored) of the preset `id` names: a built-in's, else one of the user's; undefined for none. */
  initiativeOf(id: unknown): unknown {
    if (typeof id !== 'string') return undefined;
    return Object.hasOwn(BUILT_IN_INITIATIVE, id) ? BUILT_IN_INITIATIVE[id] : this.user.get(id);
  }

  dispose(): void {
    for (const ref of this.refs) this.app.vault.offref(ref);
    this.refs.length = 0;
  }

  private read(): void {
    if (this.reading) { this.again = true; return; }
    this.reading = this.load().catch(() => undefined).finally(() => {
      this.reading = null;
      if (this.again) { this.again = false; this.read(); }
    });
  }

  private async load(): Promise<void> {
    const adapter = this.app.vault?.adapter;
    if (!adapter) return;
    const files: Array<{ path: string; text: string }> = [];
    const walk = async (folder: string): Promise<void> => {
      if (!(await adapter.exists(folder))) return;
      const listed = await adapter.list(folder);
      for (const path of listed.files) {
        if (!path.toLowerCase().endsWith('.json')) continue;
        try { files.push({ path, text: await adapter.read(path) }); } catch { /* unreadable just now: the others count */ }
      }
      for (const sub of listed.folders) await walk(sub);
    };
    await walk(SYSTEM_PRESET_FOLDER);
    this.user = userPresetInitiative(files);
  }
}
