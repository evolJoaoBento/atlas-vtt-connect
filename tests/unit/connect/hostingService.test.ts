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
const WITH_TOOLS: AtlasCapability[] = [...HOSTING, 'dice', 'lasers'];

/** Connect's plugin as hosting uses it: commands, status bar items, and what it registered for its own unload. */
function hostPlugin(app: Plugin['app']) {
  const commands = new Map<string, Command>();
  let added = 0;
  const statusBar = document.createElement('div');
  const cleanups: Array<() => void> = [];
  const plugin = {
    app,
    manifest: { id: 'atlas-vtt-connect' },
    register: (cleanup: () => void) => { cleanups.push(cleanup); },
    registerEvent: () => undefined,
    addCommand: (command: Command) => { added++; commands.set(command.id, command); return command; },
    removeCommand: (id: string) => { commands.delete(id); },
    addStatusBarItem: () => statusBar.createDiv(),
  } as unknown as Plugin;
  return {
    plugin,
    commands,
    statusBar,
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

/** Atlas with these capabilities, Connect linked to it, and an in-memory host every session uses. */
function connected(capabilities: AtlasCapability[] = HOSTING, gate?: Promise<void>) {
  const workspace = fakeWorkspaceApp();
  const { app } = workspace;
  Object.assign(app, { vault: Object.assign(createInMemoryApp().app.vault, { getName: () => 'Vault' }) });
  const connect = hostPlugin(app);
  const atlas = new FakeAtlas({ version: '1.6.0', capabilities, trigger: workspace.fire });
  if (gate) slowFolder(atlas, gate);
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

  it('adds no command or status bar item when Atlas unloads while its storage folder is still being asked for', async () => {
    let answer: () => void = () => undefined;
    const { atlas, connect } = connected(HOSTING, new Promise<void>((resolve) => { answer = resolve; }));
    atlas.unload();
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.added()).toBe(0);
    expect(connect.statusBar.children).toHaveLength(0);
  });

  it('keeps the newer setup when Atlas reloads while the first one still waits for its storage folder', async () => {
    let answer: () => void = () => undefined;
    const { atlas, connect, fire } = connected(HOSTING, new Promise<void>((resolve) => { answer = resolve; }));
    atlas.unload();
    const again = new FakeAtlas({ version: '1.6.0', capabilities: HOSTING });
    fire('atlas-vtt:api-ready', again);
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.added()).toBe(3);
    answer(); // the first setup's folder arrives last
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.added()).toBe(3);
    expect([...connect.commands.keys()]).toEqual(['online-session', 'start-online-session', 'stop-online-session']);
    expect(connect.statusBar.children).toHaveLength(1);
    expect(connect.run('start-online-session')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineSessionStore.getState().status).toBe('hosting');
    expect(again.presentation.targets).toHaveLength(1);
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

  it("rolls players' dice and shows their lasers through Atlas, and lets go of both when Atlas unloads", async () => {
    const { atlas, connect, join } = connected(WITH_TOOLS);
    await vi.advanceTimersByTimeAsync(0);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    const ana = await join('Ana');
    const bea = await join('Bea');
    atlas.views.setSnapshot('v1', snapshotOf());
    await atlas.presentation.present('v1', 't1');
    await vi.advanceTimersByTimeAsync(60);
    const snapshot = ana.received.find((message) => message.type === 'scene-snapshot');
    const sceneId = snapshot?.type === 'scene-snapshot' ? snapshot.scene.sceneId : 'none';
    const logged: string[] = [];
    atlas.connect({ manifest: { id: 'other' }, register: () => undefined } as never).dice.onRolled((roll) => logged.push(`${roll.rolledBy}:${roll.formula}`));
    ana.send({ v: 1, type: 'dice-roll', dice: { d20: 1 }, modifier: 2 });
    expect(logged).toEqual(['Ana:d20+2']);
    expect(bea.received.filter((message) => message.type === 'dice-log').at(-1)).toMatchObject({ entries: [{ name: 'Ana', formula: 'd20+2' }], replay: false });
    ana.send({ v: 1, type: 'laser', sceneId, points: [{ x: 5, y: 6 }], lifted: false });
    expect(atlas.lasers.shown('v1')).toMatchObject([{ points: [{ x: 5, y: 6 }], lifted: false }]);
    expect(bea.received.filter((message) => message.type === 'laser')).toHaveLength(1);

    atlas.unload();
    expect(atlas.dice.listening()).toBe(0);
    expect(atlas.lasers.listening('v1')).toBe(0);
    expect(atlas.listenerCount()).toBe(0);
  });

  it("hosts without players' dice and lasers on an Atlas that lacks them, and a roll or laser from a player does nothing", async () => {
    const { atlas, connect, join } = connected();
    await vi.advanceTimersByTimeAsync(0);
    connect.run('start-online-session');
    await vi.advanceTimersByTimeAsync(0);
    expect(onlineSessionStore.getState().status).toBe('hosting');
    const ana = await join('Ana');
    atlas.views.setSnapshot('v1', snapshotOf());
    await atlas.presentation.present('v1', 't1');
    await vi.advanceTimersByTimeAsync(60);
    ana.send({ v: 1, type: 'dice-roll', dice: { d20: 1 }, modifier: 0 });
    ana.send({ v: 1, type: 'laser', sceneId: 'x', points: [{ x: 1, y: 1 }], lifted: false });
    expect(ana.received.filter((message) => message.type === 'dice-log' || message.type === 'laser')).toEqual([]);
    expect(onlineSessionStore.getState().status).toBe('hosting');
  });
});
