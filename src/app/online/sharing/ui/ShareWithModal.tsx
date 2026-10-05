/**
 * "Share with…" for a note or a map: tick people or everyone in my sessions; for a map also
 * player-safe or full and its linked notes. Notes keep their share in `atlas-share` (written,
 * then read back), maps on their scene record. Full asks first.
 */
import React from 'react';
import { Modal, Notice, TFile, type App } from 'obsidian';
import type { ScenesApi } from '@atlas-vtt/api-types';
import { createRoot, type Root } from 'react-dom/client';
import { confirmAction } from '../../../ui/confirmDialog';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../../../ui/nativeModal';
import { randomId } from '../../ids';
import type { PeopleBook } from '../people/PeopleBook';
import { keyOf } from '../people/peopleTypes';
import { placeholderKey } from '../people/placeholderTypes';
import { LIT_MAP_NOT_PLAYER_SAFE, readSharedMapOrError, UNREADABLE_MAP } from '../model/buildMapPayload';
import { offeredNotes } from '../model/linkedNotes';
import { mapShareOf, writeMapShare, type MapShare } from '../model/mapShare';
import { partProblemsInNote, unknownNamesIn, unlinkedExceptNames } from '../model/noteFilter';
import type { SenderCatalogue } from '../model/SenderCatalogue';
import { formatShareRule, parseShareRule, SHARE_PROPERTY, unknownRuleNames } from '../model/shareRule';
import { writeNoteShare } from '../model/shareWriting';
import { trustedSections, type SectionTrust } from '../model/sectionTrust';
import { partError, partWarnings } from './partWarnings';
import { unlinkedExceptWarning, unlinkedMapWarnings } from './unlinkedWarnings';
import { ShareWithForm, type ShareFormResult, type ShareRow } from './ShareWithForm';

export const SHARE_DIALOG_TITLE = 'Share with';
const FULL_CONFIRM = {
  title: 'Share the full map?',
  message: ['A full share sends everything on this map, as a co-GM would see it: hidden tokens, GM-only pins, walls and lights.'],
  confirmLabel: 'Share full map',
};
export const REMOVED_PERSON_LABEL = 'Removed or unknown person';
export const MAP_UNREADABLE_TEXT = "This map couldn't be read.";
export const PART_HINT = 'To keep part of this note back, select it and right-click: Share part.';

export interface ShareWithDeps {
  people: PeopleBook;
  catalogue: Pick<SenderCatalogue, 'previewNote' | 'previewNoteAsPlaceholder'>;
  /** Atlas's scenes: the map's scene record, its share and the saved map. */
  scenes: Pick<ScenesApi, 'findByMap' | 'getData' | 'setData' | 'readMap'>;
  /** This Atlas's person id at a table (`gm` at its own), for the preview's tags; undefined when unknown. */
  selfAt: (tableId: string) => string | undefined;
  /** What the metadata cache parsed (`SectionTrust`), so the warnings read the sections the filter would. */
  sections: SectionTrust;
}

const nameKey = (name: string): string => `name:${name}`;

class ShareWithModal extends Modal {
  private root: Root | null = null;

