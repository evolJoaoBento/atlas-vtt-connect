import { describe, expect, it } from 'vitest';
import { AtlasHost, HOST_MARK, type HostMark } from '../../../packages/atlas-host/src/index';
import { claimHostWhileHosting } from '../../../src/connect/hostClaim';
import { asLeaf, fakeHostApp, type FakeLeaf } from '../../fake/fakeHostWorkspace';

const A = 'maps/a.atlasmap';
const tick = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const never = (): Promise<void> => new Promise(() => undefined);

/** Tabletop's host with a board that opened Atlas's tab behind it, and Connect's own host on the same workspace. */
async function setup() {
  const fake = fakeHostApp([A]);
  const tabletop = new AtlasHost(fake.app, { pluginId: 'tabletop-for-atlas', wait: never });
  const connect = new AtlasHost(fake.app, { pluginId: 'atlas-vtt-connect', wait: never });
  const board = fake.workspace.add();
  fake.workspace.activeLeaf = board;
  const releaseBoard = tabletop.claim();
  const following = tabletop.follow(A, asLeaf(board));
  await tick();
  fake.workspace.atlasView()?.loaded();
  await following;
  let state = { status: 'idle' };
  const listeners = new Set<() => void>();
  const set = (status: string): void => { state = { status }; for (const listener of [...listeners]) listener(); };
  const stop = claimHostWhileHosting(connect, { state: () => state, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; } });
  const atlasLeaves = (): FakeLeaf[] => fake.workspace.getLeavesOfType('atlas-vtt');
  const mark = (): HostMark | undefined => (atlasLeaves()[0] as unknown as Record<string, HostMark> | undefined)?.[HOST_MARK];
  return { ...fake, tabletop, connect, board, releaseBoard, set, stop, atlasLeaves, mark };
}

describe("Connect's claim on the Atlas host", () => {
  it("keeps the tab Tabletop opened while a session is hosted, after the last board closes", async () => {
    const s = await setup();
    s.set('hosting');
    expect(s.mark()?.claims.get('atlas-vtt-connect')).toBe(1);
    s.releaseBoard();
    // Players are being sent this view's scene: it stays.
    expect(s.atlasLeaves()).toHaveLength(1);
    s.set('hosting');
    expect(s.mark()?.claims.get('atlas-vtt-connect')).toBe(1);
    // The session ends: nobody needs the tab a plugin opened.
    s.set('idle');
    expect(s.atlasLeaves()).toHaveLength(0);
  });

  it('claims nothing while not hosting, and lets go when Connect stops', async () => {
    const s = await setup();
    expect(s.mark()?.claims.has('atlas-vtt-connect')).toBe(false);
    s.set('hosting');
    s.stop();
    expect(s.mark()?.claims.has('atlas-vtt-connect')).toBe(false);
    s.set('hosting');
    expect(s.mark()?.claims.has('atlas-vtt-connect')).toBe(false);
    s.releaseBoard();
    expect(s.atlasLeaves()).toHaveLength(0);
  });

  it('a session already hosted when Connect starts is claimed at once', async () => {
    const fake = fakeHostApp([A]);
    const connect = new AtlasHost(fake.app, { pluginId: 'atlas-vtt-connect', wait: never });
    const { leaf } = fake.workspace.addAtlas();
    fake.workspace.fire('layout-change');
    claimHostWhileHosting(connect, { state: () => ({ status: 'hosting' }), subscribe: () => () => undefined });
    expect((leaf as unknown as Record<string, HostMark>)[HOST_MARK]?.claims.get('atlas-vtt-connect')).toBe(1);
  });
});
