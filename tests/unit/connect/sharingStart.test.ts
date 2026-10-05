import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { joinedSessionStore } from '../../../src/app/online/obsidian/joinedSessionStore';
import { OnlineJoinService } from '../../../src/app/online/obsidian/OnlineJoinService';
import { OnlineSessionService } from '../../../src/app/online/OnlineSessionService';
import { resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { connected, HOSTING } from './hostingFixtures';

const SHARING: AtlasCapability[] = [...HOSTING, 'scenes', 'bundles'];
const SHARE_COMMANDS = ['people', 'share-with', 'part-private', 'part-only', 'part-except', 'part-everyone', 'ask-to-pull'];

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
    fire('atlas-vtt:api-ready', new FakeAtlas({ version: '1.8.0', capabilities: SHARING }));
    await vi.advanceTimersByTimeAsync(0);
    expect(counts()).toEqual(first);
    expect(new Set(connect.commands.keys()).size).toBe(connect.commands.size);
    expect([...connect.commands.keys()]).toEqual(expect.arrayContaining(SHARE_COMMANDS));
    expect(connect.extensions).toHaveLength(1);
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
});
