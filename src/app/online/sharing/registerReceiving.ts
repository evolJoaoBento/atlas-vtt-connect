/** Receiving: the Shared with me command and buttons, push prompts, and pulled files that follow renames. */
import { Notice, type App } from 'obsidian';
import type { ScenesApi } from '@atlas-vtt/api-types';
import { chooseAction, confirmAction } from '../../ui/confirmDialog';
import { peopleListNames } from './model/forwardedParts';
import { undoLastMerge, type MergeHistory, type UndoOutcome } from './merge/MergeHistory';
import { createUpdatePolicy } from './merge/noteUpdate';
import { askUpdateChoice, openMergePage } from './merge/ui/mergeModals';
import type { PeopleBook } from './people/PeopleBook';
import type { PulledItems, PulledRecord } from './receive/PulledItems';
import { pushPromptListener } from './receive/pushPrompts';
import { SharedWithMe } from './receive/SharedWithMe';
import { showPushPrompt } from './receive/ui/pushPrompt';
import { openSharedWithMeModal } from './receive/ui/SharedWithMeModal';
import { setSharedOpener } from './sharedFromView';
import type { SharingScope } from './sharingScope';
import { shareSessionStore, type ShareSession } from './shareSessionStore';
import type { VaultChanges } from './vaultChanges';

const UNDO_NOTICE: Record<UndoOutcome, string> = {
  undone: 'Merge undone.',
  declined: 'Undo cancelled.',
  nothing: 'There is no merge to undo for this note.',
};

const confirmMapUpdate = (title: string): Promise<'both' | 'theirs' | null> => chooseAction({
  title: `${title} changed here and was shared again`,
  message: ['Keep both saves the new version as a second scene. Take theirs replaces your copy.'],
  choices: [{ label: 'Keep both', value: 'both' as const }, { label: 'Take theirs', value: 'theirs' as const, style: 'warning' }],
});

const sessionName = (personId: string): string | null =>
  shareSessionStore.getState().people.find((person) => person.personId === personId)?.name ?? null;

export interface ReceivingServices {
  pulled: PulledItems;
  people: PeopleBook;
  history: MergeHistory;
  /** Where received maps are added (`Shared with me`). */
  scenes: Pick<ScenesApi, 'addToCollection' | 'list'>;
  /** The vault's renames and deletions, for the plugin's lifetime: pulled files follow them. */
  vaultChanges: Pick<VaultChanges, 'attach'>;
}

/** One service per share session: a new session (a new node) gets a fresh one. */
function sharedWithMeFor(app: App, services: ReceivingServices): () => SharedWithMe | null {
  const { pulled, history, people, scenes } = services;
  // Choices and the merge page run only inside a pull the receiver started.
  const policy = createUpdatePolicy({
    pulled, ask: (context) => askUpdateChoice(app, context), merge: (request) => openMergePage(app, request), warn: (message) => new Notice(message),
  });
  const replaced = (record: PulledRecord, before: string, after: string): Promise<void> => history.add(record, { at: Date.now(), before, after });
  let current: { node: ShareSession['node']; service: SharedWithMe } | null = null;
  return () => {
    const session = shareSessionStore.getState().session;
    if (!session) return null;
    if (current?.node !== session.node) {
      current = {
        node: session.node,
        service: new SharedWithMe({
          app, pulled, node: session.node, tableId: session.tableId, policy, replaced, rehomed: (record) => history.clear(record),
          nameOf: (personId) => sessionName(personId) ?? 'Someone',
          nameAt: peopleListNames(people, session.tableId),
          scenes, confirmMapUpdate,
        }),
      };
    }
    return current.service;
  };
}

export function registerReceiving(plugin: SharingScope, services: ReceivingServices): void {
  const { pulled, people, history, vaultChanges } = services;
  void pulled.ready();
  void people.ready();
  const sharedWithMe = sharedWithMeFor(plugin.app, services);
  const open = (app: App): void => openSharedWithMeModal(app, sharedWithMe());
  plugin.addCommand({ id: 'shared-with-me', name: 'Shared with me…', callback: () => open(plugin.app) });
  plugin.addCommand({
    id: 'undo-shared-merge', name: 'Undo last merge',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      const record = file ? pulled.byPath(file.path) : null;
      if (!record || record.kind !== 'note') return false;
      if (!checking) {
        void undoLastMerge(plugin.app, history, record, () => confirmAction({
          title: 'Undo the last merge?',
          message: ['This note changed after that merge. Undoing replaces it with the text from before the merge.'],
          confirmLabel: 'Undo', destructive: true,
        })).then((outcome) => new Notice(UNDO_NOTICE[outcome]));
      }
      return true;
    },
  });
  plugin.addCommand({
    id: 'forget-shared-choice', name: 'Forget remembered choice',
    checkCallback: (checking) => {
      const file = plugin.app.workspace.getActiveFile();
      const record = file ? pulled.byPath(file.path) : null;
      if (!record || record.kind !== 'note' || (record.choice === undefined && record.silent === undefined)) return false;
      if (!checking) {
        pulled.forgetChoice(record.key);
        new Notice('Forgot the remembered choice. The next update of this note asks again.');
      }
      return true;
    },
  });
  setSharedOpener(open);
  plugin.register(() => setSharedOpener(null));
  // A push shows a prompt; only Pull writes anything.
  const prompts = pushPromptListener({ show: showPushPrompt, service: sharedWithMe, notify: (text) => new Notice(text) });
  plugin.register(shareSessionStore.subscribe(prompts));
  plugin.register(() => prompts.dispose());
  // Pulled files follow renames; a deleted one leaves its record without a path, so no later file is taken for it.
  // Heard for the plugin's lifetime: what changed while Atlas was away arrives first (`VaultChanges`).
  plugin.register(vaultChanges.attach((change) => {
    if ('rename' in change) pulled.renamed(change.rename[0], change.rename[1]);
    else pulled.deleted(change.removed);
  }));
}
