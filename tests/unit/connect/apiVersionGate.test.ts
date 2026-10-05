import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability, AtlasExtension } from '@atlas-vtt/api-types';
import { resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { need, REQUIRED_MEMBERS, type NeedMap } from '../../../src/connect/capabilities';
import { connectingPlugin, FakeAtlas } from '../../fake/FakeAtlas';
import { connected, HOSTING } from './hostingFixtures';

// Final API review, versioning: upstream starts the API at 1.0.0 with every capability. Connect binds to any 1.x
// and decides each feature on `has()` and the members it calls, never on the minor.

const ALL: AtlasCapability[] = ['views', 'presentation', 'rules', 'lighting', 'tokens', 'dice', 'lasers', 'ui', 'scenes', 'bundles', 'settings', 'storage', 'remote-view'];
const HOSTING_COMMANDS = ['online-session', 'start-online-session', 'stop-online-session'];

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => { resetOnlineSessionStore(); });
  vi.useRealTimers();
});

describe('an extension API 1.0.0', () => {
  it('with every capability: hosting, joining and sharing all start', async () => {
    const { connect, sharing } = connected(ALL, undefined, undefined, { version: '1.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.keys()]).toEqual(expect.arrayContaining(['join-online-session', ...HOSTING_COMMANDS, 'share-with', 'shared-with-me']));
    expect(sharing).toEqual([true]);
  });

  it('without scenes and bundles: hosting and joining start, sharing degrades', async () => {
    const { connect, sharing } = connected([...HOSTING, 'dice', 'ui'], undefined, undefined, { version: '1.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.keys()]).toEqual(expect.arrayContaining(['join-online-session', ...HOSTING_COMMANDS]));
    expect([...connect.commands.keys()]).not.toContain('share-with');
    expect(sharing).toEqual([false]);
  });

  it('with only joining what it needs: joining starts alone', async () => {
    const { connect, sharing } = connected([], undefined, undefined, { version: '1.0.0' });
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.keys()]).toEqual(['join-online-session']);
    expect(sharing).toEqual([false]);
  });

  it('a capability whose namespace lacks a member Connect calls counts as missing: sharing degrades', async () => {
    const atlas = new FakeAtlas({ version: '1.0.0', capabilities: ALL });
    const extension = atlas.connect(connectingPlugin('atlas-vtt-connect'));
    for (const capability of Object.keys(REQUIRED_MEMBERS) as Array<keyof NeedMap>) expect(need(atlas, extension, capability), capability).not.toBeNull();
    const { readMap: _readMap, ...scenes } = extension.scenes;
    expect(need(atlas, { ...extension, scenes } as AtlasExtension, 'scenes')).toBeNull();
    // An optional member (added late) is checked where it is called, not here.
    const { replaceMap: _replaceMap, ...withoutReplace } = extension.scenes;
    expect(need(atlas, { ...extension, scenes: withoutReplace } as AtlasExtension, 'scenes')).not.toBeNull();
  });
});
