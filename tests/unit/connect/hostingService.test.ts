import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AtlasCapability } from '@atlas-vtt/api-types';
import { onlineSessionStore, resetOnlineSessionStore } from '../../../src/app/online/onlineSessionStore';
import { FakeAtlas } from '../../fake/FakeAtlas';
import { snapshotOf } from '../online/sceneFixtures';
import { connected, HOSTING } from './hostingFixtures';

const WITH_TOOLS: AtlasCapability[] = [...HOSTING, 'dice', 'lasers'];

describe('hosting through the Atlas API', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { resetOnlineSessionStore(); vi.useRealTimers(); });

  // Review Focus 1
  it('hosts the presented scene for players and stops when Atlas unloads', async () => {
    const { atlas, connect, join, fire } = connected();
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
    // One item per plugin (final review M13): hidden between bindings, reused by the next.
    expect(connect.statusBar.children).toHaveLength(1);
    expect((connect.statusBar.children[0] as HTMLElement).style.display).toBe('none');
    expect([...connect.commands.keys()]).toEqual([]);
    expect(atlas.presentation.targets).toEqual([]);
    expect(atlas.listenerCount()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    fire('atlas-vtt:api-ready', new FakeAtlas({ capabilities: HOSTING }));
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.statusBar.children).toHaveLength(1);
    expect(connect.run('start-online-session')).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect((connect.statusBar.children[0] as HTMLElement).style.display).toBe('');
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

  it('registers the session commands, not Atlas\'s own present commands, beside the join command', async () => {
    const { connect } = connected();
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.values()].map((command) => command.name)).toEqual(['Join online session…', 'Online session…', 'Start online session', 'Stop online session']);
    expect(connect.statusBar.children).toHaveLength(1);
    expect((connect.statusBar.children[0] as HTMLElement).style.display).toBe('none');
  });

  it('offers no hosting on an Atlas without one of the capabilities it needs', async () => {
    const { connect } = connected(['views', 'rules', 'settings', 'storage']);
    await vi.advanceTimersByTimeAsync(0);
    expect([...connect.commands.keys()]).toEqual(['join-online-session']);
    expect(connect.statusBar.children).toHaveLength(0);
  });

  it('adds no command or status bar item when Atlas unloads while its storage folder is still being asked for', async () => {
    let answer: () => void = () => undefined;
    const { atlas, connect } = connected(HOSTING, new Promise<void>((resolve) => { answer = resolve; }));
    atlas.unload();
    answer();
    await vi.advanceTimersByTimeAsync(0);
    // Only the join command was ever added, and Atlas's unload removed it.
    expect(connect.added()).toBe(1);
    expect(connect.commands.size).toBe(0);
    expect(connect.statusBar.children).toHaveLength(0);
  });

  it('keeps the newer setup when Atlas reloads while the first one still waits for its storage folder', async () => {
    let answer: () => void = () => undefined;
    const { atlas, connect, fire } = connected(HOSTING, new Promise<void>((resolve) => { answer = resolve; }));
    atlas.unload();
    const again = new FakeAtlas({ capabilities: HOSTING });
    fire('atlas-vtt:api-ready', again);
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.added()).toBe(5);
    answer(); // the first setup's folder arrives last
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.added()).toBe(5);
    expect([...connect.commands.keys()]).toEqual(['join-online-session', 'online-session', 'start-online-session', 'stop-online-session']);
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
    const again = new FakeAtlas({ capabilities: HOSTING });
    fire('atlas-vtt:api-ready', again);
    await vi.advanceTimersByTimeAsync(0);
    expect(connect.commands.size).toBe(4);
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
