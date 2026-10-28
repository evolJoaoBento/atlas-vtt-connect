/**
 * A player's sheet of a stat block made with an Atlas template (`atlas-template` in its note): the note's values laid
 * out as the template lays them out, as the `PlayerSheet` the 5e sheet is (`sheets.ts`), so the join page and the
 * Obsidian scene tab show it and roll from it as they do any sheet.
 *
 * Only what the template shows reaches a player: a field the template does not name, an image, a script or a
 * reserved key never does. Every value lands in a section's items, so its rolls ("+2", "Attack: 1d6") are clicked and
 * found again as any roll in a trait's text is (`SheetRollRef` `text`). Patterns and fallbacks are not worked out: a
 * value shows as the note holds it. A built-in template (`builtin:`) lives in Atlas's code, out of reach: its stat
 * block reads as a 5e one. A template that cannot be found shows every field of the note, as Atlas's own stand-in
 * template does. A field the template hides from players (Atlas 0.9's `players`) never reaches them, nor a block
 * that shows one, as Atlas's own online play decides (`playerAccess.ts`).
 */
import { buildSheet, SHEET_LIMITS, text, type PlayerSheet, type SheetItem, type SheetSection } from './sheets';

type Rec = Record<string, unknown>;
const isObject = (value: unknown): value is Rec => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A stat block read from a note with `atlas-template`: its frontmatter, and its template when one was found. */
export interface TemplatedStatblock {
  atlasTemplate: string;
  /** The parsed `.atlastemplate` file; null when none has that id (or it is a built-in); undefined while the vault's templates are being read or where its file cannot be read. */
  template: unknown;
  fields: Rec;
}

export function isTemplatedStatblock(value: unknown): value is TemplatedStatblock {
  return isObject(value) && typeof value.atlasTemplate === 'string' && isObject(value.fields);
}

/** A parsed `.atlastemplate`: its id, when it is one Atlas would read. */
export function templateId(value: unknown): string | null {
  if (!isObject(value) || value.format !== 'atlas-statblock-template' || typeof value.id !== 'string' || !value.id.trim()) return null;
  if (!Array.isArray(value.fields) || !isObject(value.layout) || !Array.isArray(value.layout.blocks)) return null;
  return value.id.trim();
}

const BUILT_IN_PREFIX = 'builtin:';
/** Keys that are never a stat block's content (Atlas's `IGNORED_FIELDS` and `reservedKeys.ts`), `name` aside. */
const RESERVED = new Set(['image', 'token-image', 'token', 'statblock', 'statblock-link', 'layout', 'path', 'extends', 'bestiary', 'note',
  'columns', 'mtime', 'monster', 'creature', 'aliases', 'cssclasses', 'cssclass', 'player', 'position', 'atlas-type', 'atlas-template', 'tags']);
/** Fields whose value is never text a player reads. */
const UNSHOWN_TYPES = new Set(['image']);
/** How deep sections, rows and tabs nest before the rest is left out. */
const MAX_DEPTH = 8;
const LABEL = 40;

interface Field {
  key: string;
  label: string;
  type: string;
  meaning?: string;
  formerKeys: string[];
  unit?: string;
  entry?: { nameKey?: string; textKey?: string; extras?: Array<{ key: string; label: string }> };
  slots?: string[];
}

function fieldsOf(template: Rec): Map<string, Field> {
  const found = new Map<string, Field>();
  for (const raw of Array.isArray(template.fields) ? template.fields : []) {
    if (!isObject(raw) || typeof raw.key !== 'string' || !raw.key || found.has(raw.key) || RESERVED.has(raw.key)) continue;
    const entry = isObject(raw.entry) ? raw.entry : null;
    found.set(raw.key, {
      key: raw.key,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label : raw.key,
      type: typeof raw.type === 'string' ? raw.type : 'text',
      ...(typeof raw.meaning === 'string' ? { meaning: raw.meaning } : {}),
      formerKeys: Array.isArray(raw.formerKeys) ? raw.formerKeys.filter((key): key is string => typeof key === 'string') : [],
      ...(typeof raw.unit === 'string' && raw.unit.trim() ? { unit: raw.unit.trim() } : {}),
      ...(entry ? {
        entry: {
          ...(typeof entry.nameKey === 'string' ? { nameKey: entry.nameKey } : {}),
          ...(typeof entry.textKey === 'string' ? { textKey: entry.textKey } : {}),
          extras: (Array.isArray(entry.extras) ? entry.extras : [])
            .filter((extra): extra is { key: string; label: string } => isObject(extra) && typeof extra.key === 'string' && typeof extra.label === 'string'),
        },
      } : {}),
      ...(Array.isArray(raw.slots) ? { slots: raw.slots.filter((slot): slot is string => typeof slot === 'string') } : {}),
    });
  }
  return found;
}

