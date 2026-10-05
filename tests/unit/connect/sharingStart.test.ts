import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { joinedSessionStore } from '../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService } from '../../../src/app/online/obsidian/OnlineJoinService';
import { OnlineSessionService } from '../../../src/app/online/OnlineSessionService';
import { resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { PulledItems } from '../../../src/app/online/sharing/receive/PulledItems';
import { registerSharing, type SharingServices } from '../../../src/app/online/sharing/registerSharing';
import { sharingLifetime } from '../../../src/app/online/sharing/sharingLifetime';
import { shareSessionStore, type ShareSession } from '../../../src/app/online/sharing/shareSessionStore';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { PATHS } from '../online/sharing/sharingPathsFixture';
import { connected, HOSTING, hostPlugin } from './hostingFixtures';

const SHARING: AtlasCapability[] = [...HOSTING, 'scenes', 'bundles'];
const SHARE_COMMANDS = ['people', 'share-with', 'part-private', 'part-only', 'part-except', 'part-everyone', 'ask-to-pull', 'shared-with-me', 'undo-shared-merge', 'forget-shared-choice'];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => { resetOnlineSessionStore(); });
  joinedSessionStore.setState({ session: null });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sharing, through startConnect', () => {
  it('starts with scenes and bundles: the share commands, and atlas-share kept out of exports', async () => {
    const { atlas, connect, sharing } = connected(SHARING);
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.keys()]).toEqual(expect.arrayContaining(SHARE_COMMANDS));
    expect(sharing).toEqual([true]);
    expect(atlas.bundles.exportNote({ 'atlas-share': ['Ana'], tags: ['x'] })).toEqual({ tags: ['x'] });
  });

  it('without scenes or bundles: no share commands, and the settings tab is told sharing needs a newer Atlas', async () => {
    for (const missing of ['scenes', 'bundles'] as const) {
      const { connect, sharing } = connected(SHARING.filter((capability) => capability !== missing));
      await vi.advanceTimersByTimeAsync(0);
      expect([...connect.commands.keys()].filter((id) => SHARE_COMMANDS.includes(id))).toEqual([]);
      expect(sharing).toEqual([false]);
    }
  });

  it('keeps atlas-share stripped after Atlas unloads Connect, as Atlas remembers it (I5)', async () => {
    const { atlas, connect, sharing } = connected(SHARING);
    await vi.advanceTimersByTimeAsync(0);
    connect.unload(); // Connect unloads: the binding stops
    expect(sharing).toEqual([true, null]);
    expect(atlas.bundles.stripped().has('atlas-share')).toBe(true);
    atlas.bundles.restart(); // and Atlas starts again without Connect
    expect(atlas.bundles.exportNote({ 'atlas-share': 'public' })).toEqual({});
  });

  it('an Atlas reload starts sharing once again: every command once, one handler per event, one editor extension list', async () => {
    const { atlas, connect, fire, vaultEvents, cacheEvents, workspace } = connected(SHARING);
    await vi.advanceTimersByTimeAsync(0);
    const counts = (): number[] => [vaultEvents.count('rename'), vaultEvents.count('delete'), vaultEvents.count('modify'), cacheEvents.count('changed'), workspace.count('file-menu'), workspace.count('editor-menu')];
    const first = counts();
    expect(first.every((count) => count > 0)).toBe(true);
    atlas.unload();
    // Only what lives with the plugin is left: the record of what the metadata cache parsed.
    expect([...connect.commands.keys()]).toEqual([]);
    expect(workspace.count('file-menu')).toBe(0);
    expect(workspace.count('editor-menu')).toBe(0);
    fire('atlas-vtt:api-ready', new FakeAtlas({ capabilities: SHARING }));
    await vi.advanceTimersByTimeAsync(0);
    expect(counts()).toEqual(first);
    expect(new Set(connect.commands.keys()).size).toBe(connect.commands.size);
    expect([...connect.commands.keys()]).toEqual(expect.arrayContaining(SHARE_COMMANDS));
    expect(connect.extensions).toHaveLength(1);
  });

  it('ends the share session when Atlas goes, so nothing asks to pull over a node that is gone', async () => {
    const { atlas } = connected(['scenes', 'bundles', 'rules', 'settings', 'storage']);
    await vi.advanceTimersByTimeAsync(0);
    const node = {} as ShareSession['node'];
    shareSessionStore.setState({
      session: { role: 'player', tableId: 'T'.repeat(43), self: 'ana', node },
      people: [{ personId: 'gm', name: 'GM' }],
      pushes: [{ from: 'gm', item: 'i'.repeat(22), kind: 'note', title: 'Cave', at: 1 }],
    });
    atlas.unload();
    expect(shareSessionStore.getState()).toEqual({ session: null, people: [], pushes: [] });
  });

  it('starts for joined sessions where this Atlas cannot host, and gives hosting its hooks where it can', async () => {
    const useShare = vi.spyOn(OnlineJoinService.prototype, 'useShare');
    const hooks = vi.spyOn(OnlineSessionService.prototype, 'useSharingHooks');
    const { atlas } = connected(['scenes', 'bundles', 'rules', 'settings', 'storage']);
    await vi.advanceTimersByTimeAsync(0);
    expect(useShare).toHaveBeenCalledWith(expect.objectContaining({ activate: expect.any(Function) }));
    expect(hooks).not.toHaveBeenCalled();
    atlas.unload();
    expect(useShare).toHaveBeenLastCalledWith(null);
    const hosting = connected(SHARING);
    await vi.advanceTimersByTimeAsync(0);
    expect(hooks).toHaveBeenCalledWith(expect.objectContaining({ started: expect.any(Function) }));
    hosting.atlas.unload();
    expect(hooks).toHaveBeenLastCalledWith(null);
  });

  it('strips atlas-share at once when Atlas has bundles, before the storage folder answers and without hosting', () => {
    const { atlas } = connected(['bundles']);
    expect(atlas.bundles.stripped().has('atlas-share')).toBe(true);
    const slow = connected(SHARING, new Promise<void>(() => undefined));
    expect(slow.atlas.bundles.stripped().has('atlas-share')).toBe(true);
  });

  it('follows a ticked note deleted while Atlas was away once Atlas is back, so a new file at its path is not shared', async () => {
    const { atlas, fire, vaultEvents } = connected(SHARING);
    await vi.advanceTimersByTimeAsync(0);
    atlas.unload();
    vaultEvents.fire('delete', { path: 'Notes/Inn.md' });
    vaultEvents.fire('rename', { path: 'Archive/Keep.md' }, 'Notes/Keep.md');
    const again = new FakeAtlas({ capabilities: SHARING });
    const share = { item: 'i'.repeat(22), everyone: true, people: [], except: [], mode: 'full', notes: ['Notes/Inn.md', 'Notes/Keep.md'] };
    const sceneId = again.scenes.addScene({ name: 'Inn', mapPath: 'Inn.atlasmap', data: { extensions: { 'atlas-vtt-connect': share } } });
    fire('atlas-vtt:api-ready', again);
    await vi.advanceTimersByTimeAsync(0);
    expect((again.scenes.record(sceneId)!.data.extensions!['atlas-vtt-connect'] as { notes: string[] }).notes).toEqual(['Archive/Keep.md']);
  });

  it('pulled files and map shares both follow what changed in the vault while Atlas was away', async () => {
    const { atlas, connect, fire, vaultEvents } = connected(SHARING);
    await vi.advanceTimersByTimeAsync(0);
    const pulled = PulledItems.forApp(connect.plugin.app, PATHS);
    pulled.put({ tableId: 'T'.repeat(43), from: 'gm', item: 'p'.repeat(22), kind: 'note', path: 'Shared/GM/Cave.md', version: 'v', pulledAt: 1 });
    pulled.put({ tableId: 'T'.repeat(43), from: 'gm', item: 'q'.repeat(22), kind: 'note', path: 'Shared/GM/Gone.md', version: 'v', pulledAt: 1 });
    atlas.unload();
    vaultEvents.fire('rename', { path: 'Notes/Cave.md' }, 'Shared/GM/Cave.md');
    vaultEvents.fire('delete', { path: 'Shared/GM/Gone.md' });
    const again = new FakeAtlas({ capabilities: SHARING });
    const share = { item: 'i'.repeat(22), everyone: true, people: [], except: [], mode: 'full', notes: ['Shared/GM/Cave.md'] };
    const sceneId = again.scenes.addScene({ name: 'Inn', mapPath: 'Inn.atlasmap', data: { extensions: { 'atlas-vtt-connect': share } } });
    expect(pulled.byPath('Notes/Cave.md')).toBeNull();
    fire('atlas-vtt:api-ready', again);
    await vi.advanceTimersByTimeAsync(0);
    expect(pulled.byPath('Notes/Cave.md')?.item).toBe('p'.repeat(22));
    expect(pulled.get('T'.repeat(43), 'gm', 'q'.repeat(22))?.path).toBe('');
    expect((again.scenes.record(sceneId)!.data.extensions!['atlas-vtt-connect'] as { notes: string[] }).notes).toEqual(['Notes/Cave.md']);
  });

  it('a cold binding: pulled files renamed or deleted before Atlas binds follow, though the record of what was pulled is read only then', async () => {
    let open = (): void => undefined;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    const { connect, vaultEvents } = connected(SHARING, gate);
    const record = (item: string, path: string) => ({ key: `${'T'.repeat(43)}/gm/${item}`, tableId: 'T'.repeat(43), from: 'gm', item, kind: 'note', path, version: 'v', baseKey: `base${item.slice(0, 4)}`, pulledAt: 1 });
    await connect.plugin.app.vault.adapter.write(PATHS.pulled, JSON.stringify({ version: 1, records: [record('p'.repeat(22), 'Shared/GM/Cave.md'), record('q'.repeat(22), 'Shared/GM/Gone.md')] }));
    vaultEvents.fire('rename', { path: 'Notes/Cave.md' }, 'Shared/GM/Cave.md');
    vaultEvents.fire('delete', { path: 'Shared/GM/Gone.md' });
    open();
    await vi.advanceTimersByTimeAsync(0);
    const pulled = PulledItems.forApp(connect.plugin.app, PATHS);
    await pulled.ready();
    expect(pulled.byPath('Notes/Cave.md')?.item).toBe('p'.repeat(22));
    expect(pulled.byPath('Shared/GM/Cave.md')).toBeNull();
    expect(pulled.get('T'.repeat(43), 'gm', 'q'.repeat(22))?.path).toBe('');
    await vi.advanceTimersByTimeAsync(0);
    expect(await connect.plugin.app.vault.adapter.read(PATHS.pulled)).toContain('Notes/Cave.md');
  });

  it('takes off what it registered when registering fails partway, so the next binding does not add it twice', () => {
    const connect = hostPlugin(connected([]).connect.plugin.app);
    const atlas = new FakeAtlas({ capabilities: ['scenes', 'rules', 'settings'] });
    const extension = atlas.connect(connect.plugin);
    const services = {
      atlas: { scenes: extension.scenes, rules: extension.rules, playerView: () => extension.settings.get('playerView') },
      joins: { identity: null, onIdentity: () => () => undefined, useShare: () => undefined },
      people: { ready: async () => undefined, subscribe: () => () => undefined, flush: () => undefined },
      items: { ready: async () => undefined },
      pulled: { ready: async () => undefined },
      history: {},
      sessions: { useSharingHooks: () => { throw new Error('hooks failed'); } },
      settings: { ownTableId: () => null, shareableProperties: () => [] },
      lifetime: sharingLifetime(connect.plugin),
    } as unknown as SharingServices;
    expect(() => registerSharing(connect.plugin, services)).toThrow('hooks failed');
    expect(connect.commands.size).toBe(0);
    expect(connect.added()).toBeGreaterThan(0);
  });
});
