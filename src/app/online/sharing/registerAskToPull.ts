/** Ask to pull…: the sending side of push requests. It only shows the other person a prompt. */
import { Notice, type TFile } from 'obsidian';
import type { ScenesApi } from '@atlas-vtt/api-types';
import { chooseAction } from '../../ui/confirmDialog';
import { ruleReaches } from './model/audience';
import { mapShareOf } from './model/mapShare';
import { strayEndLineIn, strayEndProblem } from './model/noteFilter';
import type { NoteSection } from './model/noteSections';
import { trustedSections, type SectionTrust } from './model/sectionTrust';
import type { ShareItems } from './model/ShareItems';
import { parseShareRule, SHARE_PROPERTY } from './model/shareRule';
import type { PeopleBook } from './people/PeopleBook';
import { shareable } from './registerShareCommands';
import type { SharingScope } from './sharingScope';
import { NO_SHARE_SESSION_TEXT, shareSessionStore, type SessionPerson } from './shareSessionStore';

export const NOTE_NOT_SHARED_TEXT = 'Share this note with them first, then ask them to pull it.';

interface PushableItem {
  item: string;
  kind: 'note' | 'map';
}

/** Why a note may not be pushed: it is not shared at all while it has a stray end tag (`strayEndLineIn`). */
export function pushRefusal(text: string, sections: readonly NoteSection[] | null): string | null {
  const line = strayEndLineIn(text, sections);
  return line === null ? null : strayEndProblem(line);
}

export interface AskToPullServices {
  items: Pick<ShareItems, 'idFor'>;
  people: Pick<PeopleBook, 'byName' | 'allByName' | 'ready'>;
  sections: SectionTrust;
  scenes: Pick<ScenesApi, 'findByMap' | 'getData'>;
}

export function registerAskToPull(plugin: SharingScope, { items, people, sections, scenes }: AskToPullServices): void {
  const itemOf = async (file: TFile): Promise<PushableItem | null> => {
    if (file.extension === 'md') return { item: items.idFor(file.path), kind: 'note' };
    const scene = await scenes.findByMap(file.path);
    const share = scene ? await mapShareOf(scenes, scene.id) : null;
    return share ? { item: share.item, kind: 'map' } : null;
  };
  /** Who may be asked: for a note, only the people its `atlas-share` reaches, since nobody else could pull it. */
  const askable = async (file: TFile, tableId: string, present: readonly SessionPerson[]): Promise<SessionPerson[]> => {
    if (file.extension !== 'md') return [...present];
    await people.ready();
    const rule = parseShareRule(plugin.app.metadataCache.getFileCache(file)?.frontmatter?.[SHARE_PROPERTY]);
    return present.filter((person) => ruleReaches(rule, { tableId, personId: person.personId }, people));
  };
  const refusalFor = async (file: TFile): Promise<string | null> => {
    const text = await plugin.app.vault.cachedRead(file);
    return pushRefusal(text, trustedSections(plugin.app, sections, file, text));
  };
  const askToPull = async (file: TFile): Promise<void> => {
    const { session, people: present } = shareSessionStore.getState();
    if (!session) {
      new Notice(NO_SHARE_SESSION_TEXT);
      return;
    }
    if (present.length === 0) {
      new Notice('Nobody else in this session shares with Atlas in Obsidian.');
      return;
    }
    const refused = file.extension === 'md'
      ? await refusalFor(file)
      : null;
    if (refused) {
      new Notice(refused);
      return;
    }
    const choices = await askable(file, session.tableId, present);
    if (choices.length === 0) {
      // Checked before an item id is handed out: a note nobody may have gets none.
      new Notice(NOTE_NOT_SHARED_TEXT);
      return;
    }
    const item = await itemOf(file);
    if (!item) {
      new Notice('Share this map first, then ask someone to pull it.');
      return;
    }
    const person = await chooseAction({
      title: `Ask to pull ${file.basename}`,
      message: ['They get a prompt with Pull and Not now. They can pull it only if it is shared with them.'],
      choices: choices.map((candidate) => ({ label: candidate.name, value: candidate.personId })),
    });
    if (person) session.node.push(person, item.item, item.kind, file.basename);
  };
  plugin.addCommand({
    id: 'ask-to-pull', name: 'Ask to pull…',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!shareable(file) || !shareSessionStore.getState().session) return false;
      if (!checking) void askToPull(file);
      return true;
    },
  });
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (!shareable(file) || !shareSessionStore.getState().session) return;
    menu.addItem((item) => item.setTitle('Ask to pull…').setIcon('send').onClick(() => { void askToPull(file); }));
  }));
}