/** What a player may do with a field (Atlas 0.9's `PlayerAccess`, `StatblockTemplate.players`). */
type PlayerAccess = 'edit' | 'read' | 'hidden';
const PLAYER_ACCESS: ReadonlySet<unknown> = new Set(['edit', 'read', 'hidden']);

/**
 * Whether players may never see `field`, as Atlas's own online play decides (`playerAccess` in `playerAccess.ts`):
 * the name, the display name and images are always read; else the setting the template stores under the field's
 * key, then under a key it had before, newest first, a setting this does not know counting as hidden; a spell list
 * is hidden only where so set; without a setting, nothing is hidden.
 */
function hiddenFrom(template: Rec, field: Field): boolean {
  if (field.key === 'name' || field.type === 'image' || field.meaning === 'display-name') return false;
  const players = isObject(template.players) ? template.players : null;
  if (!players) return false;
  for (const key of [field.key, ...field.formerKeys]) {
    if (!Object.hasOwn(players, key)) continue;
    const stored = players[key];
    const access: PlayerAccess = PLAYER_ACCESS.has(stored) ? stored as PlayerAccess : 'hidden';
    return access === 'hidden';
  }
  return false;
}

/**
 * Whether a template hides any field from players (Atlas 0.9's `players`): Atlas's own card shows every field, so a
 * player gets the text sheet, which leaves them out, in its place.
 */
export function templateHidesFields(template: unknown): boolean {
  if (!isObject(template) || !isObject(template.players)) return false;
  return Object.values(template.players).some((access) => access !== 'edit' && access !== 'read');
}

const signed = (value: number): string => (value >= 0 ? `+${value}` : String(value));
const formatNumber = (value: number): string => (Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100));

/** A value on one line, as Atlas's `valueText` writes it: lists with commas, records as "key value". */
function valueText(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > 3) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? formatNumber(value) : '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((item) => valueText(item, depth + 1)).filter(Boolean).join(', ');
  if (isObject(value)) return Object.entries(value).map(([key, item]) => [key, valueText(item, depth + 1)].filter(Boolean).join(' ')).filter(Boolean).join(', ');
  return '';
}

const present = (value: unknown): boolean => value !== null && value !== undefined && value !== ''
  && !(Array.isArray(value) && value.length === 0) && !(isObject(value) && Object.keys(value).length === 0);

/** Builds the sections of a sheet, keeping to the limits a page checks: what does not fit is left out. */
class SheetSections {
  readonly sections: SheetSection[] = [];
  private current: SheetSection | null = null;

  /** Starts a section; one already holding nothing takes the new title instead. */
  open(title: string): void {
    const cut = text(title, LABEL) ?? '';
    if (this.current && this.current.items.length === 0) {
      this.current = { title: cut, items: [] };
      this.sections[this.sections.length - 1] = this.current;
      return;
    }
    if (this.sections.length >= SHEET_LIMITS.sections) {
      this.current = null;
      return;
    }
    this.current = { title: cut, items: [] };
    this.sections.push(this.current);
  }

  add(name: string, desc: string, rollable = false): void {
    const item: SheetItem = { name: text(name, SHEET_LIMITS.name) ?? '', desc: text(desc, SHEET_LIMITS.desc) ?? '' };
    if (rollable) item.rollable = true;
    if (!item.name && !item.desc) return;
    if (!this.current) {
      if (this.sections.length > 0) return;
      this.open('');
    }
    if (this.current && this.current.items.length < SHEET_LIMITS.items) this.current.items.push(item);
  }

  finish(): SheetSection[] {
    return this.sections.filter((section) => section.items.length > 0);
  }
}

/** Reads a note's values by the template's fields: a field's key, else the first of its former keys the note has. */
class Values {
  constructor(private readonly record: Rec, private readonly fields: Map<string, Field>, private readonly hidden: (field: Field) => boolean = () => false) {}

  field(key: unknown): Field | null {
    return typeof key === 'string' ? this.fields.get(key) ?? null : null;
  }

