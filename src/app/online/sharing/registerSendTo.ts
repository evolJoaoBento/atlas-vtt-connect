/**
 * Send to…: sends one note to one person in the online session, whoever they are, with no `atlas-share` rule and no
 * People book entry. They may pull it for a while (`SendGrants`), and they are asked at once: "Ana is sending you a
 * note: Cellar" with Allow and Decline (`pushPrompt.ts`). Allow pulls it as any shared note is pulled, its part tags
 * and code checks included; Decline leaves their vault as it was.
 */
import { Notice, TFile, type TAbstractFile } from 'obsidian';
import { chooseAction } from '../../ui/confirmDialog';
import type { SenderCatalogue } from './model/SenderCatalogue';
import { trustedSections, type SectionTrust } from './model/sectionTrust';
import type { ShareItems } from './model/ShareItems';
import { pushRefusal } from './registerAskToPull';
import type { SharingScope } from './sharingScope';
import { NO_SHARE_SESSION_TEXT, shareSessionStore } from './shareSessionStore';

export const SEND_TO_LABEL = 'Send to…';
export const NOBODY_TO_SEND_TO_TEXT = 'Nobody else in this session uses Atlas in Obsidian, so there is nobody to send a note to.';

export interface SendToServices {
  items: Pick<ShareItems, 'idFor'>;
  sections: SectionTrust;
  catalogue: Pick<SenderCatalogue, 'sent'>;
}

const isNote = (file: TAbstractFile | null): file is TFile => file instanceof TFile && file.extension === 'md';

export function registerSendTo(plugin: SharingScope, { items, sections, catalogue }: SendToServices): void {
  const sendTo = async (file: TFile): Promise<void> => {
    const { session, people } = shareSessionStore.getState();
    if (!session) {
      new Notice(NO_SHARE_SESSION_TEXT);
      return;
    }
    if (people.length === 0) {
      new Notice(NOBODY_TO_SEND_TO_TEXT);
      return;
    }
    const text = await plugin.app.vault.cachedRead(file);
    const refused = pushRefusal(text, trustedSections(plugin.app, sections, file, text));
    if (refused) {
      new Notice(refused);
      return;
    }
    const personId = await chooseAction({
      title: `Send ${file.basename}`,
      message: ['They are asked to allow it. It lands in their vault only if they do.'],
      choices: people.map((person) => ({ label: person.name, value: person.personId })),
    });
    // The session may have ended, or the person left, while the dialog was open.
    const now = shareSessionStore.getState();
    const person = now.people.find((candidate) => candidate.personId === personId);
    if (!personId || !now.session || now.session.tableId !== session.tableId || !person) return;
    catalogue.sent.grant({ tableId: session.tableId, personId }, file.path);
    now.session.node.push(personId, items.idFor(file.path), 'note', file.basename);
    new Notice(`Sent ${file.basename} to ${person.name}.`);
  };
  plugin.addCommand({
    id: 'send-to', name: SEND_TO_LABEL,
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      if (!isNote(file) || !shareSessionStore.getState().session) return false;
      if (!checking) void sendTo(file);
      return true;
    },
  });
  plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
    if (!isNote(file) || !shareSessionStore.getState().session) return;
    menu.addItem((item) => item.setTitle(SEND_TO_LABEL).setIcon('send').onClick(() => { void sendTo(file); }));
  }));
}
