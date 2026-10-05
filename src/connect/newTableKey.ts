/**
 * "New table key": replaces the GM's table key with a new one, for when a copy of the old one may have reached
 * someone else (a vault, sync history or backup made before keys moved out of the settings file, or the online play
 * preview's settings). Every player then joins as a new device and must be approved again.
 */
import type { Plugin } from 'obsidian';
import { Notice } from 'obsidian';
import { webIdentityCrypto, type IdentityCrypto } from '../app/online/sharing/identity/identityCrypto';
import { newTableIdentity, storedTable } from '../app/online/sharing/identity/tableKey';
import type { ConnectSettingsStore } from './settingsStore';
import { onlineSessionStore } from '../app/online/onlineSessionStore';
import { confirmAction, type ConfirmDialogOptions } from '../app/ui/confirmDialog';

export const NEW_TABLE_KEY_LABEL = 'New table key';
export const NEW_TABLE_KEY_CONFIRM: ConfirmDialogOptions = {
  title: 'Make a new table key?',
  message: [
    'Your table gets a new key, kept on this device only. The old key stops working for your table.',
    'Every player must be approved again: they join as new devices, which you can link to their people.',
  ],
  confirmLabel: 'Make a new key',
  destructive: true,
};
export const STOP_HOSTING_FIRST = 'Stop the online session first, then make a new table key.';
export const NEW_TABLE_KEY_DONE = 'Made a new table key. Approve your players again when they next join.';
export const NEW_TABLE_KEY_NOT_KEPT = "Couldn't save a new table key on this device, so your table keeps its old key.";
/** Shown once after a table key moved out of the settings file or came over from the online play preview. */
export const KEY_MOVED_NOTICE = 'Atlas VTT Connect now keeps your table key on this device only. If a copy of your vault, its sync history or a backup reached someone else, choose New table key in the settings.';

type KeySettings = Pick<ConnectSettingsStore, 'replaceTable'>;

export interface NewTableKeyDeps {
  settings: KeySettings;
  crypto?: IdentityCrypto;
  /** Whether a session is hosted or starting (`onlineSessionStore`). */
  isHosting?: () => boolean;
  confirm?: (options: ConfirmDialogOptions) => Promise<boolean>;
  notify?: (message: string) => void;
}

const hosting = (): boolean => ['hosting', 'starting'].includes(onlineSessionStore.getState().status);

/**
 * `hosting`: refused while a session runs; `cancelled`: the GM said no; `made`: the new key is stored; `not-kept`:
 * local storage refused the new key, so the old one stays.
 */
export async function newTableKey(deps: NewTableKeyDeps): Promise<'made' | 'cancelled' | 'hosting' | 'not-kept'> {
  const isHosting = deps.isHosting ?? hosting;
  const notify = deps.notify ?? ((message: string): void => { new Notice(message); });
  if (isHosting()) {
    notify(STOP_HOSTING_FIRST);
    return 'hosting';
  }
  if (!(await (deps.confirm ?? confirmAction)(NEW_TABLE_KEY_CONFIRM))) return 'cancelled';
  // A session started while the dialog was open keeps the key it started with.
  if (isHosting()) {
    notify(STOP_HOSTING_FIRST);
    return 'hosting';
  }
  const table = await newTableIdentity(deps.crypto ?? webIdentityCrypto);
  if (!deps.settings.replaceTable(storedTable(table))) {
    notify(NEW_TABLE_KEY_NOT_KEPT);
    return 'not-kept';
  }
  notify(NEW_TABLE_KEY_DONE);
  return 'made';
}

/** The command; there whether or not Atlas is bound, since the key is Connect's own. */
export function registerNewTableKey(plugin: Pick<Plugin, 'addCommand'>, settings: KeySettings): void {
  plugin.addCommand({ id: 'new-table-key', name: `${NEW_TABLE_KEY_LABEL}…`, callback: () => { void newTableKey({ settings }); } });
}
