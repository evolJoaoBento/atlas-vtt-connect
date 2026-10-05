import { vi } from 'vitest';
import type { Command, Plugin } from 'obsidian';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { AtlasLink } from '../../../src/connect/atlasLink';
import { sharingLifetime } from '../../../src/app/online/sharing/sharingLifetime';
import { startConnect, type ConnectOptions } from '../../../src/connect/startConnect';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { fakeEvents, fakeWorkspaceApp } from '../../fake/fakeWorkspace';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { memorySettings } from './memorySettings';

export const HOSTING: AtlasCapability[] = ['views', 'presentation', 'rules', 'settings', 'storage'];

/** Connect's plugin as hosting uses it: commands, status bar items, and what it registered for its own unload. */
export function hostPlugin(app: Plugin['app']) {
  const commands = new Map<string, Command>();
  let added = 0;
  const statusBar = document.createElement('div');
  const cleanups: Array<() => void> = [];
  /** The editor extension lists the plugin registered (sharing registers one, once). */
  const extensions: unknown[] = [];
  const plugin = {
    app,
    manifest: { id: 'atlas-vtt-connect' },
    register: (cleanup: () => void) => { cleanups.push(cleanup); },
    registerEvent: () => undefined,
    addCommand: (command: Command) => { added++; commands.set(command.id, command); return command; },
    removeCommand: (id: string) => { commands.delete(id); },
    addStatusBarItem: () => statusBar.createDiv(),
    registerEditorExtension: (extension: unknown) => { extensions.push(extension); },
    registerMarkdownPostProcessor: () => undefined,
  } as unknown as Plugin;
  return {
    plugin,
    commands,
    statusBar,
    extensions,
    /** How many times a command was added, removed ones included. */
    added: () => added,
    /** Runs a palette command, as Obsidian does: a `checkCallback` is asked first. */
    run(id: string): boolean {
      const command = commands.get(id);
      if (!command) return false;
      if (command.checkCallback) {
        if (command.checkCallback(true) === false) return false;
        command.checkCallback(false);
        return true;
      }
      command.callback?.();
      return true;
    },
    unload: () => { for (const cleanup of cleanups.splice(0)) cleanup(); },
  };
}

/** An Atlas whose storage folder answers only once `gate` resolves, as a slow vault adapter would. */
function slowFolder(atlas: FakeAtlas, gate: Promise<void>): void {
  const connect = atlas.connect.bind(atlas);
  vi.spyOn(atlas, 'connect').mockImplementation((plugin) => {
    const extension = connect(plugin);
    return { ...extension, storage: { folder: () => gate.then(() => extension.storage.folder()) } } as typeof extension;
  });
}

/** What a test adds: files already in the vault, and options for `startConnect` (the migration's store). */
export interface ConnectedExtra {
  files?: Record<string, string>;
  options?: Partial<ConnectOptions>;
}

/** Atlas with these capabilities, Connect linked to it, and an in-memory host every session uses. */
export function connected(capabilities: AtlasCapability[] = HOSTING, gate?: Promise<void>, playerKeys?: (hostId: string) => string, extra: ConnectedExtra = {}) {
  const workspace = fakeWorkspaceApp();
  const { app } = workspace;
  const vault = createInMemoryApp({ files: extra.files ?? {} });
  const memory = vault.app;
  const vaultEvents = fakeEvents();
  const cacheEvents = fakeEvents();
  Object.assign(app, {
    vault: Object.assign(memory.vault, { getName: () => 'Vault', on: vaultEvents.on, offref: vaultEvents.offref }),
    metadataCache: Object.assign(memory.metadataCache, { on: cacheEvents.on, offref: cacheEvents.offref }),
  });
  const connect = hostPlugin(app);
  const atlas = new FakeAtlas({ version: '1.13.0', capabilities, trigger: workspace.fire });
  if (gate) slowFolder(atlas, gate);
  workspace.plugins['atlas-vtt'] = { api: atlas };
  const network = new MemoryNetwork();
  const memoryHost = network.host('gm-id');
  const requests: Array<(allow: boolean) => void> = [];
  /** What each binding said about sharing (`ConnectOptions.sharing`). */
  const sharing: Array<boolean | null> = [];
  // As main.ts does in onload: heard for the plugin's lifetime.
  const lifetime = sharingLifetime(connect.plugin);
  new AtlasLink(connect.plugin, (extension, api) => startConnect(connect.plugin, extension, api, {
    settings: memorySettings(),
    sharing: (available) => { sharing.push(available); },
    lifetime,
    ...(playerKeys ? { playerKeys } : {}),
    hosting: {
      createHost: async () => memoryHost,
      table: async () => null,
      showRequest: (_player, answer) => { requests.push(answer); return { hide: () => {} }; },
    },
    ...extra.options,
  }), () => undefined).start();
  /** A web player who asks to join and is allowed, recording what the GM sends. */
  const join = async (name: string): Promise<{ received: ControlMessage[]; send(message: ControlMessage): void }> => {
    const link = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    link.onMessage((channel, data) => {
      const decoded = channel === 'control' && typeof data === 'string' ? decodeControl(data) : null;
      if (decoded?.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name, playerKey: `key-${name}`, client: { kind: 'web', version: '1' } }));
    requests.at(-1)?.(true);
    return { received, send: (message) => link.send('control', encodeControl(message)) };
  };
  return { atlas, connect, join, sharing, files: vault.files, fire: workspace.fire, vaultEvents, cacheEvents, workspace: app.workspace as unknown as ReturnType<typeof fakeEvents> };
}
