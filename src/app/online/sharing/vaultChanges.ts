/**
 * Vault renames and deletions, heard for as long as the plugin is loaded. Sharing's records by path (the note ids,
 * a map share's ticked notes) need every one of them: one missed while Atlas is away would leave a deleted note
 * ticked, so a new file at its path could be shared. While sharing is not bound, changes wait here, in order, and
 * the next binding takes them all before any new one.
 */
import type { EventRef, Plugin, TAbstractFile } from 'obsidian';
import type { VaultChange } from './model/mapShareRenames';

export type VaultChangeHandler = (change: VaultChange) => void;

/** One change to one handler: a handler that throws is logged, and the changes after it still arrive. */
function deliver(handler: VaultChangeHandler, change: VaultChange): void {
  try {
    handler(change);
  } catch (error) {
    console.error('[Atlas VTT Connect] Could not follow a vault change:', error);
  }
}

export class VaultChanges {
  private waiting: VaultChange[] = [];
  private handler: VaultChangeHandler | null = null;

  /** A change in the vault: to the bound handler, or kept for the next one. */
  push(change: VaultChange): void {
    if (this.handler) deliver(this.handler, change);
    else this.waiting.push(change);
  }

  /** Binds `handler`: it gets what waited first, then every change until the returned function unbinds it. */
  attach(handler: VaultChangeHandler): () => void {
    this.handler = handler;
    for (const change of this.waiting.splice(0)) deliver(handler, change);
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }
}

/**
 * The handlers of one binding (the share commands, the pulled files) as the one handler `VaultChanges` takes:
 * each change reaches every handler, in the order they were added, so the changes that waited reach them all.
 */
export class VaultChangeFanOut {
  private readonly handlers: VaultChangeHandler[] = [];

  attach(handler: VaultChangeHandler): () => void {
    this.handlers.push(handler);
    return () => {
      const at = this.handlers.indexOf(handler);
      if (at >= 0) this.handlers.splice(at, 1);
    };
  }

  readonly dispatch = (change: VaultChange): void => {
    for (const handler of [...this.handlers]) deliver(handler, change);
  };
}

/** The plugin's `VaultChanges`, fed by the vault's rename and delete events from now until the plugin unloads. */
export function vaultChangesFor(plugin: Pick<Plugin, 'app' | 'registerEvent'>): VaultChanges {
  const changes = new VaultChanges();
  const { vault } = plugin.app;
  const refs: EventRef[] = [
    vault.on('rename', (file: TAbstractFile, oldPath: string) => changes.push({ rename: [oldPath, file.path] })),
    vault.on('delete', (file: TAbstractFile) => changes.push({ removed: file.path })),
  ];
  for (const ref of refs) plugin.registerEvent(ref);
  return changes;
}