  /** Whether `key` names a field the template hides from players. */
  hides(key: unknown): boolean {
    const field = this.field(key);
    return field !== null && this.hidden(field);
  }

  /** A field's value; nothing for a key the template does not name, a field never shown as text or one hidden from players. */
  read(key: unknown): unknown {
    return this.hides(key) ? undefined : this.condition(key);
  }

  /** A field's value as a block's condition reads it: the GM works it out, also from a field hidden from players. */
  condition(key: unknown): unknown {
    const field = this.field(key);
    if (!field || UNSHOWN_TYPES.has(field.type)) return undefined;
    for (const candidate of [field.key, ...field.formerKeys]) {
      if (Object.hasOwn(this.record, candidate) && present(this.record[candidate])) return this.record[candidate];
    }
    return undefined;
  }

  /** A field's value on one line, signed where asked, with a number's unit ("30 ft."). */
  text(key: unknown, sign = false): string {
    const value = this.read(key);
    const field = this.field(key);
    if (sign && typeof value === 'number' && Number.isFinite(value)) return signed(value);
    const shown = valueText(value);
    return shown && field?.unit && typeof value === 'number' ? `${shown} ${field.unit}` : shown;
  }
}

/** Whether a block's `showWhen` lets it show (Atlas's `Condition`); one it does not know shows. */
function shows(block: Rec, values: Values): boolean {
  const condition = block.showWhen;
  if (!isObject(condition)) return true;
  const value = values.condition(condition.field);
  switch (condition.is) {
    case 'present': return present(value);
    case 'absent': return !present(value);
    case 'equal': return valueText(value) === valueText(condition.value);
    case 'not-equal': return valueText(value) !== valueText(condition.value);
    case 'above': return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;
    case 'below': return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;
    default: return true;
  }
}

/** The items of an entries field ("Features"): its name and text keys, its extras before the text ("Range: Close"). */
function addEntries(out: SheetSections, value: unknown, field: Field): void {
  const nameKey = field.entry?.nameKey ?? 'name';
  const textKey = field.entry?.textKey ?? 'desc';
  for (const entry of Array.isArray(value) ? value : []) {
    if (!isObject(entry)) {
      out.add('', valueText(entry));
      continue;
    }
    const extras = (field.entry?.extras ?? [])
      .map((extra) => [extra.label, valueText(entry[extra.key])] as const)
      .filter(([, shown]) => shown)
      .map(([label, shown]) => `${label}: ${shown}`);
    const desc = valueText(entry[textKey] ?? (textKey === 'desc' ? entry.text ?? entry.description : entry.desc));
    out.add(valueText(entry[nameKey]), [extras.length > 0 ? `(${extras.join('; ')})` : '', desc].filter(Boolean).join(' '));
  }
}

/** A Table's rows: one line each, its cells after their column's name. */
function tableText(value: unknown, field: Field): string[] {
  const slots = field.slots ?? [];
  const row = (cells: unknown): string => {
    if (Array.isArray(cells)) return cells.map((cell, index) => [slots[index] ?? '', valueText(cell)].filter(Boolean).join(' ')).filter(Boolean).join(', ');
    return valueText(cells);
  };
  if (Array.isArray(value) && value.some(Array.isArray)) return value.map(row).filter(Boolean);
  const one = row(value);
  return one ? [one] : [];
}

/** Blocks a hidden field never hides whole: containers decide block by block, a Metric number by number. */
const CONTAINERS = new Set(['section', 'tabs', 'row', 'metric']);

/**
 * Whether a block shows a field hidden from players (Atlas's `readsHiddenField`), which hides it whole: its fields, a
 * Stat's dice and a list's intro. A Metric's numbers are left out one by one and a Section's heading field alone.
 */
function showsHidden(block: Rec, values: Values): boolean {
  if (typeof block.type === 'string' && CONTAINERS.has(block.type)) return false;
  const keys = [block.field, ...(Array.isArray(block.fields) ? (block.fields as unknown[]) : []), block.rollFrom, block.introField];
  return keys.some((key) => values.hides(key));
}