  constructor(app: App, private readonly file: TFile, private readonly deps: ShareWithDeps) {
    super(app);
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES, 'atlas-share-modal');
  }

  onOpen(): void {
    this.setTitle(`${SHARE_DIALOG_TITLE} · ${this.file.basename}`);
    this.root = createRoot(this.contentEl);
    void this.render();
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
    this.contentEl.empty();
  }

  private async render(): Promise<void> {
    await this.deps.people.ready();
    const { people } = this.deps;
    const known: ShareRow[] = [
      ...people.list().map((person) => ({ key: keyOf(person), name: person.name, known: true })),
      ...people.placeholders().map((placeholder) => ({ key: placeholderKey(placeholder.id), name: placeholder.name, known: true, placeholder: true })),
    ];
    if (this.file.extension === 'md') await this.renderNote(known);
    else await this.renderMap(known);
  }

  /** What the sender should know before saving: names the list lacks and parts that could not be read; and why the note is not shared, if it is not. */
  private async noteWarnings(unknownInRule: readonly string[], unreadableRule: boolean): Promise<{ warnings: string[]; error: string | null }> {
    const text = await this.app.vault.cachedRead(this.file);
    const unknown = [...new Set([...unknownInRule, ...unknownNamesIn(text, this.deps.people)])].sort();
    const problems = partProblemsInNote(text, trustedSections(this.app, this.deps.sections, this.file, text));
    const warnings = [
      ...(unreadableRule ? [`An entry in the ${SHARE_PROPERTY} property could not be read, so this note is private. Save to write it again.`] : []),
      ...(unknown.length ? [`Not in your people list: ${unknown.join(', ')}.`] : []),
      ...unlinkedExceptNames(text, this.deps.people).map((name) => unlinkedExceptWarning(name)),
      ...partWarnings(problems),
    ];
    return { warnings, error: partError(problems) };
  }

  private async renderNote(known: ShareRow[]): Promise<void> {
    const rule = parseShareRule(this.app.metadataCache.getFileCache(this.file)?.frontmatter?.[SHARE_PROPERTY]);
    const people = this.deps.people;
    const keyFor = (name: string): string => {
      const person = people.byName(name);
      const placeholder = person ? null : people.placeholderByName(name);
      return person ? keyOf(person) : placeholder ? placeholderKey(placeholder.id) : nameKey(name);
    };
    const unknown = unknownRuleNames(rule, people);
    const rows: ShareRow[] = [...known, ...unknown.map((name) => ({ key: nameKey(name), name, known: false }))];
    const nameFor = (key: string): string => rows.find((row) => row.key === key)?.name ?? key.replace(/^name:/, '');
    const { warnings, error } = await this.noteWarnings(unknown, rule.unreadable === true);
    this.root?.render(
      <ShareWithForm
        rows={rows}
        initial={{ everyone: rule.public && !rule.private, people: rule.private ? [] : rule.only.map(keyFor), except: rule.except.map(keyFor) }}
        map={null}
        warnings={warnings}
        {...(error ? { error } : {})}
        hint={PART_HINT}
        preview={(key) => {
          const person = people.byKey(key);
          if (person) return this.deps.catalogue.previewNote({ tableId: person.tableId, personId: person.personId }, this.file.path, this.deps.selfAt(person.tableId));
          const placeholder = rows.find((row) => row.key === key && row.placeholder);
          return placeholder ? this.deps.catalogue.previewNoteAsPlaceholder(placeholder.name, this.file.path).then((text) => text ?? '') : Promise.resolve('');
        }}
        onCancel={() => this.close()}
        onSave={(result) => { void this.saveNote(result, nameFor); }}
      />,
    );
  }

  private async saveNote(result: ShareFormResult, nameFor: (key: string) => string): Promise<void> {
    const value = formatShareRule({ everyone: result.everyone, people: result.people.map(nameFor), except: result.except.map(nameFor) });
    const readBack = await writeNoteShare(this.app, this.file, value);
    const expected = parseShareRule(value);
    if (JSON.stringify(readBack) !== JSON.stringify(expected)) new Notice(`The note's ${SHARE_PROPERTY} property now reads differently; check it.`);
    this.close();
  }

  private async renderMap(known: ShareRow[]): Promise<void> {
    const scene = await this.deps.scenes.findByMap(this.file.path);
    const source = scene ? await readSharedMapOrError(this.deps.scenes, this.file.path) : null;
    if (source === UNREADABLE_MAP) {
      new Notice(MAP_UNREADABLE_TEXT);
      this.close();
      return;
    }
    if (!scene || !source) {
      new Notice('This map has no scene in a collection, so it cannot be shared.');
      this.close();
      return;
    }
    const share = await mapShareOf(this.deps.scenes, scene.id);
    const notes = offeredNotes(source.map, 'full').map((note) => {
      const file = this.app.vault.getAbstractFileByPath(note.path);
      const property: unknown = file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter?.[SHARE_PROPERTY] : undefined;
      return { path: note.path, label: note.label, private: parseShareRule(property).private, hidden: note.hidden };
    });
    // Stored keys follow their person or placeholder (a rename, a link, a merge); one that resolves to nobody stays a row to untick.
    const { people } = this.deps;
    const current = (keys: readonly string[]): string[] => [...new Set(keys.map((key) => people.currentKey(key) ?? key))];
    const stale = [...new Set([...(share?.people ?? []), ...(share?.except ?? [])].filter((key) => people.currentKey(key) === null))];
    const rows: ShareRow[] = [...known, ...stale.map((key) => ({ key, name: REMOVED_PERSON_LABEL, known: false }))];
    this.root?.render(
      <ShareWithForm
        rows={rows}
        initial={{ everyone: share?.everyone ?? false, people: current(share?.people ?? []), except: current(share?.except ?? []) }}
        map={{ mode: share?.mode ?? 'player-safe', notes, ticked: share?.notes ?? [], ...(source.lit && { playerSafeRefused: LIT_MAP_NOT_PLAYER_SAFE }) }}
        preview={null}
        warnings={unlinkedMapWarnings(share?.except ?? [], people)}
        onCancel={() => this.close()}
        onSave={(result) => { void this.saveMap(scene.id, share, result, source.lit); }}
      />,
    );
  }

  private async saveMap(sceneId: string, previous: MapShare | null, result: ShareFormResult, lit: boolean): Promise<void> {
    if (lit && result.mode === 'player-safe') {
      new Notice(LIT_MAP_NOT_PLAYER_SAFE);
      return;
    }
    if (result.mode === 'full' && previous?.mode !== 'full' && !(await confirmAction(FULL_CONFIRM))) return;
    const nobody = !result.everyone && result.people.length === 0;
    const next: MapShare | null = nobody ? null : {
      item: previous?.item ?? randomId(), everyone: result.everyone, people: result.people, except: result.except, mode: result.mode,
      notes: result.notes,
    };
    await writeMapShare(this.deps.scenes, sceneId, next);
    this.close();
  }
}

export function openShareWithModal(app: App, file: TFile, deps: ShareWithDeps): void {
  new ShareWithModal(app, file, deps).open();
}
