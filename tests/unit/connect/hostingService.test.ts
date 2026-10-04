import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command, Plugin } from 'obsidian';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { decodeControl, encodeControl, type ControlMessage } from '../../../src/app/online/protocol';
import { MemoryNetwork } from '../../../src/app/online/transport/MemoryTransport';
import { AtlasLink } from '../../../src/connect/atlasLink';
import { startConnect } from '../../../src/connect/startConnect';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { fakeWorkspaceApp } from '../../fake/fakeWorkspace';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { snapshotOf } from '../online/sceneFixtures';
import { memorySettings } from './memorySettings';

const HOSTING: AtlasCapability[] = ['views', 'presentation', 'rules', 'settings', 'storage'];

/** Connect's plugin as hosting uses it: commands, status bar items, and what it registered for its own unload. */
function hostPlugin(app: Plugin['app']) {
  const commands = new Map<string, Command>();
  const statusBar = document.createElement('div');
  const cleanups: Array<() => void> = [];
  const plugin = {
    app,
    manifest: { id: 'atlas-vtt-connect' },
    register: (cleanup: () => void) => { cleanups.push(cleanup); },
    registerEvent: () => undefined,
    addCommand: (command: Command) => { commands.set(command.id, command); return command; },
    removeCommand: (id: string) => { commands.delete(id); },
    addStatusBarItem: () => statusBar.createDiv(),
  } as unknown as Plugin;
  return {
    plugin,
    commands,
    statusBar,
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

/** Atlas with these capabilities, Connect linked to it, and an in-memory host every session uses. */
function connected(capabilities: AtlasCapability[] = HOSTING) {
  const workspace = fakeWorkspaceApp();
  const { app } = workspace;
  Object.assign(app, { vault: Object.assign(createInMemoryApp().app.vault, { getName: () => 'Vault' }) });
  const connect = hostPlugin(app);
  const atlas = new FakeAtlas({ version: '1.6.0', capabilities, trigger: workspace.fire });
  workspace.plugins['atlas-vtt'] = { api: atlas };
  const network = new MemoryNetwork();
  const memoryHost = network.host('gm-id');
  const requests: Array<(allow: boolean) => void> = [];
  new AtlasLink(connect.plugin, (extension, api) => startConnect(connect.plugin, extension, api, {
    settings: memorySettings(),
    hosting: {
      createHost: async () => memoryHost,
      table: async () => null,
      showRequest: (_player, answer) => { requests.push(answer); return { hide: () => {} }; },
    },
  }), () => undefined).start();
  /** A web player who asks to join and is allowed, recording what the GM sends. */
  const join = async (name: string): Promise<{ received: ControlMessage[] }> => {
    const link = await network.client().connect('gm-id');
    const received: ControlMessage[] = [];
    link.onMessage((channel, data) => {
      const decoded = channel === 'control' && typeof data === 'string' ? decodeControl(data) : null;
      if (decoded?.kind === 'message') received.push(decoded.message);
    });
    link.send('control', encodeControl({ v: 1, type: 'join', name, playerKey: `key-${name}`, client: { kind: 'web', version: '1' } }));
    requests.at(-1)?.(true);
    return { received };
  };
  return { atlas, connect, join, fire: workspace.fire };
}

describe('hosting through the Atlas API', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

  // Review Focus 1
  it('hosts the presented scene for players and stops when Atlas unloads', async () => {
    const { atlas, connect, join } = connected();
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.run('start-online-session')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineSessionStore.getState().status).toBe('hosting');
    const player = await join('Ana');
    expect(onlineSessionStore.getState().players).toMatchObject([{ name: 'Ana', status: 'admitted' }]);
    atlas.views.setSnapshot('v1', snapshotOf({ objects: { tokens: { a: { id: 'a', kind: 'token', x: 70, y: 70, imagePath: 'art/a.png' } }, texts: {}, drawings: {}, fog: {} } }));
    expect(await atlas.presentation.present('v1', 't1')).toBe(true);
    await vi.advanceTimersByTimeAsync(60);
    const snapshot = player.received.find((message) => message.type === 'scene-snapshot');
    expect(snapshot?.type === 'scene-snapshot' && Object.keys(snapshot.scene.tokens)).toEqual(['a']);
    expect(connect.statusBar.textContent).toBe('Online · 1 player');

    atlas.unload(); // startConnect's disposer runs, through AtlasLink on api-unload
    expect(onlineSessionStore.getState().status).toBe('idle');
    expect(connect.statusBar.children).toHaveLength(0);
    expect([...connect.commands.keys()]).toEqual([]);
    expect(atlas.presentation.targets).toEqual([]);
    expect(atlas.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds a presentation target only while hosting', async () => {
    const { atlas, connect } = connected();
    await vi.advanceTimersByTimeAsync(0);
    expect(atlas.presentation.targets).toEqual([]);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    expect(atlas.presentation.targets.map((target) => [target.id, target.label, target.isActive()])).toEqual([['atlas-vtt-connect', 'online players', true]]);
    expect(connect.run('start-online-session')).toBe(false);
    expect(connect.run('stop-online-session')).toBe(true);
    expect(onlineSessionStore.getState().status).toBe('idle');
    expect(atlas.presentation.targets).toEqual([]);
    expect(connect.run('stop-online-session')).toBe(false);
  });

  it('registers the session commands, not Atlas\'s own present commands, and no join command without joining', async () => {
    const { connect } = connected();
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.values()].map((command) => command.name)).toEqual(['Online session…', 'Start online session', 'Stop online session']);
    expect(connect.statusBar.children).toHaveLength(1);
    expect((connect.statusBar.children[0] as HTMLElement).style.display).toBe('none');
  });

  it('offers no hosting on an Atlas without one of the capabilities it needs', async () => {
    const { connect } = connected(['views', 'rules', 'settings', 'storage']);
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.commands.size).toBe(0);
    expect(connect.statusBar.children).toHaveLength(0);
  });

  it('registers nothing when Atlas unloads before hosting support has started', async () => {
    const { atlas, connect } = connected();
    atlas.unload();
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.commands.size).toBe(0);
    expect(connect.statusBar.children).toHaveLength(0);
  });

  it('binds again when Atlas comes back, with one set of commands and one status bar item', async () => {
    const { atlas, connect, fire } = connected();
    await vi.advanceTimersByTimeAsync(0);
    atlas.unload();
    const again = new FakeAtlas({ version: '1.6.0', capabilities: HOSTING });
    fire('atlas-vtt:api-ready', again);
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.commands.size).toBe(3);
    expect(connect.statusBar.children).toHaveLength(1);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    expect(again.presentation.targets).toHaveLength(1);
    connect.unload(); // Connect itself unloading stops the session too
    expect(onlineSessionStore.getState().status).toBe('idle');
    expect(again.presentation.targets).toEqual([]);
  });
});