function addBlocks(blocks: unknown, values: Values, out: SheetSections, depth: number): void {
  if (!Array.isArray(blocks) || depth > MAX_DEPTH) return;
  for (const block of blocks) {
    if (!isObject(block) || showsHidden(block, values) || !shows(block, values)) continue;
    const field = values.field(block.field);
    const label = (fallback?: string): string => (typeof block.label === 'string' && block.label.trim() ? block.label : field?.label ?? fallback ?? '');
    switch (block.type) {
      case 'section':
      case 'tabs': {
        const heading = typeof block.heading === 'string' && block.heading.trim() ? block.heading : values.text(block.headingField);
        if (heading) out.open(heading);
        addBlocks(block.blocks, values, out, depth + 1);
        break;
      }
      case 'row':
        addBlocks(block.blocks, values, out, depth + 1);
        break;
      case 'heading':
        if (typeof block.text === 'string') out.open(block.text);
        break;
      case 'title':
        // The name already heads the sheet.
        if (block.field !== 'name') out.add('', values.text(block.field));
        break;
      case 'line': {
        const parts = (Array.isArray(block.fields) ? block.fields : []).map((key) => values.text(key)).filter(Boolean);
        out.add('', parts.join(typeof block.separator === 'string' ? block.separator : ', '));
        break;
      }
      case 'stat': {
        let shown = values.text(block.field, block.display === 'signed');
        // The dice it is rolled from where the value shows none ("45" rolled from "7d10 + 7").
        const dice = values.text(block.rollFrom);
        if (shown && dice && !/\d*d\d+/i.test(shown)) shown = `${shown} (${dice})`;
        if (shown) out.add(label(), shown, block.rollable === true);
        break;
      }
      case 'metric': {
        const numbers = (Array.isArray(block.fields) ? block.fields : [])
          .map((key) => [values.field(key)?.label ?? '', values.text(key)] as const)
          .filter(([, shown]) => shown)
          .map(([name, shown]) => [name, shown].filter(Boolean).join(' '));
        if (numbers.length > 0) out.add(typeof block.heading === 'string' ? block.heading : '', numbers.join(' | '), block.rollable === true);
        break;
      }
      case 'tags':
      case 'pairs': {
        const value = values.read(block.field);
        const shown = block.type === 'pairs' && block.display === 'signed' && isObject(value)
          ? Object.entries(value).map(([key, bonus]) => `${key} ${typeof bonus === 'number' ? signed(bonus) : valueText(bonus)}`).join(', ')
          : values.text(block.field);
        if (shown) out.add(label(), shown, block.type === 'pairs' && block.rollable === true);
        break;
      }
      case 'text': {
        const shown = block.field === undefined ? (typeof block.text === 'string' ? block.text : '') : values.text(block.field);
        if (shown) out.add(typeof block.heading === 'string' ? block.heading : '', shown);
        break;
      }
      case 'scores':
        if (field) for (const line of tableText(values.read(block.field), field)) out.add(field.label, line, block.rollable === true);
        break;
      case 'entries':
      case 'spells': {
        const value = values.read(block.field);
        if (!field || !present(value)) break;
        out.open(typeof block.heading === 'string' && block.heading.trim() ? block.heading : field.label);
        const intro = values.text(block.introField);
        if (intro) out.add('', intro);
        if (block.type === 'entries') addEntries(out, value, field);
        else for (const group of Array.isArray(value) ? value : [value]) {
          if (isObject(group)) for (const [level, spells] of Object.entries(group)) out.add(level, valueText(spells));
          else out.add('', valueText(group));
        }
        // What follows stands outside the list, under no heading of its own.
        out.open('');
        break;
      }
      case 'track': {
        // A token resource's track reaches the player as that resource's gauge; any other shows its number.
        const shown = typeof block.resource === 'string' && block.resource ? '' : values.text(block.field);
        if (shown) out.add(label(), shown);
        break;
      }
      // Images, dividers, scripts and blocks this file does not know show nothing.
      default:
        break;
    }
  }
}

/** The key the header shows a part from: the field meant for it, else Atlas's own key (`headerKey`). */
function headerKey(fields: Map<string, Field>, meaning: string, key: string): string {
  return [...fields.values()].find((field) => field.meaning === meaning)?.key ?? key;
}

/** A player's sheet of a note laid out by `template`; null when it has no name. */
export function buildTemplateSheet(template: unknown, record: Rec, fallbackName: string | null = null): PlayerSheet | null {
  if (!isObject(template) || !isObject(template.layout)) return null;
  const fields = fieldsOf(template);
  // The header's parts read their own keys even where the template's fields leave them out.
  for (const [key, label, type, meaning] of [['level', 'Level', 'rating', 'rating'], ['type', 'Type', 'text', 'creature-type'], ['hp', 'HP', 'number', 'hit-points'], ['description', 'Description', 'markdown', 'description']] as const) {
    if (!fields.has(key) && ![...fields.values()].some((field) => field.meaning === meaning)) fields.set(key, { key, label, type, meaning, formerKeys: [] });
  }
  const values = new Values(record, fields, (field) => hiddenFrom(template, field));
  const displayKey = [...fields.values()].find((field) => field.meaning === 'display-name')?.key;
  const name = (displayKey ? text(values.read(displayKey), SHEET_LIMITS.name) : null) ?? text(record.name, SHEET_LIMITS.name) ?? fallbackName;
  if (!name) return null;
  const hidden = new Set(isObject(template.header) && Array.isArray(template.header.hidden) ? template.header.hidden : []);
  const headerPart = (id: string, meaning: string, key: string): { label: string; text: string } | null => {
    if (hidden.has(id)) return null;
    const field = values.field(headerKey(fields, meaning, key));
    const shown = field ? values.text(field.key) : '';
    return field && shown ? { label: field.label, text: shown } : null;
  };
  const level = headerPart('level', 'rating', 'level');
  const type = headerPart('type', 'creature-type', 'type');
  const subtitle = text([level ? `${level.label} ${level.text}` : '', type?.text ?? ''].filter(Boolean).join(' · '), SHEET_LIMITS.short);

  const out = new SheetSections();
  const hp = headerPart('hp', 'hit-points', 'hp');
  // The hit dice beside the hit points roll them, as on Atlas's card.
  // The hit dice keep to what the template lets players see of them, named as a field or not.
  const hitDice = hiddenFrom(template, values.field('hit_dice') ?? { key: 'hit_dice', label: '', type: 'text', formerKeys: [] }) ? '' : valueText(record.hit_dice);
  if (hp) out.add(hp.label, [hp.text, hitDice ? `(${hitDice})` : ''].filter(Boolean).join(' '));
  const description = headerPart('description', 'description', 'description');
  if (description) out.add('', description.text);
  addBlocks(template.layout.blocks, values, out, 0);
  return { name, subtitle, ac: null, hp: null, speed: null, stats: null, saves: [], skills: [], lines: [], sections: out.finish() };
}

/** Words of a key, for a field no template names: `motives_tactics` → "Motives tactics". */
function keyLabel(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Every field of a note whose template cannot be found, as Atlas's stand-in template shows them: lists of named
 * entries as sections of their own, everything else as one line under its key.
 */
export function buildUntemplatedSheet(record: Rec, fallbackName: string | null = null): PlayerSheet | null {
  const name = text(record.name, SHEET_LIMITS.name) ?? fallbackName;
  if (!name) return null;
  const out = new SheetSections();
  const lists: Array<[string, unknown[]]> = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === 'name' || RESERVED.has(key) || !present(value)) continue;
    if (Array.isArray(value) && value.some((entry) => isObject(entry) && ('name' in entry || 'desc' in entry || 'text' in entry))) lists.push([key, value]);
    else out.add(keyLabel(key), valueText(value));
  }
  for (const [key, list] of lists) {
    out.open(keyLabel(key));
    addEntries(out, list, { key, label: keyLabel(key), type: 'entries', formerKeys: [] });
  }
  return { name, subtitle: null, ac: null, hp: null, speed: null, stats: null, saves: [], skills: [], lines: [], sections: out.finish() };
}

/** A player's sheet of whatever a token links: a template's stat block, or Fantasy Statblocks' creature (5e keys). */
export function buildPlayerSheet(statblock: unknown, fallbackName: string | null = null): PlayerSheet | null {
  if (!isTemplatedStatblock(statblock)) return buildSheet(statblock, fallbackName);
  if (statblock.atlasTemplate.startsWith(BUILT_IN_PREFIX)) return buildSheet(statblock.fields, fallbackName);
  // A template not read (yet): the name alone, never every field of a note whose template hides some.
  if (statblock.template === undefined) return buildUntemplatedSheet({ name: statblock.fields.name }, fallbackName);
  return statblock.template
    ? buildTemplateSheet(statblock.template, statblock.fields, fallbackName)
    : buildUntemplatedSheet(statblock.fields, fallbackName);
}
